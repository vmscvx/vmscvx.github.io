$(function () {
    const fileTypes = ['-', 'd', 'l', 'c', 'b', 's', 'p'];

    // Парсим строковый режим
    function parseSymbolic(str) {
        str = str.trim();
        if (str.length < 10) return null;
        let typeChar = str[0];
        if (!fileTypes.includes(typeChar)) typeChar = '-';
        let perms = str.slice(1, 10);
        let parts = [perms.slice(0, 3), perms.slice(3, 6), perms.slice(6, 9)];

        let flags = { user: {}, group: {}, others: {} };
        ['user', 'group', 'others'].forEach((e, i) => {
            flags[e].read = parts[i][0] === 'r';
            flags[e].write = parts[i][1] === 'w';
            flags[e].execute = ['x', 's', 't'].includes(parts[i][2]);
        });
        return { flags, typeChar };
    }

    // Парсим числовой режим (3-4 цифры)
    function parseNumeric(s) {
        s = s.trim();
        if (!/^[0-7]{3,4}$/.test(s)) return null;
        let special = 0;
        if (s.length === 4) {
            special = parseInt(s[0], 8);
            s = s.slice(1);
        }
        let dig = [...s].map(c => parseInt(c, 8));
        let flags = {};
        ['user', 'group', 'others'].forEach((e, i) => {
            flags[e] = {
                read: !!(dig[i] & 4),
                write: !!(dig[i] & 2),
                execute: !!(dig[i] & 1)
            };
        });
        return { flags, special };
    }

    // Флаги в строку
    function flagsToString(f) {
        return ['user', 'group', 'others'].map(e =>
            (f[e].read ? 'r' : '-') + (f[e].write ? 'w' : '-') + (f[e].execute ? 'x' : '-')
        ).join('');
    }

    // Флаги в цифры
    function flagsToNumeric(f, special = 0) {
        let dig = ['user', 'group', 'others'].map(e => {
            let v = 0;
            if (f[e].read) v |= 4;
            if (f[e].write) v |= 2;
            if (f[e].execute) v |= 1;
            return v;
        });
        return special > 0 ? special + dig.join('') : dig.join('');
    }

    // Обновить чекбоксы
    function updateChecks(f) {
        $('.flag').each(function () {
            let $c = $(this), t = $c.data('type'), p = $c.data('perm');
            $c.prop('checked', f[t][p]);
        });
    }

    // Обновить все поля
    let busy = false;
    function updateAll(f, special = 0, typeChar = '-') {
        if (busy) return;
        busy = true;
        let str = typeChar + flagsToString(f);
        let num = flagsToNumeric(f, special);

        if (!$('#modeString').is(':focus')) $('#modeString').val(str);
        if (!$('#modeNumber').is(':focus')) $('#modeNumber').val(num);
        updateChecks(f);
        $('#resultString').text(str);
        $('#resultNumber').val(num);
        busy = false;
    }

    // Считать флаги из чекбоксов
    function getFlagsFromChecks() {
        let flags = { user: {}, group: {}, others: {} };
        $('.flag').each(function () {
            let $c = $(this);
            flags[$c.data('type')][$c.data('perm')] = $c.prop('checked');
        });
        return flags;
    }

    // События
    $('#modeString').on('input', function () {
        if (busy) return;
        let val = $(this).val();
        let parsed = parseSymbolic(val);
        if (parsed) updateAll(parsed.flags, 0, parsed.typeChar);
    });
    $('#modeNumber').on('input', function () {
        if (busy) return;
        let val = $(this).val();
        if (val.length > 4) val = val.slice(0, 4);
        let parsed = parseNumeric(val);
        if (parsed) updateAll(parsed.flags, parsed.special, '-');
    });
    $('.flag').on('change', function () {
        if (busy) return;
        updateAll(getFlagsFromChecks(), 0, '-');
    });

    // Стартовое значение
    $('#modeNumber').val('644').trigger('input');
});