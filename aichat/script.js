const baseURL = "https://api.proxyapi.ru/openai/v1";

let API_KEY = localStorage.getItem('apiKey');
const MODEL = () => document.getElementById('model-selector').value;

const messagesContainer = document.getElementById('messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const dialoguesListEl = document.getElementById('dialogues-list');
const newDialogBtn = document.getElementById('new-dialogue');
const saveDialogBtn = document.getElementById('save-dialog');
const balanceElement = document.getElementById('balance');
const currentModelDisplay = document.getElementById('current-model');
const modelSelect = document.getElementById('model-creator');

const apiModal = document.getElementById('apiModal');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveApiBtn = document.getElementById('saveApiKey');

let conversations = {}; // {dialogName: {title, model, messages[]}}
let currentDialog = null;

// -------------- Обработка API ключа ----------------
if (!API_KEY) {
    document.getElementById('apiModal').style.display = 'flex';
}
document.getElementById('saveApiKey').onclick = () => {
    const key = apiKeyInput.value.trim();
    if (!key) { alert('Введите ключ'); return; }
    API_KEY = key;
    localStorage.setItem('apiKey', key);
    document.getElementById('apiModal').style.display = 'none';
    init();
};
apiKeyInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        e.preventDefault(); document.getElementById('saveApiKey').click();
    }
});

// -------------- Инициализация ----------------
function init() {
    loadData();
    if (Object.keys(conversations).length === 0) {
        const name = 'Диалог 1';
        conversations[name] = { title: name, model: '', messages: [] };
    }
    if (!currentDialog || !conversations[currentDialog]) currentDialog = Object.keys(conversations)[0];
    // Обновляем отображение модели для текущего диалога
    if (conversations[currentDialog].model) {
        currentModelDisplay.innerText = 'Модель: ' + conversations[currentDialog].model;
    } else {
        currentModelDisplay.innerText = 'Модель: —';
    }
    renderDialogs();
    loadConversation(currentDialog);
    fetchBalance();
    // установка текущей модели
    modelSelect.value = conversations[currentDialog].model || '';
}

// ----------- Загрузка и сохранение данных -------------
function loadData() {
    const d = localStorage.getItem('dialogsData');
    if (d) {
        try { conversations = JSON.parse(d); }
        catch (e) { conversations = {}; }
    }
}
function saveData() {
    localStorage.setItem('dialogsData', JSON.stringify(conversations));
}

// ----------- Рендер диалогов -------------
function renderDialogs() {
    dialoguesListEl.innerHTML = '';
    Object.keys(conversations).forEach(name => {
        const dlg = conversations[name];
        const div = document.createElement('div');
        div.className = 'dialogue' + (name === currentDialog ? ' dialogue-active' : '');
        // редактируемое название
        const input = document.createElement('input');
        input.type = 'text'; input.value = dlg.title;
        input.onchange = () => {
            dlg.title = input.value;
            saveData();
            renderDialogs();
        };
        input.onclick = () => { currentDialog = name; loadConversation(name); };
        // Клик по диалогу
        div.onclick = () => {
            currentDialog = name;
            loadConversation(name);
            renderDialogs();
        };
        // Удалить
        const delBtn = document.createElement('button');
        delBtn.innerText = '🗑️'; delBtn.title = 'Удалить';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            delete conversations[name];
            if (currentDialog === name) currentDialog = null;
            saveData();
            renderDialogs();
        };
        // Скачать
        const saveBtn = document.createElement('button');
        saveBtn.innerText = '⬇️'; saveBtn.title = 'Скачать';
        saveBtn.onclick = (e) => {
            e.stopPropagation();
            downloadDialog(name);
        };
        div.appendChild(input);
        div.appendChild(delBtn);
        div.appendChild(saveBtn);
        dialoguesListEl.appendChild(div);
    });
}

// Создать новый диалог
document.getElementById('new-dialogue').onclick = () => {
    let name = prompt('Название диалога');
    if (!name || name.trim() === '') name = 'Диалог ' + (Object.keys(conversations).length + 1);
    if (conversations[name]) {
        alert('Такой диалог уже есть!');
        return;
    }
    // при создании задаем выбранную модель
    const selectedModel = modelSelect.value;
    conversations[name] = { title: name, model: selectedModel, messages: [] };
    currentDialog = name;
    saveData();
    renderDialogs();
    loadConversation(name);
};

// Загрузить диалог
function loadConversation(name) {
    if (!conversations[name]) return;
    messagesContainer.innerHTML = '';
    conversations[name].messages.forEach(m => addMessage(m.content, m.role));
    // Обновляем описание модели и текущее отображение
    const mdl = conversations[name].model || '';
    currentModelDisplay.innerText = 'Модель: ' + (mdl || '—');
    // В селекторе выбора модели - обновим значение (если есть)
    if (mdl) {
        modelSelect.value = mdl;
    } else {
        modelSelect.value = '';
    }
}

