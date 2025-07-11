document.addEventListener("DOMContentLoaded", async function () {
    const theme = prompt("Укажите тему:", "Мороженое");
    if (!theme) {
        document.getElementById('content').innerHTML = "<p>Тема не указана.</p>";
        return;
    }

    const endpoint = "https://text.pollinations.ai/openai/v1/chat/completions";

    const contentPrompt = `Создай страницу лендинг на тему: "${theme}". Постарайся красиво и подробно всё описать. В ответе только код HTML, CSS и JavaScript (если нужен), без комментариев. Не используй markdown, сразу дай код HTML.`;

    try {
        const contentResponse = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "openai-fast",
                messages: [{ role: "user", content: contentPrompt }],
            }),
        });

        const contentData = await contentResponse.json();
        if (contentData.choices && contentData.choices.length > 0) {

            let rawContent = contentData.choices[0].message.content.trim();
            const cutIndex = rawContent.indexOf('---\n\n**Sponsor**');
            if (cutIndex !== -1) {
                rawContent = rawContent.substring(0, cutIndex).trim();
            }
            if (rawContent.startsWith('```html')) {
                rawContent = rawContent.substring('```html'.length).trim();
            }
            if (rawContent.endsWith('```')) {
                rawContent = rawContent.substring(0, rawContent.length - '```'.length).trim();
            }

            const iframeContainer = document.getElementById('iframe-container');
            const iframe = document.getElementById('output-frame');

            iframe.srcdoc = generatedContent;

            iframeContainer.style.display = 'block';
            document.getElementById('content').style.display = 'none';

            const titlePrompt = `Создай заголовок для страницы на основе следующего текста: """${generatedContent}""" В ответе дай только заголовок, ничего лишнего.`;

            const titleResponse = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: "openai-fast",
                    messages: [{ role: "user", content: titlePrompt }],
                }),
            });

            const titleData = await titleResponse.json();
            const pageTitle = titleData.choices && titleData.choices.length > 0 ? titleData.choices[0].message.content.trim() : "Страница на тему";
            document.title = pageTitle;

        } else {
            document.getElementById('content').innerHTML = "<p>Не удалось получить содержимое.</p>";
        }
    } catch (error) {
        console.error("Ошибка при вызове API:", error);
        document.getElementById('content').innerHTML = "<p>Произошла ошибка при загрузке данных.</p>";
    }
});