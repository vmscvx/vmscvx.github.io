// Проверка и запрос API-ключа
let API_KEY = localStorage.getItem('apiKey');

if (!API_KEY) {
    API_KEY = prompt('Введите ваш API-ключ:', '');
    if (API_KEY) {
        localStorage.setItem('apiKey', API_KEY);
    } else {
        alert('API-ключ необходим для работы приложения.');
    }
}

const baseURL = "https://api.proxyapi.ru/openai/v1";

const messagesContainer = document.getElementById('messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const balanceElement = document.getElementById('balance');

let conversationHistory = [];

// Функция для экранирования HTML
function escapeHTML(str) {
    return str.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Обработка Markdown, добавление кнопки копирования
function renderMarkdown(md) {
    const html = marked.parse(md);
    // Вставка обработчиков для кнопок копирования после рендера
    setTimeout(() => {
        document.querySelectorAll('.code-block').forEach(block => {
            const btn = block.querySelector('.copy-btn');
            if (btn) {
                btn.onclick = () => {
                    navigator.clipboard.writeText(block.querySelector('code').innerText).catch(() => {
                        alert('Копирование не поддерживается в вашем браузере');
                    });
                };
            }
        });
    }, 0);
    return html;
}

// Функция добавления сообщения
function addMessage(content, sender, isUserHtml = false) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message ' + sender;

    if (sender === 'user' && isUserHtml) {
        const escapedContent = escapeHTML(content);
        msgDiv.innerHTML = `<pre><code>${escapedContent}</code></pre>`;
    } else {
        msgDiv.innerHTML = renderMarkdown(content);
    }

    // Обработка блоков кода внутри сообщения
    msgDiv.querySelectorAll('pre code').forEach(codeElem => {
        const parentPre = codeElem.parentElement;
        const container = document.createElement('div');
        container.className = 'code-container';

        // Определение языка
        const classList = codeElem.className.split(' ');
        let lang = 'код';
        classList.forEach(c => {
            if (c.startsWith('language-')) {
                lang = c.replace('language-', '');
            }
        });

        // Создаем метку языка
        const langLabel = document.createElement('div');
        langLabel.className = 'lang-label';
        langLabel.innerText = lang;
        container.appendChild(langLabel);

        // Создаем кнопку копирования
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.innerText = 'Копировать';
        container.appendChild(copyBtn);

        // Назначаем обработчик копирования
        copyBtn.onclick = () => {
            const codeBlock = container.querySelector('pre code') || container.querySelector('code');
            if (codeBlock) {
                navigator.clipboard.writeText(codeBlock.innerText).catch(() => {
                    alert('Копирование не поддерживается в вашем браузере');
                });
            } else {
                alert('Код для копирования не найден');
            }
        };

        // Вставляем склонированный блок кода (оборачиваем в контейнер)
        const codeClone = codeElem.parentElement.cloneNode(true);
        container.appendChild(codeClone);

        // Заменяем старый <pre><code> на новый контейнер
        parentPre.replaceWith(container);
    });

    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Отправка сообщения
async function sendMessage(text) {
    const userMsg = { role: "user", content: text };
    conversationHistory.push(userMsg);
    addMessage(text, 'user', true); // показать как текст

    try {
        const response = await fetch(baseURL + "/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + API_KEY
            },
            body: JSON.stringify({
                model: "gpt-4.1-nano",
                messages: conversationHistory
            })
        });
        if (!response.ok) throw new Error("Ошибка сети: " + response.status);
        const data = await response.json();
        const botMsg = data?.choices?.[0]?.message?.content;

        if (botMsg) {
            const botMessage = { role: "assistant", content: botMsg };
            conversationHistory.push(botMessage);
            addMessage(botMsg, 'bot');
        } else {
            addMessage("Ошибка: не получен ответ от API", 'bot');
        }
    } catch (err) {
        console.error('Ошибка:', err);
        addMessage("Произошла ошибка: " + err.message, 'bot');
    }
}

// Обработка нажатий на кнопку отправки
sendBtn.onclick = () => {
    const text = userInput.value.trim();
    if (text) {
        sendMessage(text);
        userInput.value = '';
    }
};

// Обработка Enter (с Ctrl или Cmd для новой строки)
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            sendBtn.click();
        }
    }
});

// Получение баланса
async function fetchBalance() {
    try {
        const response = await fetch('https://api.proxyapi.ru/proxyapi/balance', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + API_KEY
            }
        });
        if (!response.ok) throw new Error('Сетевая ошибка: ' + response.status);
        const data = await response.json();
        balanceElement.textContent = `Баланс: ${data.balance.toFixed(2)} руб.`;
    } catch (error) {
        console.error('Ошибка при получении баланса:', error);
    }
}

fetchBalance();
setInterval(fetchBalance, 60000);