'use strict';

// Заглушка вместо ::/0: на Windows ::/0 включает kill-switch и рубит прямой российский трафик
const IPV6_STUB = ['::/1', '8000::/1'];
// DoH-резолверы по очереди: cloudflare-dns.com у части российских провайдеров недоступен
const DOH = ['https://dns.google/resolve?type=', 'https://cloudflare-dns.com/dns-query?type='];

const el = id => document.getElementById(id);
const esc = text => String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const cache = {};

// ---- адреса: всё на BigInt, одинаково для v4 и v6 ----

function parseAddress(text) {
    if (text.includes(':')) {
        const short = text.includes('::');
        const [head, tail] = text.split('::');
        const parts = head ? head.split(':') : [];
        const rest = short && tail ? tail.split(':') : [];
        if (short) parts.push(...Array(8 - parts.length - rest.length).fill('0'));
        const groups = parts.concat(rest);
        if (groups.length !== 8) throw new Error('плохой IPv6: ' + text);
        let value = 0n;
        for (const g of groups) {
            if (!/^[0-9a-f]{1,4}$/i.test(g)) throw new Error('плохой IPv6: ' + text);
            value = (value << 16n) | BigInt(parseInt(g, 16));
        }
        return { value, bits: 128 };
    }
    const octets = text.split('.');
    if (octets.length !== 4) throw new Error('плохой IPv4: ' + text);
    let value = 0n;
    for (const o of octets) {
        if (!/^\d{1,3}$/.test(o) || Number(o) > 255) throw new Error('плохой IPv4: ' + text);
        value = (value << 8n) | BigInt(Number(o));
    }
    return { value, bits: 32 };
}

function formatAddress(value, bits) {
    if (bits === 32) {
        const parts = [];
        for (let i = 3n; i >= 0n; i--) parts.push(Number((value >> (8n * i)) & 255n));
        return parts.join('.');
    }
    const groups = [];
    for (let i = 7n; i >= 0n; i--) groups.push(Number((value >> (16n * i)) & 0xffffn).toString(16));
    // самую длинную цепочку нулей сворачиваем в ::
    let best = { at: -1, len: 0 };
    for (let i = 0; i < 8; i++) {
        let j = i;
        while (j < 8 && groups[j] === '0') j++;
        if (j - i > best.len) best = { at: i, len: j - i };
        i = j;
    }
    if (best.len < 2) return groups.join(':');
    return groups.slice(0, best.at).join(':') + '::' + groups.slice(best.at + best.len).join(':');
}

function parseCidr(text) {
    const [addr, prefix] = text.split('/');
    const { value, bits } = parseAddress(addr);
    const size = 1n << BigInt(bits - Number(prefix));
    const start = (value / size) * size;
    return { start, end: start + size - 1n, bits };
}

function rangeToCidrs(start, end, bits) {
    const out = [];
    while (start <= end) {
        let length = bits;
        while (length > 0) {
            const size = 1n << BigInt(bits - length + 1);
            if (start % size !== 0n || start + size - 1n > end) break;
            length--;
        }
        out.push(formatAddress(start, bits) + '/' + length);
        start += 1n << BigInt(bits - length);
    }
    return out;
}

// Убрать один адрес из набора маршрутов: иначе туннель маршрутизирует сам в себя
function excludeAddress(cidrs, address) {
    const { value, bits } = address;
    const out = [];
    for (const text of cidrs) {
        const net = parseCidr(text);
        if (net.bits !== bits || value < net.start || value > net.end) {
            out.push(text);
            continue;
        }
        if (value > net.start) out.push(...rangeToCidrs(net.start, value - 1n, bits));
        if (value < net.end) out.push(...rangeToCidrs(value + 1n, net.end, bits));
    }
    return out;
}

function covered(cidrs, address) {
    return cidrs.some(text => {
        const net = parseCidr(text);
        return net.bits === address.bits && address.value >= net.start && address.value <= net.end;
    });
}

// ---- конфиг ----

function confValue(conf, key) {
    const match = conf.match(new RegExp('^\\s*' + key + '\\s*=\\s*(.+)$', 'mi'));
    return match ? match[1].trim() : '';
}

async function resolveHost(host) {
    try {
        return [parseAddress(host)];
    } catch (e) {
        // это имя, а не адрес: спрашиваем DoH, иначе эндпоинт может попасть в туннель
    }
    for (const doh of DOH) {
        const found = [];
        try {
            for (const type of ['A', 'AAAA']) {
                const res = await fetch(doh + type + '&name=' + encodeURIComponent(host),
                    { headers: { accept: 'application/dns-json' } });
                if (!res.ok) throw new Error('DoH ' + res.status);
                for (const answer of (await res.json()).Answer || []) {
                    try {
                        found.push(parseAddress(answer.data));
                    } catch (e) {
                        // CNAME в ответе, адрес придёт следующей записью
                    }
                }
            }
        } catch (e) {
            continue;  // резолвер недоступен, пробуем следующий
        }
        if (found.length) return found;
    }
    throw new Error('не удалось определить адрес Endpoint (' + host + '), впишите в конфиг IP вместо имени');
}

