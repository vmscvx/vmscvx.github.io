#!/usr/bin/env python3
"""Rewrite AllowedIPs in AmneziaWG/WireGuard configs: split tunnel with RU (and other --countries) going direct.

--mode providers (default): only PROVIDERS (Google, Meta, Cloudflare, Telegram...) go into the tunnel,
  everything else goes direct. ~200 routes. Other foreign ranges may fill gaps between provider
  ranges when that saves routes: harmless, they just go through the tunnel too.
--mode all: all internet except those countries into the tunnel, PROVIDERS always included. The exact list is ~30k
  routes, too many for phones and Windows; see --max-routes and --priority.

IPv6 by default: stub "::/1, 8000::/1" - all IPv6 into the tunnel; with no IPv6 on the server it is dropped,
  so apps fall back to IPv4 and nothing leaks. Not "::/0": on Windows it turns on the kill-switch,
  which blocks direct RU traffic too.
IPv6 with --ipv6: IPv6 is split like IPv4 (universe: global unicast 2000::/3).

Route limit (--max-routes, per IP family, 0 = exact): over the limit some addresses end up on the wrong
side; --priority picks which error is cheaper: "ru" (default) never sends those countries into the tunnel;
"balance" and "vpn" allow some of them into the tunnel to keep more foreign in it.
LAN, reserved ranges and the server endpoint never go into the tunnel; PROVIDERS always do.

Usage: python make_allowedips.py [options] awg0.conf [out.conf]   one file; default out: <name>-split.conf
       python make_allowedips.py [options] in_dir out_dir        every *.conf in in_dir -> out_dir, same names
       python make_allowedips.py                                 GUI
Input files are never modified.
"""
import argparse
import bisect
import ipaddress
import re
import socket
import sys
import urllib.request
from pathlib import Path

COUNTRY_URL = "https://github.com/ebrasha/cidr-ip-ranges-by-country/raw/refs/heads/master/CIDR/{}-{}-Hackers.Zone.txt"
# Countries that go direct: two-letter codes, any country the repo has a list for.
# Worth adding only for countries whose services you actually use (they break or slow down over VPN).
# Cost in --mode providers is small (RU 109 routes, +BY+KZ 118, +the rest of the CIS 118), but in --mode all
# every code inflates the exact list (RU 31k routes, +BY+KZ 34k, +CIS 37k, +CN+IN+BR+TR+IR 101k = unusable).
DEFAULT_COUNTRIES = "RU,BY,KZ,AM,KG,TJ,UZ,AZ"

# LAN, loopback, link-local, CGNAT, docs/test nets, multicast, reserved
RESERVED = """
0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12
192.0.0.0/24 192.0.2.0/24 192.88.99.0/24 192.168.0.0/16 198.18.0.0/15
198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4
""".split()
# Outside 2000::/3 there is no public IPv6 at all (link-local, ULA, multicast...), so it is simply not routed
UNIVERSE = {4: ipaddress.ip_network("0.0.0.0/0"), 6: ipaddress.ip_network("2000::/3")}
RESERVED6 = ["2001:db8::/32"]
IPV6_STUB = [ipaddress.ip_network("::/1"), ipaddress.ip_network("8000::/1")]

# Always through the tunnel. Sources: official lists where the provider publishes one,
# otherwise prefixes announced by its ASN (RIPEstat). Any text/JSON with CIDRs works; plain CIDRs too.
RIPE = "https://stat.ripe.net/data/announced-prefixes/data.json?sourceapp=awg-split&resource=AS{}"
PROVIDERS = {
    "Anthropic": [RIPE.format(399358), "160.79.104.0/23", "2607:6bc0::/48"],
    "Telegram": ["https://core.telegram.org/resources/cidr.txt"],
    "Cloudflare": ["https://www.cloudflare.com/ips-v4", "https://www.cloudflare.com/ips-v6"],
    "Google": ["https://www.gstatic.com/ipranges/goog.json"],  # YouTube, Gemini; not Google Cloud customers
    "Meta": [RIPE.format(32934), RIPE.format(54115)],  # Facebook, Instagram, WhatsApp
    "X": [RIPE.format(13414), RIPE.format(35995)],
    # ChatGPT/OpenAI, Discord, Medium, Patreon, Notion sit behind Cloudflare above.
    # More if needed: "Fastly": ["https://api.fastly.com/public-ip-list"] (Reddit, Pinterest),
    # LinkedIn AS14413, Netflix AS2906+AS40027, Roblox AS22697+AS11281, Proton AS62371.
}

