(function () {
    const BALANCE_KEY = 'balance';
    const TOKEN_KEY = 'proxyapi_token';
    const LAST_UPDATE_KEY = 'balance_last_update';

    const balanceElem = document.getElementById('balance');
    let lastBalanceNumber = null;
    let lastNotifiedBalance = null;

    // Форматирует число: два знака после запятой, запятая, пробелы для тысяч
    function formatBalance(number) {
        let numStr = Number(number).toFixed(2).replace('.', ',');
        return insertThousandSpaces(numStr);
    }

    function insertThousandSpaces(numberStr) {
        const parts = numberStr.split(',');
        let integerPart = parts[0];
        const decimalPart = parts[1] || '';
        let sign = '';
        if (integerPart.startsWith('-')) {
            sign = '-';
            integerPart = integerPart.slice(1);
        }
        integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        return sign + integerPart + (decimalPart ? ',' + decimalPart : '');
    }

    // Просим разрешение только если не решено (default)
    function requestNotificationPermission() {
        if (Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    // Показывает нотификацию (если возможно), текст форматирован как на странице
    function showNotification(title, balanceNumber) {
        if (Notification.permission === 'granted') {
            const formattedBalance = formatBalance(balanceNumber);
            new Notification(title, { body: `Текущий баланс: ${formattedBalance}` });
        }
    }

    // Проверяет изменение баланса и отправляет нотификацию при необходимости
    function checkBalanceAndNotify(newBalanceNumber) {
        if (lastBalanceNumber !== null && lastNotifiedBalance !== null) {
            const diff = Math.abs(newBalanceNumber - lastNotifiedBalance);
            if (diff >= 10) {
                showNotification('Изменение баланса ProxyAPI', newBalanceNumber);
                lastNotifiedBalance = newBalanceNumber;
            }
        } else {
            lastNotifiedBalance = newBalanceNumber;
        }
        lastBalanceNumber = newBalanceNumber;
    }

    function displayBalance(balanceNumber) {
        balanceElem.textContent = formatBalance(balanceNumber);
    }

    // Получает или просит у пользователя токен
    function getToken() {
        let token = localStorage.getItem(TOKEN_KEY);
        if (!token) {
            token = prompt('Введите API-ключ');
            if (token) {
                localStorage.setItem(TOKEN_KEY, token);
            }
        }
        return token;
    }

    // Обрабатывает получение баланса через API
    async function fetchBalance() {
        const token = getToken();
        if (!token) {
            balanceElem.textContent = 'Нет токена';
            return;
        }

        try {
            const response = await fetch('https://api.proxyapi.ru/proxyapi/balance', {
                headers: { 'Authorization': 'Bearer ' + token }
            });

            if (response.status === 401) {
                handleInvalidToken();
                return;
            }

            if (!response.ok) throw new Error('Ошибка сети или сервера');
            const data = await response.json();

            if (data.detail && data.detail === 'Invalid API Key') {
                handleInvalidToken();
                return;
            }

            if (typeof data.balance === 'number') {
                localStorage.setItem(BALANCE_KEY, data.balance);
                localStorage.setItem(LAST_UPDATE_KEY, Date.now().toString());
                updateBalanceOnPage(data.balance);
            } else {
                throw new Error('Некорректный ответ');
            }
        } catch (e) {
            console.warn(e);
            const storedBalance = localStorage.getItem(BALANCE_KEY);
            if (storedBalance !== null) {
                updateBalanceOnPage(Number(storedBalance));
            } else {
                balanceElem.textContent = 'Ошибка';
            }
        }
    }

    function handleInvalidToken() {
        alert('API-ключ недействителен или истёк. Пожалуйста, введите новый ключ.');
        localStorage.removeItem(TOKEN_KEY);
        const newToken = prompt('Введите API-ключ');
        if (newToken) {
            localStorage.setItem(TOKEN_KEY, newToken);
            fetchBalance();
        } else {
            balanceElem.textContent = 'Нет токена';
        }
    }

    function updateBalanceOnPage(balanceNumber) {
        displayBalance(balanceNumber);
        checkBalanceAndNotify(balanceNumber);
        document.title = `Баланс ProxyAPI: ${formatBalance(balanceNumber)}`;
    }

    async function updateIfNeeded() {
        const lastUpdate = localStorage.getItem(LAST_UPDATE_KEY);
        const now = Date.now();
        if (lastUpdate) {
            const diffMin = (now - parseInt(lastUpdate, 10)) / 60000;
            if (diffMin >= 1) {
                await fetchBalance();
            } else {
                const storedBalance = localStorage.getItem(BALANCE_KEY);
                if (storedBalance !== null) {
                    updateBalanceOnPage(Number(storedBalance));
                } else {
                    await fetchBalance();
                }
            }
        } else {
            await fetchBalance();
        }
    }

    // Запуск
    requestNotificationPermission();
    updateIfNeeded();

    setInterval(updateIfNeeded, 60000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) updateIfNeeded();
    });
})();