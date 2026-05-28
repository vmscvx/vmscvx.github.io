window.BALANCE_CONFIG = {
    storageKey: 'deepseek_balance',
    tokenKey: 'deepseek_token',
    lastUpdateKey: 'deepseek_balance_last_update',
    apiUrl: 'https://api.deepseek.com/user/balance',
    title: 'Баланс DeepSeek',
    notificationTitle: 'Изменение баланса DeepSeek',
    notificationThreshold: 0.1,
    currency: '$',
    currencyBefore: true,
    checkInvalid: function (res, d) { return res.status === 401; },
    extractBalance: function (d) { return parseFloat(d.balance_infos[0].total_balance); },
    getCurrency: function (d) {
        var code = d.balance_infos[0].currency;
        if (!code) return null;
        var CUR_MAP = { 'CNY': '¥', 'USD': '$', 'EUR': '€', 'RUB': '₽', 'GBP': '£', 'JPY': '¥', 'KRW': '₩' };
        return CUR_MAP[code] || code;
    }
};