# Cost of one RU address sent into the VPN, relative to one foreign address sent direct.
# None = never (RU is a hard constraint). RU space is ~1% of IPv4, so weight 1 sacrifices RU first.
PRIORITY = {"ru": None, "balance": 10, "vpn": 1}
DEFAULT_MAX_ROUTES = 2000

Net = ipaddress.IPv4Network


def counter(nets):
    """Return count(lo, hi): how many addresses of nets fall into [lo, hi)."""
    iv = []
    for a, b in sorted((int(n.network_address), int(n.broadcast_address) + 1) for n in nets):
        if iv and a <= iv[-1][1]:
            iv[-1][1] = max(iv[-1][1], b)
        else:
            iv.append([a, b])
    starts, cum = [a for a, _ in iv], [0]
    for a, b in iv:
        cum.append(cum[-1] + b - a)

    def count(lo, hi):
        i, j = max(bisect.bisect_right(starts, lo) - 1, 0), bisect.bisect_left(starts, hi)
        if j <= i:
            return 0
        head = max(0, min(iv[i][1], lo) - iv[i][0])
        tail = max(0, iv[j - 1][1] - max(iv[j - 1][0], hi))
        return cum[j] - cum[i] - head - tail
    return count


def subtract(nets, minus):
    """nets minus the `minus` networks, as CIDRs. Meant for a short `minus` list."""
    out = []
    for net in nets:
        parts = [net]
        for m in minus:
            if m.version != net.version:
                continue
            parts = [q for p in parts
                     for q in (p.address_exclude(m) if m.subnet_of(p) else [] if p.subnet_of(m) else [p])]
        out += parts
    return out


