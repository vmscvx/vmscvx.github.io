#!/usr/bin/env python3
"""Build the static route lists for awg-split/index.html. Run by .github/workflows/awg-split-data.yml.

Writes awg-split/data/<preset>-<mode>[-<limit>].json plus data/index.json.
The browser only patches a config with these lists: no optimizer runs client side.
"""
import ipaddress
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_allowedips as M

PRESETS = {
    "ru": "RU",
    "cis3": "RU,BY,KZ",
    "cis": M.DEFAULT_COUNTRIES,
}
# mode -> route limits to prebuild (providers mode is small enough to stay exact)
BUILDS = {"providers": [0], "all": [1000, 2000, 4000]}
OUT = Path(__file__).resolve().parent / "data"


def routes(home, must, limit, providers_only):
    hard = [ipaddress.ip_network(n) for n in M.RESERVED + M.RESERVED6]
    result, stats = {}, {}
    for version in (4, 6):
        family_hard = [n for n in hard if n.version == version]
        family_must = M.subtract([n for n in must if n.version == version], family_hard)
        family_home = M.subtract([n for n in home if n.version == version], family_must)
        nets, home_in_vpn, free_direct = M.optimize(
            family_home + family_hard, family_hard + family_home, M.UNIVERSE[version],
            limit, 1, family_must, 0 if providers_only else 1)
        result[f"v{version}"] = [str(n) for n in nets]
        stats[f"v{version}"] = {"routes": len(nets), "homeInVpn": round(home_in_vpn, 4),
                                "foreignDirect": round(free_direct, 4)}
    return result, stats


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    must = M.fetch_providers()
    generated = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())
    index = {"generated": generated, "providers": list(M.PROVIDERS), "presets": {}, "files": {}}
    for preset, countries in PRESETS.items():
        home = [n for code in countries.split(",") for v in (4, 6)
                for n in M.fetch_nets(M.COUNTRY_URL.format(code, f"ipv{v}"), 10)]
        index["presets"][preset] = countries
        for mode, limits in BUILDS.items():
            for limit in limits:
                name = f"{preset}-{mode}" + (f"-{limit}" if limit else "")
                data, stats = routes(home, must, limit, mode == "providers")
                data["generated"] = generated
                data["countries"] = countries
                data["stats"] = stats
                (OUT / f"{name}.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
                index["files"][name] = stats
                print(f"{name}: v4 {stats['v4']['routes']} routes, v6 {stats['v6']['routes']} routes")
    (OUT / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