// Выбор модели при создании
modelSelect.onchange = () => {
    if (currentDialog && conversations[currentDialog]) {
        conversations[currentDialog].model = modelSelect.value;
        currentModelDisplay.innerText = 'Модель: ' + conversations[currentDialog].model;
        saveData();
    }
}

// Добавление сообщения
function renderMarkdown(md) {
    const html = marked.parse(md);
    setTimeout(() => {
        document.querySelectorAll('.code-block').forEach(block => {
            const btn = block.querySelector('.copy-btn');
            if (btn) {
                btn.onclick = () => {
                    navigator.clipboard.writeText(block.querySelector('code').innerText).catch(() => alert('Копия не поддерживается'));
                };
            }
        });
    }, 0);
    return html;
}

function addMessage(content, role) {
    const div = document.createElement('div');
    div.className = 'message ' + role;
    div.innerHTML = renderMarkdown(content);
    // Обработка блоков кода
    div.querySelectorAll('pre code').forEach(code => {
        const parentPre = code.parentElement;
        const container = document.createElement('div');
        container.className = 'code-container';

        // язык
        const classList = code.className.split(' ');
        let lang = 'код';
        classList.forEach(c => {
            if (c.startsWith('language-')) lang = c.replace('language-', '');
        });
        const langLabel = document.createElement('div');
        langLabel.className = 'lang-label';
        langLabel.innerText = lang;

        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.innerText = 'Копировать';

        container.appendChild(langLabel);
        container.appendChild(copyBtn);
        container.appendChild(code.parentElement.cloneNode(true));
        parentPre.replaceWith(container);
    });
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Отправка сообщения
async function sendMessage(text) {
    if (!conversations[currentDialog]) return;
    const msg = { role: 'user', content: text };
    // Перед отправкой обновляем модель из селектора
    conversations[currentDialog].model = modelSelect.value;
    conversations[currentDialog].messages.push(msg);
    addMessage(text, 'user');

    try {
        const response = await fetch(baseURL + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + API_KEY
            },
            body: JSON.stringify({ model: conversations[currentDialog].model, messages: conversations[currentDialog].messages })
        });
        if (!response.ok) throw new Error('Ошибка сети ' + response.status);
        const data = await response.json();
        const reply = data?.choices?.[0]?.message?.content;
        if (reply) {
            conversations[currentDialog].messages.push({ role: 'assistant', content: reply });
            addMessage(reply, 'bot');
        } else {
            addMessage('Ошибка: не получен ответ от API', 'bot');
        }
    } catch (e) {
        console.error(e);
        addMessage('Произошла ошибка: ' + e.message, 'bot');
    }

    saveCurrent();
    saveData();
}

// Обработчики
document.getElementById('send-btn').onclick = () => {
    const txt = userInput.value.trim();
    if (txt !== '') {
        sendMessage(txt);
        userInput.value = '';
    }
};
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            document.getElementById('send-btn').click();
        } // перенос строки
    }
});

// Баланс
async function fetchBalance() {
    try {
        const resp = await fetch('https://api.proxyapi.ru/proxyapi/balance', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + API_KEY
            }
        });
        if (!resp.ok) throw new Error('Ошибка сети ' + resp.status);
        const data = await resp.json();
        balanceElement.innerText = 'Баланс: ' + (data.balance.toFixed(2)) + ' руб.';
    } catch (e) { console.error(e); }
}

// Инициализация
loadData();
if (Object.keys(conversations).length === 0) {
    const name = 'Диалог 1';
    conversations[name] = { title: name, model: '', messages: [] };
}
if (!currentDialog || !conversations[currentDialog]) currentDialog = Object.keys(conversations)[0];

renderDialogs();
loadConversation(currentDialog);
fetchBalance();

// Создать диалог
document.getElementById('new-dialogue').onclick = () => {
    let name = prompt('Название диалога');
    if (!name || name.trim() === '') name = 'Диалог ' + (Object.keys(conversations).length + 1);
    if (conversations[name]) {
        alert('Такой диалог уже есть!');
        return;
    }
    conversations[name] = { title: name, model: '', messages: [] };
    currentDialog = name;
    saveData();
    renderDialogs();
    loadConversation(name);
};

// Скачать текущий
document.getElementById('save-dialog').onclick = () => {
    downloadDialog(currentDialog);
};

window.onbeforeunload = () => {
    saveCurrent();
    saveData();
};