def optimize(direct, hard, universe, max_routes=0, weight=PRIORITY["balance"], must=(), free_cost=1):
    """Tunnel CIDRs inside universe: everything except `direct`, using at most max_routes CIDRs (0 = exact).

    `hard` (subset of direct) never goes into the tunnel, `must` (disjoint from direct) always does.
    Over the limit, picks the CIDR set with the least wrongly routed addresses:
    soft-direct into the tunnel costs `weight` each, other ("free") addresses sent direct cost free_cost.
    free_cost=0: free addresses may go either way, so only `must` is wanted, in as few routes as possible.
    Exact DP on the prefix trie with a per-route penalty; the penalty is binary-searched to fit the limit.
    Returns (nets, share of soft-direct sent into the tunnel, share of tunnel sent direct).
    """
    count_d, count_h, count_m = counter(direct), counter(hard), counter(must)
    nodes = []  # post-order: [start, bits, free tunnel, soft, hard, must, left, right]

    def build(start, bits):
        size = 1 << bits
        d, h, m = count_d(start, start + size), count_h(start, start + size), count_m(start, start + size)
        node = [start, bits, size - d - m, d - h, h, m, None, None]
        if bits and max(node[2:6]) < size:  # mixed node: may split
            node[6] = build(start, bits - 1)
            node[7] = build(start + size // 2, bits - 1)
        nodes.append(node)
        return len(nodes) - 1

    root = build(int(universe.network_address), universe.max_prefixlen - universe.prefixlen)

    def solve(penalty):
        cost, routes, choice = [0.0] * len(nodes), [0] * len(nodes), [0] * len(nodes)
        for i, (_, _, tun, soft, h, m, left, right) in enumerate(nodes):
            options = [] if m else [(tun * free_cost, 0, 0)]  # 0: node direct
            if not h:
                options.append((soft * weight + penalty, 1, 1))  # 1: whole node into the tunnel
            if left is not None:
                options.append((cost[left] + cost[right], routes[left] + routes[right], 2))  # 2: split
            cost[i], routes[i], choice[i] = min(options)
        return routes[root], choice

    # penalty < 1/max_prefixlen can never beat a wrongly routed address: exact answer
    routes, choice = solve(1 / 256)
    if max_routes and routes > max_routes:
        lo, hi = -8.0, universe.max_prefixlen + 8.0  # log2 of the penalty
        for _ in range(40):
            mid = (lo + hi) / 2
            if solve(2 ** mid)[0] > max_routes:
                lo = mid
            else:
                hi = mid
        routes, choice = solve(2 ** hi)

    nets, soft_in, tun_in, stack = [], 0, 0, [root]
    while stack:
        start, bits, tun, soft, _, _, left, right = nodes[i := stack.pop()]
        if choice[i] == 1:
            nets.append(type(universe)((start, universe.max_prefixlen - bits)))
            soft_in, tun_in = soft_in + soft, tun_in + tun
        elif choice[i] == 2:
            stack += [left, right]
    total_tun, total_soft = nodes[root][2], nodes[root][3]
    return sorted(nets), soft_in / max(total_soft, 1), 1 - tun_in / max(total_tun, 1)


def selftest():
    u = UNIVERSE[4]
    assert optimize([Net("0.0.0.0/1")], [], u)[0] == [Net("128.0.0.0/1")]
    assert optimize([Net("0.0.0.0/2"), Net("64.0.0.0/2"), Net("192.0.0.0/2")], [], u)[0] == [Net("128.0.0.0/2")]
    assert optimize([Net("10.0.0.0/8"), Net("10.1.0.0/16")], [], u)[0][:3] == [Net("0.0.0.0/5"), Net("8.0.0.0/7"), Net("11.0.0.0/8")]
    assert optimize([], [], u)[0] == [Net("0.0.0.0/0")]
    v6 = ipaddress.IPv6Network
    assert optimize([v6("2000::/4")], [], UNIVERSE[6])[0] == [v6("3000::/4")]
    # limit 1: a lone soft /32 gets swallowed, a hard /32 never does
    assert optimize([Net("8.8.8.8/32")], [], u, max_routes=1)[0] == [Net("0.0.0.0/0")]
    nets = optimize([Net("8.8.8.8/32")], [Net("8.8.8.8/32")], u, max_routes=1)[0]
    assert not any(ipaddress.ip_address("8.8.8.8") in n for n in nets)
    # limit 1, all foreign may go direct, but must-tunnel stays in and hard stays out
    nets = optimize([Net("0.0.0.0/1")], [Net("10.0.0.0/8")], u, max_routes=1, weight=1000, must=[Net("100.0.0.0/8")])[0]
    assert any(ipaddress.ip_address("100.1.2.3") in n for n in nets)
    assert not any(ipaddress.ip_address("10.1.2.3") in n for n in nets)
    assert subtract([Net("10.0.0.0/8")], [Net("10.0.0.0/9")]) == [Net("10.128.0.0/9")]
    # providers mode: free gap between wanted ranges gets swallowed, RU gap does not
    must = [Net("100.0.0.0/8"), Net("103.0.0.0/8")]
    ru = [Net("99.0.0.0/8"), Net("104.0.0.0/8")]
    assert optimize(ru, ru, u, must=must, free_cost=0)[0] == [Net("100.0.0.0/6")]
    ru = [Net("101.0.0.0/16")]
    nets = optimize(ru, ru, u, must=must, free_cost=0)[0]
    assert len(nets) == 2 and not any(n.overlaps(ru[0]) for n in nets)
    assert all(any(m.subnet_of(n) for n in nets) for m in must)


def conf_value(conf, key):
    m = re.search(rf"^[ \t]*{key}[ \t]*=[ \t]*(.+?)[ \t]*$", conf, re.M | re.I)
    return m.group(1) if m else None


def default_output(src):
    return src.with_name(f"{src.stem}-split{src.suffix}")


def fetch_nets(source, min_count=1):
    """Networks from a URL (plain list or JSON, CIDRs picked out by regex) or a literal CIDR."""
    if not source.startswith("http"):
        return [ipaddress.ip_network(source)]
    request = urllib.request.Request(source, headers={"User-Agent": "awg-split"})
    with urllib.request.urlopen(request, timeout=90) as r:
        text = r.read().decode("utf-8", "replace")
    nets = []
    for token in re.findall(r"[0-9A-Fa-f:.]+/\d{1,3}", text):
        try:
            nets.append(ipaddress.ip_network(token, strict=False))
        except ValueError:
            pass  # not an address, e.g. part of a URL
    if len(nets) < min_count:
        raise ValueError(f"{source} looks broken: only {len(nets)} networks parsed")
    return nets


def fetch_lists(versions, countries=DEFAULT_COUNTRIES):
    """Download country lists (given IP versions) and provider lists once; shared by all configs in a batch."""
    home = []
    for code in [c.strip().upper() for c in countries.split(",") if c.strip()]:
        for version in versions:
            home += fetch_nets(COUNTRY_URL.format(code, f"ipv{version}"), 10)
    must = [net for sources in PROVIDERS.values() for source in sources for net in fetch_nets(source)]
    return home, must


def build(src, dst, lists, versions, max_routes, weight, providers_only):
    """Write dst = src config with new AllowedIPs. Returns summary; raises ValueError/OSError on failure."""
    conf = src.read_text(encoding="utf-8-sig")
    if not re.search(r"^\[Peer\]", conf, re.M):
        raise ValueError(f"{src.name}: no [Peer] section")

    # Endpoint must stay outside the tunnel, otherwise the tunnel routes into itself
    endpoint = conf_value(conf, "Endpoint")
    if not endpoint:
        raise ValueError(f"{src.name}: no Endpoint")
    host = endpoint.rsplit(":", 1)[0].strip("[]")
    # every address the name resolves to: the client may pick either family
    endpoint_ips = sorted({ipaddress.ip_address(a[4][0].split("%")[0]) for a in socket.getaddrinfo(host, None)},
                          key=lambda a: (a.version, a))
    hard = [ipaddress.ip_network(n) for n in RESERVED + RESERVED6]
    hard += [ipaddress.ip_network(ip) for ip in endpoint_ips]

    # DNS from [Interface] goes through the tunnel even if it sits in a private range
    dns = []
    for item in (conf_value(conf, "DNS") or "").split(","):
        try:
            dns.append(ipaddress.ip_network(ipaddress.ip_address(item.strip())))
        except ValueError:
            pass  # search domain

    home, must = lists
    allowed, stats = [], []
    for version in versions:
        family_hard = [n for n in hard if n.version == version]
        # priority: hard direct > must tunnel > RU direct
        family_must = subtract([n for n in must if n.version == version], family_hard)
        family_home = subtract([n for n in home if n.version == version], family_must)
        strict = family_hard + family_home if weight is None else family_hard
        nets, home_in_vpn, foreign_direct = optimize(family_home + family_hard, strict, UNIVERSE[version],
                                                   max_routes, weight or 1, family_must, 0 if providers_only else 1)
        nets = list(ipaddress.collapse_addresses(nets + [n for n in dns if n.version == version]))
        allowed += nets
        other = f"other foreign->VPN {1 - foreign_direct:.2%}" if providers_only else f"foreign->direct {foreign_direct:.2%}"
        stats.append(f"IPv{version}: {len(nets)} routes, home->VPN {home_in_vpn:.1%}, {other}")
    if 6 not in versions:
        allowed += IPV6_STUB
        stats.append("IPv6: stub")

    line = "AllowedIPs = " + ", ".join(map(str, allowed))
    conf = re.sub(r"^[ \t]*AllowedIPs[ \t]*=.*\n?", "", conf, flags=re.M | re.I)
    conf = re.sub(r"^\[Peer\][ \t]*\n?", lambda m: f"[Peer]\n{line}\n", conf, count=1, flags=re.M)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(conf, encoding="utf-8")
    ips = ", ".join(map(str, endpoint_ips))
    return f"{src.name}: endpoint {ips} excluded; {'; '.join(stats)} -> {dst}"


def build_dir(in_dir, out_dir, *args):
    """Process every *.conf in in_dir. Returns (report lines, error count); one bad file does not stop the rest."""
    if in_dir.resolve() == out_dir.resolve():
        raise ValueError("Output folder must differ from input folder (files keep their names)")
    files = sorted(in_dir.glob("*.conf"))
    if not files:
        raise ValueError(f"No *.conf files in {in_dir}")
    report, errors = [], 0
    for src in files:
        try:
            report.append(build(src, out_dir / src.name, *args))
        except (ValueError, OSError) as e:
            errors += 1
            report.append(f"ERROR {e}" if src.name in str(e) else f"ERROR {src.name}: {e}")
    report.append(f"Done: {len(files) - errors} ok, {errors} failed")
    return report, errors


def run(src, dst, ipv6=False, max_routes=DEFAULT_MAX_ROUTES, priority="ru", mode="providers",
        countries=DEFAULT_COUNTRIES):
    """Dispatch file or folder mode. Returns (report lines, error count)."""
    versions = (4, 6) if ipv6 else (4,)
    if src.is_file() and src.resolve() == dst.resolve():
        raise ValueError("Output file must differ from input file")
    args = (fetch_lists(versions, countries), versions, max_routes, PRIORITY[priority], mode == "providers")
    if src.is_dir():
        return build_dir(src, dst, *args)
    return [build(src, dst, *args)], 0


def gui():
    import threading
    import tkinter as tk
    from tkinter import filedialog, messagebox, scrolledtext, ttk

    root = tk.Tk()
    root.title("AWG split: свои страны напрямую")
    mode = tk.StringVar(value="file")
    ipv6 = tk.BooleanVar(value=False)
    max_routes = tk.StringVar(value=str(DEFAULT_MAX_ROUTES))
    picked = {code: tk.BooleanVar(value=True) for code in DEFAULT_COUNTRIES.split(",")}
    priorities = {"RU всегда напрямую": "ru", "Баланс": "balance", "Зарубеж через VPN важнее": "vpn"}
    priority = tk.StringVar(value="RU всегда напрямую")
    routings = {"Только провайдеры (" + ", ".join(PROVIDERS) + ")": "providers", "Весь зарубеж": "all"}
    routing = tk.StringVar(value=next(iter(routings)))
    src_var, dst_var = tk.StringVar(), tk.StringVar()
    types = [("AmneziaWG config", "*.conf"), ("All files", "*.*")]

    def pick_src():
        if mode.get() == "dir":
            path = filedialog.askdirectory(title="Папка с конфигами")
        else:
            path = filedialog.askopenfilename(filetypes=types)
        if path:
            src_var.set(path)
            if mode.get() == "file":
                dst_var.set(str(default_output(Path(path))))

    def pick_dst():
        if mode.get() == "dir":
            path = filedialog.askdirectory(title="Папка для результата")
        else:
            path = filedialog.asksaveasfilename(defaultextension=".conf", filetypes=types,
                                                initialfile=Path(dst_var.get()).name if dst_var.get() else "")
        if path:
            dst_var.set(path)

    def switch_mode():
        src_var.set("")
        dst_var.set("")
        src_label.config(text="Папка с конфигами:" if mode.get() == "dir" else "Конфиг:")

    def log(text):
        out.insert("end", text + "\n")
        out.see("end")

    def done(report, errors):
        run_btn.config(state="normal")
        for line in report:
            log(line)
        if errors:
            messagebox.showerror("Ошибка", report[-1])
        else:
            messagebox.showinfo("Готово", report[-1])

    def work(*args):
        try:
            result = run(*args)
        except Exception as e:  # show any failure (network, DNS, file) in the window
            result = [f"ERROR: {e}"], 1
        root.after(0, done, *result)

    def start():
        if not src_var.get() or not dst_var.get():
            messagebox.showwarning("Не указан путь", "Укажите, что обработать и куда сохранить")
            return
        try:
            limit = int(max_routes.get())
            if limit < 0:
                raise ValueError
        except ValueError:
            messagebox.showwarning("Лимит маршрутов", "Целое число >= 0 (0 = без лимита)")
            return
        run_btn.config(state="disabled")
        out.delete("1.0", "end")
        log("Скачиваю списки и считаю...")
        args = (Path(src_var.get()), Path(dst_var.get()), ipv6.get(), limit, priorities[priority.get()],
                routings[routing.get()], ",".join(c for c, v in picked.items() if v.get()))
        threading.Thread(target=work, args=args, daemon=True).start()

    modes = tk.Frame(root)
    modes.grid(row=0, column=0, columnspan=3, sticky="w", padx=6, pady=(6, 0))
    tk.Radiobutton(modes, text="Один файл", variable=mode, value="file", command=switch_mode).pack(side="left")
    tk.Radiobutton(modes, text="Папка (все *.conf)", variable=mode, value="dir", command=switch_mode).pack(side="left")
    tk.Checkbutton(modes, text="IPv6 как IPv4 (без галочки весь IPv6 глушится)",
                   variable=ipv6).pack(side="left", padx=(20, 0))

    src_label = tk.Label(root, text="Конфиг:")
    src_label.grid(row=1, column=0, sticky="w", padx=6, pady=4)
    tk.Label(root, text="Сохранить в:").grid(row=2, column=0, sticky="w", padx=6, pady=4)
    for row, (var, cmd) in enumerate([(src_var, pick_src), (dst_var, pick_dst)], start=1):
        tk.Entry(root, textvariable=var, width=60).grid(row=row, column=1, sticky="we", pady=4)
        tk.Button(root, text="Обзор...", command=cmd).grid(row=row, column=2, padx=6, pady=4)

    countries = tk.LabelFrame(root, text="Напрямую, мимо VPN")
    countries.grid(row=3, column=0, columnspan=3, sticky="we", padx=6, pady=(8, 2))
    for code, var in picked.items():
        # RU is the point of the tool, leave no way to turn it off
        tk.Checkbutton(countries, text=code, variable=var,
                       state="disabled" if code == "RU" else "normal").pack(side="left", padx=2)

    tk.Label(root, text="В туннель:").grid(row=4, column=0, sticky="w", padx=6, pady=4)
    ttk.Combobox(root, textvariable=routing, values=list(routings), state="readonly").grid(
        row=4, column=1, columnspan=2, sticky="we", padx=(0, 6), pady=4)
    opts = tk.Frame(root)
    opts.grid(row=5, column=0, columnspan=3, sticky="w", padx=6, pady=4)
    tk.Label(opts, text="Макс. маршрутов (0 = без лимита):").pack(side="left")
    tk.Spinbox(opts, textvariable=max_routes, from_=0, to=100000, increment=500, width=8).pack(side="left")
    tk.Label(opts, text="Приоритет:").pack(side="left", padx=(20, 4))
    ttk.Combobox(opts, textvariable=priority, values=list(priorities), state="readonly", width=26).pack(side="left")
    run_btn = tk.Button(root, text="Сгенерировать", command=start)
    run_btn.grid(row=6, column=1, pady=8)
    out = scrolledtext.ScrolledText(root, height=10, width=100)
    out.grid(row=7, column=0, columnspan=3, sticky="nsew", padx=6, pady=(0, 6))
    root.columnconfigure(1, weight=1)
    root.rowconfigure(7, weight=1)
    root.mainloop()


def main():
    selftest()
    if len(sys.argv) < 2:
        gui()
        return
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("src", type=Path, help="config file or folder with *.conf")
    p.add_argument("dst", type=Path, nargs="?", help="output file (default <name>-split.conf) or folder")
    p.add_argument("--mode", choices=["providers", "all"], default="providers",
                   help="providers: only PROVIDERS into the tunnel (default); all: everything except --countries")
    p.add_argument("--ipv6", action="store_true", help="route IPv6 like IPv4 instead of the stub")
    p.add_argument("--max-routes", type=int, default=DEFAULT_MAX_ROUTES,
                   help=f"route limit per IP family, 0 = exact (default {DEFAULT_MAX_ROUTES})")
    p.add_argument("--priority", choices=PRIORITY, default="ru",
                   help="which error to avoid when over the limit (default ru)")
    p.add_argument("--countries", default=DEFAULT_COUNTRIES,
                   help=f"country codes that go direct, comma separated (default {DEFAULT_COUNTRIES})")
    a = p.parse_args()
    if a.src.is_dir() and not a.dst:
        p.error("folder mode needs an output folder")
    try:
        report, errors = run(a.src, a.dst or default_output(a.src), a.ipv6, a.max_routes, a.priority, a.mode,
                             a.countries)
    except (ValueError, OSError) as e:
        sys.exit(str(e))
    print("\n".join(report))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
