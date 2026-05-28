(function () {
    var C = window.BALANCE_CONFIG;
    if (!C) throw new Error('BALANCE_CONFIG not set');

    var CUR_MAP = { 'CNY': '¥', 'USD': '$', 'EUR': '€', 'RUB': '₽', 'GBP': '£', 'JPY': '¥', 'KRW': '₩' };

    var el = document.getElementById('balance');
    var lastBalance = null;
    var lastNotified = null;
    var resolvedCurrency = localStorage.getItem(C.storageKey + '_currency') || C.currency;

    function fmt(n) {
        var parts = Number(n).toFixed(2).replace('.', ',').split(',');
        var intPart = parts[0], sign = '';
        if (intPart.startsWith('-')) { sign = '-'; intPart = intPart.slice(1); }
        var num = sign + intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (parts[1] ? ',' + parts[1] : '');
        return C.currencyBefore ? (resolvedCurrency + ' ' + num) : (num + ' ' + resolvedCurrency);
    }

    function requestPerm() {
        if (Notification.permission === 'default') Notification.requestPermission();
    }

    function notify(n) {
        if (Notification.permission !== 'granted') return;
        new Notification(C.notificationTitle, { body: 'Текущий баланс: ' + fmt(n) });
    }

    function checkAndNotify(n) {
        if (lastBalance !== null && lastNotified !== null && Math.abs(n - lastNotified) >= C.notificationThreshold) {
            notify(n);
            lastNotified = n;
        } else if (lastNotified === null) {
            lastNotified = n;
        }
        lastBalance = n;
    }

    function getToken() {
        var t = localStorage.getItem(C.tokenKey);
        if (!t) {
            t = prompt('Введите API-ключ');
            if (t) localStorage.setItem(C.tokenKey, t);
        }
        return t;
    }

    function handleInvalid() {
        alert('API-ключ недействителен или истёк. Пожалуйста, введите новый ключ.');
        localStorage.removeItem(C.tokenKey);
        var t = prompt('Введите API-ключ');
        t ? (localStorage.setItem(C.tokenKey, t), fetchBalance()) : el.textContent = 'Нет токена';
    }

    async function fetchBalance() {
        var t = getToken();
        if (!t) { el.textContent = 'Нет токена'; return; }
        try {
            var res = await fetch(C.apiUrl, { headers: { 'Authorization': 'Bearer ' + t } });
            var d = null;
            var ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
                d = await res.json();
            }
            if (C.checkInvalid(res, d)) return handleInvalid();
            if (!res.ok) throw new Error();
            if (!d) throw new Error();
            var n = C.extractBalance(d);
            if (typeof n === 'number') {
                if (C.getCurrency) {
                    var cur = C.getCurrency(d);
                    if (cur) {
                        resolvedCurrency = cur;
                        localStorage.setItem(C.storageKey + '_currency', cur);
                    }
                }
                localStorage.setItem(C.storageKey, n);
                localStorage.setItem(C.lastUpdateKey, Date.now());
                render(n);
            } else throw new Error();
        } catch {
            var s = localStorage.getItem(C.storageKey);
            s !== null ? render(+s) : el.textContent = 'Ошибка';
        }
    }

    function render(n) {
        el.textContent = fmt(n);
        checkAndNotify(n);
        document.title = C.title + ': ' + fmt(n);
    }

    async function update() {
        var lu = localStorage.getItem(C.lastUpdateKey);
        if (!lu) return fetchBalance();
        if ((Date.now() - +lu) / 60000 >= 1) return fetchBalance();
        var s = localStorage.getItem(C.storageKey);
        s !== null ? render(+s) : fetchBalance();
    }

    requestPerm();
    update();
    setInterval(update, 60000);
    addEventListener('visibilitychange', function () { if (!document.hidden) update(); });
})();
