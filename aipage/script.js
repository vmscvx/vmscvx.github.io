(async () => {
    const setTitle = t => document.title = t;
    setTitle("Генерация страницы...");
    const theme = prompt("Укажите тему для лендинга:", "Эверест");
    if (!theme) {
        setTitle("Тема не указана");
        document.getElementById("content").innerHTML = "<p>Тема не указана.</p>";
        return;
    }

    const endpoint = "https://text.pollinations.ai/openai/v1/chat/completions";
    const contentPrompt = `
Создай полноценный, красивый и подробный лендинг на тему: "${theme}".
Опиши все важные аспекты, используйте яркие и живые детали, создайте привлекательный дизайн с тщательно проработанными стилями.
Обязательно добавь поддержку тёмной и светлой темы с использованием CSS медиа запроса prefers-color-scheme.
Сделай страницу информативной, визуально насыщенной и удобной для чтения на любых устройствах.
Включи HTML, CSS и необходимый JavaScript для интерактивности.
В ответе пришли только валидный и самодостаточный HTML документ без дополнительных комментариев, объяснений или markdown-разметки.
`.trim();

    try {
        setTitle("Загрузка контента...");
        const res = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "openai-fast",
                messages: [{ role: "user", content: contentPrompt }]
            })
        });
        const data = await res.json();

        if (!data.choices?.length) throw new Error("Пустой ответ");

        setTitle("Обработка содержимого...");
        let rawContent = data.choices[0].message.content.trim();

        let sponsorLink = null;
        const sponsorIndex = rawContent.indexOf('---\n\n**Sponsor**');
        if (sponsorIndex !== -1) {
            const sponsorPart = rawContent.slice(sponsorIndex);
            const linkMatch = sponsorPart.match(/\[.*?\]\((https?:\/\/[^\s)]+)\)/);
            if (linkMatch) sponsorLink = linkMatch[1];
            rawContent = rawContent.slice(0, sponsorIndex).trim();
        }

        if (rawContent.startsWith("```html")) rawContent = rawContent.slice(7).trim();
        if (rawContent.endsWith("```")) rawContent = rawContent.slice(0, -3).trim();

        const iframeContainer = document.getElementById("iframe-container");
        const iframe = document.getElementById("output-frame");
        iframe.srcdoc = rawContent;
        iframeContainer.style.display = "block";
        requestAnimationFrame(() => iframeContainer.classList.add("visible"));
        document.getElementById("content").style.display = "none";

        const btn = document.getElementById("download-button");
        btn.style.display = "flex";

        setTitle("Генерация заголовка...");
        const titlePrompt = `
Придумай полноценный, информативный, но лаконичный заголовок для лендинга, основанного на следующем HTML-коде:
"""${rawContent}"""
Дай ответ только в виде заголовка без лишних пояснений или символов.
`.trim();

        const titleRes = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "openai-fast",
                messages: [{ role: "user", content: titlePrompt }]
            })
        });
        const titleData = await titleRes.json();
        const pageTitle = titleData.choices?.[0]?.message?.content.trim() || "Сгенерированная страница";
        setTitle(pageTitle);

        btn.onclick = () => {
            const blob = new Blob([rawContent], { type: "text/html" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = pageTitle.replace(/[\\\/:*?"<>|]/g, "_") + ".html";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            if (sponsorLink) {
                window.open(sponsorLink, "_blank", "noopener,noreferrer");
            }
        };

    } catch (e) {
        setTitle("Ошибка загрузки данных");
        document.getElementById("content").innerHTML = "<p>Ошибка при загрузке данных.</p>";
        console.error(e);
    }
})();