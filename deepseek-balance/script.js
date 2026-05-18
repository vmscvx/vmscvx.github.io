(function () {
    const KEYS = {
        balance: 'deepseek_balance',
        token: 'deepseek_token',
        lastUpdate: 'deepseek_balance_last_update'
    };

    const el = document.getElementById('balance');
    let lastBalance = null;
    let lastNotified = null;

    function fmt(n) {
        const parts = Number(n).toFixed(2).replace('.', ',').split(',');
        let intPart = parts[0], sign = '';
        if (intPart.startsWith('-')) { sign = '-'; intPart = intPart.slice(1); }
        return sign + intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (parts[1] ? ',' + parts[1] : '');
    }

    function requestPerm() {
        if (Notification.permission === 'default') Notification.requestPermission();
    }

    function notify(title, n) {
        if (Notification.permission !== 'granted') return;
        new Notification(title, { body: 'Текущий баланс: ' + fmt(n) });
    }

    function checkAndNotify(n) {
        if (lastBalance !== null && lastNotified !== null && Math.abs(n - lastNotified) >= 10) {
            notify('Изменение баланса DeepSeek', n);
            lastNotified = n;
        } else if (lastNotified === null) {
            lastNotified = n;
        }
        lastBalance = n;
    }

    function token() {
        let t = localStorage.getItem(KEYS.token);
        if (!t) {
            t = prompt('Введите API-ключ');
            if (t) localStorage.setItem(KEYS.token, t);
        }
        return t;
    }

    async function fetchBalance() {
        const t = token();
        if (!t) { el.textContent = 'Нет токена'; return; }
        try {
            const res = await fetch('https://api.deepseek.com/user/balance', {
                headers: { 'Authorization': 'Bearer ' + t }
            });
            if (res.status === 401) return handleInvalid();
            if (!res.ok) throw new Error();
            const d = await res.json();
            if (d.balance_infos?.[0]?.total_balance) {
                const n = parseFloat(d.balance_infos[0].total_balance);
                localStorage.setItem(KEYS.balance, n);
                localStorage.setItem(KEYS.lastUpdate, Date.now());
                render(n);
            } else throw new Error();
        } catch {
            const s = localStorage.getItem(KEYS.balance);
            s !== null ? render(+s) : el.textContent = 'Ошибка';
        }
    }

    function handleInvalid() {
        alert('API-ключ недействителен или истёк. Пожалуйста, введите новый ключ.');
        localStorage.removeItem(KEYS.token);
        const t = prompt('Введите API-ключ');
        t ? (localStorage.setItem(KEYS.token, t), fetchBalance()) : el.textContent = 'Нет токена';
    }

    function render(n) {
        el.textContent = fmt(n);
        checkAndNotify(n);
        document.title = 'Баланс DeepSeek: ' + fmt(n);
    }

    async function update() {
        const lu = localStorage.getItem(KEYS.lastUpdate);
        if (!lu) return fetchBalance();
        if ((Date.now() - +lu) / 60000 >= 1) return fetchBalance();
        const s = localStorage.getItem(KEYS.balance);
        s !== null ? render(+s) : fetchBalance();
    }

    requestPerm();
    update();
    setInterval(update, 60000);
    addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
})();
