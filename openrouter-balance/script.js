window.BALANCE_CONFIG = {
    storageKey: 'openrouter_balance',
    tokenKey: 'openrouter_token',
    lastUpdateKey: 'openrouter_balance_last_update',
    apiUrl: 'https://openrouter.ai/api/v1/credits',
    title: 'Баланс OpenRouter',
    notificationTitle: 'Изменение баланса OpenRouter',
    notificationThreshold: 0.1,
    currency: '$',
    currencyBefore: true,
    checkInvalid: function (res, d) { return res.status === 401; },
    extractBalance: function (d) { return d.data.total_credits - d.data.total_usage; }
};
