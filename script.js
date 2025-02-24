// Асинхронная функция для загрузки banner.txt
async function loadBanner(url = 'banner.txt') {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Ошибка загрузки баннера: ${response.statusText}`);
        }
        return await response.text();
    } catch (error) {
        console.error(error);
        return ''; // Возвращаем пустую строку или значение по умолчанию в случае ошибки
    }
}

// Основная функция для формирования подписи
async function getSignature() {
    // Загружаем banner.txt
    const banner = await loadBanner();

    // Кэшируем элементы DOM
    const nameEl = document.getElementById('name');
    const roleEl = document.getElementById('role');
    const addressEl = document.getElementById('address');
    const mailEl = document.getElementById('mail');
    const phone1El = document.getElementById('phone1');
    const phone2El = document.getElementById('phone2');
    const signatureEl = document.getElementById('signature');
    const iframe = document.getElementById('signaturePreview');
    const previewContainer = document.querySelector('.preview-container');

    // Получаем значения, подставляя значение по умолчанию, если поле пустое
    const fullname = getStringOrTemplate(nameEl.value, 'ФИО');
    const roleValue = roleEl.value;
    const role = roleValue ? `<p style="font-weight:700;margin:5px 0">${roleValue}</p>` : '';
    const address = getStringOrTemplate(addressEl.value, 'Адрес');
    const mail = getStringOrTemplate(mailEl.value, 'sale@volt-market.com');

    // Форматируем номера телефонов
    const phone1 = getFormattedPhoneString(phone1El.value);
    const phone2 = getFormattedPhoneString(phone2El.value);
    const phones = phone1 + phone2;

    // Формируем основной HTML для подписи
    const cred = `<div style="font-family:Calibri,sans-serif"><div style="border-left:3px solid #fd9c12;padding-left:10px"><p style="font-weight:700;margin:0">С уважением,</p><p style="font-weight:700;margin:0">${fullname}</p>${role}<p style="margin:5px 0">${address}</p><p style="margin:5px 0">Компания "Вольтмаркет"</p><p style="margin:5px 0">Телефон: <a href="tel:88005501161" style="color:#fd9c12;text-decoration:none">8 (800) 550-11-61</a></p>${phones}<p style="margin:5px 0">E-mail: <a href="mailto:${mail}" style="color:#fd9c12;text-decoration:none">${mail}</a></p></div></div>`;

    // Объединяем основную часть и banner
    const signature = cred + banner;

    // Выводим подпись в textarea
    signatureEl.value = signature;

    // Записываем HTML-подпись в iframe для предпросмотра
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    iframeDoc.open();
    iframeDoc.write(`<!DOCTYPE html>${signature}`);
    iframeDoc.close();

    // Делает блок предпросмотра видимым
    previewContainer.style.display = 'block';

    // Выделение содержимого textarea и копирование в буфер обмена
    signatureEl.select();
    document.execCommand('copy');
}

// Функция возвращает исходное значение, если оно не пустое, или шаблон по умолчанию
const getStringOrTemplate = (str, template) =>
    str?.trim().length ? str : template;

// Функция для форматирования номера телефона
function getFormattedPhoneString(phoneNumber) {
    const cleaned = phoneNumber.replace(/\D/g, '');

    if (cleaned.length === 11 && /^[78]/.test(cleaned)) {
        const formatted = `+7 (${cleaned.substring(1, 4)}) ${cleaned.substring(4, 7)}-${cleaned.substring(7, 9)}-${cleaned.substring(9, 11)}`;
        return `<p style="margin:5px 0">Мобильный (WhatsApp/Viber): <a href="tel:+${cleaned}" style="color:#fd9c12;text-decoration:none">${formatted}</a></p>`;
    }
    return '';
}