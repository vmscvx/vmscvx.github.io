window.BALANCE_CONFIG = {
    storageKey: 'proxyapi_balance',
    tokenKey: 'proxyapi_token',
    lastUpdateKey: 'proxyapi_balance_last_update',
    apiUrl: 'https://api.proxyapi.ru/proxyapi/balance',
    title: 'Баланс ProxyAPI',
    notificationTitle: 'Изменение баланса ProxyAPI',
    notificationThreshold: 10,
    currency: '₽',
    currencyBefore: false,
    checkInvalid: function (res, d) { return res.status === 401 || (d && d.detail === 'Invalid API Key'); },
    extractBalance: function (d) { return d.balance; }
};