async function patch(conf, routes, withIpv6) {
    // строка AllowedIPs пишется в первый [Peer], поэтому конфиг с несколькими пирами не обрабатываем
    const peers = (conf.match(/^\[Peer\]/gm) || []).length;
    if (peers !== 1) throw new Error('нужна ровно одна секция [Peer], найдено ' + peers);
    const endpoint = confValue(conf, 'Endpoint');
    if (!endpoint) throw new Error('нет Endpoint');

    let allowed = routes.v4.slice();
    // заглушку добавляем до вырезания эндпоинта: иначе его AAAA остаётся в туннеле и тот маршрутизирует сам в себя
    allowed = allowed.concat(withIpv6 ? routes.v6 : IPV6_STUB);

    const host = endpoint.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    for (const address of await resolveHost(host)) allowed = excludeAddress(allowed, address);

    // DNS из [Interface] должен идти в туннель, даже если адрес из приватного диапазона
    for (const item of confValue(conf, 'DNS').split(',')) {
        const name = item.trim();
        if (!name) continue;
        let address;
        try {
            address = parseAddress(name);
        } catch (e) {
            continue;  // search domain
        }
        if (!covered(allowed, address)) allowed.push(name + (address.bits === 32 ? '/32' : '/128'));
    }

    const line = 'AllowedIPs = ' + allowed.join(', ');
    const cleaned = conf.replace(/^[ \t]*AllowedIPs[ \t]*=.*\r?\n?/gmi, '');
    return { text: cleaned.replace(/^(\[Peer\][ \t]*\r?\n)/m, '$1' + line + '\n'), routes: allowed.length };
}

async function loadRoutes(name) {
    if (!cache[name]) {
        const res = await fetch('data/' + name + '.json');
        if (!res.ok) throw new Error('не удалось загрузить список маршрутов ' + name);
        cache[name] = await res.json();
    }
    return cache[name];
}

// ---- страница ----

const drop = el('drop');
['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, e => {
    e.preventDefault();
    drop.classList.add('over');
}));
['dragleave', 'drop'].forEach(type => drop.addEventListener(type, () => drop.classList.remove('over')));
drop.addEventListener('drop', e => {
    e.preventDefault();
    el('files').files = e.dataTransfer.files;
    showFiles();
});
el('files').addEventListener('change', showFiles);

function showFiles() {
    const files = el('files').files;
    el('dropText').textContent = files.length
        ? [...files].map(f => f.name).join(', ')
        : 'Перетащите файлы сюда или нажмите, чтобы выбрать';
}

el('mode').addEventListener('change', () => {
    el('limitRow').classList.toggle('hidden', el('mode').value !== 'all');
});

// Браузер спросит разрешение на несколько загрузок один раз, поэтому качаем по очереди
function addDownloadAll(links) {
    const all = [...links.children];
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Скачать все (' + all.length + ')';
    button.addEventListener('click', () => all.forEach((link, i) => setTimeout(() => link.click(), i * 300)));
    links.prepend(button);
}

el('run').addEventListener('click', async () => {
    const files = [...el('files').files];
    const summary = el('summary');
    const links = el('links');
    el('result').classList.remove('hidden');
    links.innerHTML = '';
    if (!files.length) {
        summary.innerHTML = '<span class="err">Выберите хотя бы один файл .conf</span>';
        return;
    }
    const mode = el('mode').value;
    const name = el('preset').value + '-' + mode + (mode === 'all' ? '-' + el('limit').value : '');
    const withIpv6 = el('ipv6').checked;

    el('run').disabled = true;
    summary.textContent = 'Считаю...';
    try {
        const routes = await loadRoutes(name);
        const lines = [];
        for (const file of files) {
            try {
                const result = await patch(await file.text(), routes, withIpv6);
                const link = document.createElement('a');
                link.href = URL.createObjectURL(new Blob([result.text], { type: 'text/plain' }));
                link.download = file.name.replace(/\.conf$/i, '') + '-split.conf';
                link.textContent = 'Скачать ' + link.download;
                links.appendChild(link);
                lines.push('<b>' + esc(file.name) + '</b>: ' + result.routes + ' маршрутов'
                    + (withIpv6 ? '' : ', IPv6 заглушен'));
            } catch (e) {
                lines.push('<span class="err"><b>' + esc(file.name) + '</b>: ' + esc(e.message) + '</span>');
            }
        }
        lines.push('Напрямую: ' + esc(routes.countries) + '. Списки от ' + esc(routes.generated) + '.');
        summary.innerHTML = lines.join('<br>');
        if (links.children.length > 1) addDownloadAll(links);
    } catch (e) {
        summary.innerHTML = '<span class="err">' + esc(e.message) + '</span>';
    }
    el('run').disabled = false;
});

fetch('data/index.json').then(r => r.json()).then(data => {
    el('foot').textContent = 'Через VPN: ' + data.providers.join(', ') + '.';
}).catch(() => { });
