(function () {
    'use strict';

    const DATA_URL = 'https://raw.githubusercontent.com/vmscvx/updates/refs/heads/main/data.txt';
    const BARCODE_START = 2000000000000n;
    const DB_NAME = 'uniel-info-db';
    const STORE_NAME = 'store';
    const DB_KEY = 'db';
    const WEEK_SECONDS = 7 * 24 * 60 * 60;

    const $start = $('#start-scan');
    const $overlay = $('#overlay');
    const $scannerContainer = $('#scanner-container');
    const $close = $('#close-scan');
    const $torch = $('#torch-toggle');
    const $scannerStatus = $('#scanner-status');
    const $result = $('#result-modal');
    const $barcodeText = $('#barcode-text');
    const $articleText = $('#article-text');
    const $ok = $('#ok-btn');
    const $rescan = $('#rescan-btn');
    const $globalLoader = $('#global-loader');

    let detector = null;
    let videoEl = null;
    let stream = null;
    let rafId = null;
    let lastDetected = null;
    let detectCooldown = null;
    let currentTrack = null;
    let torchSupported = false;
    let torchOn = false;
    let quaggaActive = false;

    let dbReadyPromise = null;
    let dbBarcodes = null;
    let dbArticles = null;

    function idbOpen() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = function () {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function idbGet(key) {
        return new Promise(async (resolve, reject) => {
            try {
                const db = await idbOpen();
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const r = store.get(key);
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => reject(r.error);
            } catch (e) { reject(e); }
        });
    }

    function idbPut(key, value) {
        return new Promise(async (resolve, reject) => {
            try {
                const db = await idbOpen();
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const r = store.put(value, key);
                r.onsuccess = () => resolve();
                r.onerror = () => reject(r.error);
            } catch (e) { reject(e); }
        });
    }

    function idbDelete(key) {
        return new Promise(async (resolve, reject) => {
            try {
                const db = await idbOpen();
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const r = store.delete(key);
                r.onsuccess = () => resolve();
                r.onerror = () => reject(r.error);
            } catch (e) { reject(e); }
        });
    }

    function formatEAN13(code) {
        const d = (code || '').replace(/\D/g, '');
        if (d.length !== 13) return code;
        return d[0] + ' ' + d.slice(1, 7) + ' ' + d.slice(7);
    }

    function showOverlay() { $overlay.css('display', 'flex').attr('aria-hidden', 'false'); }
    function hideOverlay() { $overlay.css('display', 'none').attr('aria-hidden', 'true'); }
    function showGlobalLoader() { $globalLoader.css('display', 'flex').attr('aria-hidden', 'false'); }
    function hideGlobalLoader() { $globalLoader.css('display', 'none').attr('aria-hidden', 'true'); }
    function showResult(barcode, article) {
        $barcodeText.text(formatEAN13(barcode));
        $articleText.text(article ? ('Код: ' + article) : 'Не найдено');
        $result.show().attr('aria-hidden', 'false');
    }
    function hideResult() { $result.hide().attr('aria-hidden', 'true'); }
    function updateTorchUI() {
        if (torchSupported) {
            $torch.prop('disabled', false).text(torchOn ? 'Фонарик: Вкл' : 'Фонарик: Выкл');
        } else {
            $torch.prop('disabled', true).text('Фонарик недоступен');
        }
    }

    async function openScanner() {
        lastDetected = null;
        detectCooldown = null;
        currentTrack = null;
        torchSupported = false;
        torchOn = false;
        updateTorchUI();
        $scannerContainer.empty().append('<div class="viewfinder" aria-hidden="true"></div>');
        showOverlay();
        $scannerStatus.text('');
        detector = null;
        if (window.BarcodeDetector) {
            try {
                let supported = [];
                if (typeof BarcodeDetector.getSupportedFormats === 'function') {
                    supported = await BarcodeDetector.getSupportedFormats();
                }
                if (supported.length === 0 || supported.includes('ean_13') || supported.includes('ean')) {
                    try { detector = new BarcodeDetector({ formats: ['ean_13'] }); }
                    catch (e) { try { detector = new BarcodeDetector(); } catch (e2) { detector = null; } }
                }
            } catch (e) { detector = null; }
        }
        if (detector) {
            startWithBarcodeDetector();
        } else {
            startWithQuagga();
        }
    }

    async function startWithBarcodeDetector() {
        try {
            videoEl = document.createElement('video');
            videoEl.setAttribute('playsinline', '');
            videoEl.setAttribute('muted', '');
            videoEl.autoplay = true;
            $scannerContainer.append(videoEl);
            const constraints = { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } };
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            videoEl.srcObject = stream;
            const tracks = stream.getVideoTracks();
            if (tracks && tracks.length) {
                currentTrack = tracks[0];
                checkTorchSupport(currentTrack);
            }
            await new Promise((resolve, reject) => {
                const t = setTimeout(() => reject(new Error('Видео не загрузилось')), 7000);
                videoEl.onloadedmetadata = () => { clearTimeout(t); videoEl.play().then(resolve).catch(resolve); };
            });
            rafId = requestAnimationFrame(detectBarcodeFrame);
        } catch (err) {
            startWithQuagga();
        }
    }

    async function detectBarcodeFrame() {
        try {
            if (!videoEl || videoEl.readyState < 2) {
                rafId = requestAnimationFrame(detectBarcodeFrame);
                return;
            }
            let barcodes = [];
            try { barcodes = await detector.detect(videoEl); } catch (e) { barcodes = []; }
            if (barcodes && barcodes.length) {
                for (const b of barcodes) {
                    const raw = b.rawValue || (b.rawData && new TextDecoder().decode(b.rawData)) || '';
                    if (/^\d{13}$/.test(raw)) {
                        if (lastDetected === raw) break;
                        lastDetected = raw;
                        if (detectCooldown) break;
                        detectCooldown = setTimeout(() => { detectCooldown = null; }, 600);
                        await onBarcodeRecognized(raw);
                        return;
                    }
                }
            }
        } finally {
            rafId = requestAnimationFrame(detectBarcodeFrame);
        }
    }

    function startWithQuagga() {
        $scannerContainer.empty();
        const $qc = $('<div id="quagga-container"></div>').css({ width: '100%', height: '100%' });
        $scannerContainer.append($qc);
        if (!window.Quagga) {
            $scannerStatus.text('Сканер недоступен');
            return;
        }
        const config = {
            inputStream: {
                name: "Live",
                type: "LiveStream",
                target: $qc[0],
                constraints: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
                area: { top: "15%", right: "5%", left: "5%", bottom: "15%" }
            },
            locator: { patchSize: "medium", halfSample: true },
            decoder: { readers: ["ean_reader"] },
            locate: true,
            numOfWorkers: (navigator.hardwareConcurrency ? Math.max(1, Math.floor(navigator.hardwareConcurrency / 2)) : 2)
        };
        window.Quagga.init(config, function (err) {
            if (err) {
                $scannerStatus.text('Ошибка инициализации сканера');
                return;
            }
            window.Quagga.start();
            quaggaActive = true;
            $scannerStatus.text('Сканер запущен');
            window.Quagga.onDetected(async (result) => {
                if (!result || !result.codeResult || !result.codeResult.code) return;
                const code = result.codeResult.code;
                if (!/^\d{13}$/.test(code)) return;
                if (lastDetected === code) return;
                lastDetected = code;
                if (detectCooldown) return;
                detectCooldown = setTimeout(() => { detectCooldown = null; }, 600);
                setTimeout(() => {
                    try {
                        const v = $qc.find('video')[0];
                        if (v && v.srcObject) {
                            const tracks = v.srcObject.getVideoTracks();
                            if (tracks && tracks.length) {
                                currentTrack = tracks[0];
                                checkTorchSupport(currentTrack);
                            }
                        }
                    } catch (e) { }
                }, 500);
                await onBarcodeRecognized(code);
            });
        });
    }

    async function onBarcodeRecognized(code) {
        try {
            showGlobalLoader();
            await ensureDatabaseLoaded();
            const article = findArticleByBarcode(code);
            stopAll();
            hideOverlay();
            hideGlobalLoader();
            showResult(code, article);
        } catch (err) {
            hideGlobalLoader();
            stopAll();
            hideOverlay();
            alert('Ошибка поиска: ' + (err && err.message ? err.message : err));
        }
    }

    async function fetchRemoteTimestampSmall() {
        try {
            const r = await fetch(DATA_URL, { headers: { 'Range': 'bytes=0-512' } });
            if (!r.ok && r.status !== 206) {
                if (r.status === 200) {
                    const text = await r.text();
                    const first = text.split(/\r?\n/)[0];
                    const n = parseInt(first, 10);
                    if (!isNaN(n)) return n;
                }
                return null;
            }
            const text = await r.text();
            const first = text.split(/\r?\n/)[0];
            const n = parseInt(first, 10);
            if (!isNaN(n)) return n;
            return null;
        } catch (e) {
            return null;
        }
    }

    async function fetchFullAndParseAndStore() {
        const resp = await fetch(DATA_URL);
        if (!resp.ok) throw new Error('Не удалось загрузить базу: ' + resp.status);
        const text = await resp.text();
        const lines = text.split(/\r?\n/);
        if (lines.length < 2) throw new Error('Некорректный формат базы');
        const timestamp = parseInt(lines[0].trim(), 10);
        if (isNaN(timestamp)) throw new Error('Некорректный timestamp');
        const dataLines = lines.slice(1).filter(l => l && l.trim().length > 0);
        const barcodesStr = new Array(dataLines.length);
        const articles = new Array(dataLines.length);
        let cum = 0n;
        for (let i = 0; i < dataLines.length; i++) {
            const line = dataLines[i].trim();
            const parts = line.split(';');
            const delta = BigInt(parts[0].trim());
            const article = parts[1] ? parts.slice(1).join(';').trim() : null;
            cum += delta;
            const barcode = BARCODE_START + cum;
            barcodesStr[i] = barcode.toString();
            articles[i] = article && article.length ? article : null;
        }
        await idbPut(DB_KEY, { timestamp: timestamp, barcodes: barcodesStr, articles: articles });
        dbBarcodes = barcodesStr.map(s => BigInt(s));
        dbArticles = articles;
    }

    function loadCacheToMemory(cached) {
        if (!cached) return;
        dbBarcodes = (cached.barcodes || []).map(s => BigInt(s));
        dbArticles = cached.articles || [];
    }

    function ensureDatabaseLoaded() {
        if (dbReadyPromise) return dbReadyPromise;
        dbReadyPromise = (async () => {
            showGlobalLoader();
            try {
                const cached = await idbGet(DB_KEY);
                if (!cached) {
                    await fetchFullAndParseAndStore();
                    hideGlobalLoader();
                    return;
                }
                loadCacheToMemory(cached);
                const remoteTs = await fetchRemoteTimestampSmall();
                if (remoteTs === null) {
                    hideGlobalLoader();
                    return;
                }
                const localTs = cached.timestamp || 0;
                if (remoteTs > localTs + WEEK_SECONDS) {
                    await fetchFullAndParseAndStore();
                }
            } finally {
                hideGlobalLoader();
            }
        })();
        return dbReadyPromise;
    }

    function findArticleByBarcode(barcodeStr) {
        if (!dbBarcodes || !dbArticles) return null;
        const codeDigits = (barcodeStr || '').replace(/\D/g, '');
        if (!/^\d{13}$/.test(codeDigits)) return null;
        const target = BigInt(codeDigits);
        let lo = 0, hi = dbBarcodes.length - 1;
        while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            const val = dbBarcodes[mid];
            if (val === target) return dbArticles[mid];
            else if (val < target) lo = mid + 1;
            else hi = mid - 1;
        }
        return null;
    }

    function checkTorchSupport(track) {
        if (!track) { torchSupported = false; currentTrack = null; updateTorchUI(); return; }
        try {
            const caps = track.getCapabilities ? track.getCapabilities() : {};
            torchSupported = ('torch' in caps) && caps.torch === true;
        } catch (e) {
            torchSupported = false;
        }
        currentTrack = track;
        updateTorchUI();
    }

    async function setTorch(track, on) {
        if (!track) throw new Error('Нет видеотрека');
        try { await track.applyConstraints({ advanced: [{ torch: on }] }); return; } catch (e) { }
        try { await track.applyConstraints({ torch: on }); return; } catch (e) { }
        try {
            if (window.ImageCapture) {
                const ic = new ImageCapture(track);
                if (typeof ic.setOptions === 'function') {
                    await ic.setOptions({ torch: on });
                    return;
                }
            }
        } catch (e) { }
        throw new Error('Переключение фонарика не поддерживается этим устройством/браузером.');
    }

    function stopAll() {
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        if (videoEl) {
            try {
                videoEl.pause();
                if (videoEl.srcObject) {
                    videoEl.srcObject.getTracks().forEach(t => { try { t.stop(); } catch (e) { } });
                    videoEl.srcObject = null;
                }
            } catch (e) { }
            $(videoEl).remove();
            videoEl = null;
        }
        if (stream) {
            try { stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { } }); } catch (e) { }
            stream = null;
        }
        detector = null;
        lastDetected = null;
        if (detectCooldown) { clearTimeout(detectCooldown); detectCooldown = null; }
        if (window.Quagga && quaggaActive) {
            try { window.Quagga.offDetected && window.Quagga.offDetected(); window.Quagga.stop(); } catch (e) { }
            quaggaActive = false;
        }
        if (torchOn && currentTrack) {
            try { setTorch(currentTrack, false).catch(() => { }); } catch (e) { }
        }
        torchOn = false;
        torchSupported = false;
        currentTrack = null;
        updateTorchUI();
        $scannerContainer.empty();
        $scannerStatus.text('');
    }

    $start.on('click', function (e) { e.preventDefault(); openScanner(); });
    $close.on('click', function () { stopAll(); hideOverlay(); });
    $torch.on('click', async function () { if (!torchSupported || !currentTrack) return; try { await setTorch(currentTrack, !torchOn); torchOn = !torchOn; updateTorchUI(); } catch (e) { } });
    $ok.on('click', function () { hideResult(); });
    $rescan.on('click', function () { hideResult(); openScanner(); });

    window.addEventListener('beforeunload', () => stopAll());

})();