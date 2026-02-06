(() => {
    "use strict";
    const $ = id => document.getElementById(id);
    const input = $("input"), highlight = $("highlight");
    const latinCountEl = $("latinCount"), cyrilCountEl = $("cyrilCount"), totalCountEl = $("totalCount");
    const btnClear = $("btnClear"), btnSample = $("btnSample"), btnCopy = $("btnCopy");

    const esc = s => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
    const reLat = /[\u0041-\u005A\u0061-\u007A\u00C0-\u00FF\u0100-\u024F]/;
    const reCyr = /[\u0400-\u04FF\u0500-\u052F\u2DE0-\u2DFF\uA640-\uA69F]/;

    const kind = ch => reLat.test(ch) ? 1 : (reCyr.test(ch) ? 2 : 0);
    const wrap = (k, s) => !s ? "" : (k === 1 ? `<span class="lat">${esc(s)}</span>` : k === 2 ? `<span class="cyr">${esc(s)}</span>` : esc(s));

    function render() {
        const t = input.value;
        let lat = 0, cyr = 0, out = "";
        if (t.length) {
            let start = 0, pk = kind(t[0]);
            for (let i = 0; i < t.length; i++) {
                const k = kind(t[i]);
                if (k === 1) lat++; else if (k === 2) cyr++;
                if (i && k !== pk) { out += wrap(pk, t.slice(start, i)); start = i; pk = k; }
            }
            out += wrap(pk, t.slice(start));
        }
        highlight.innerHTML = out + (t.endsWith("\n") ? "\n" : "");
        latinCountEl.textContent = lat;
        cyrilCountEl.textContent = cyr;
        totalCountEl.textContent = t.length;
    }

    const sync = () => { highlight.scrollTop = input.scrollTop; highlight.scrollLeft = input.scrollLeft };

    input.addEventListener("input", render, { passive: true });
    input.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync, { passive: true });

    btnClear.addEventListener("click", () => { input.value = ""; render(); input.focus() });
    btnSample.addEventListener("click", () => {
        input.value = "Пример: Hello, мир!\nСмешанный текст: The quick brown fox — быстрый лис.\nПроверка: A a Z z; А а Я я; Ё ё; Ї ї; Қ қ.";
        render(); input.focus();
    });
    btnCopy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(input.value); btnCopy.textContent = "Скопировано"; setTimeout(() => btnCopy.textContent = "Скопировать текст", 900) }
        catch { input.focus(); input.select(); document.execCommand("copy") }
    });
    highlight.addEventListener("mousedown", e => { e.preventDefault(); input.focus() });

    render();
})();