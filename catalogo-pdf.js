// Builds the downloadable PDF of the visual catalog: a horizontal-letter page per category cover
// and two products per page (one above the other), mirroring the flipbook. Images are fetched
// in the browser (all hosts used by the catalog allow CORS), downscaled and re-encoded as JPEG so
// the file stays a reasonable size.
import jsPDF from "jspdf";

const PAGE_W = 279.4; // 11in
const PAGE_H = 215.9; // 8.5in
const MARGIN_X = 14;
const TOP = 10;
const FOOTER_Y = PAGE_H - 6;
const BLOCK_GAP = 6;

const GOLD = [168, 135, 79];
const DARK = [26, 26, 26];
const MUTED = [110, 110, 110];
const LINE = [226, 220, 205];
const CREAM = [255, 255, 255]; // page background: white
const TILE = [246, 244, 239];
const BOX = [250, 248, 243];

const IMG_CONCURRENCY = 6;
const IMG_RETRIES = 3;

const imageCache = new Map();

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Standard PDF fonts only cover Latin-1/WinAnsi, so map or drop anything outside of it.
function pdfText(value) {
    return String(value ?? '')
        .replace(/[Φφ]/g, 'Ø')
        .replace(/[≈]/g, '~')
        .replace(/[−‐‑]/g, '-')
        .replace(/[^\u0000-ÿ–—‘’“”•…]/g, '');
}

function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// `blend` is the tile color the image sits on in the PDF: the image is multiplied onto it, like the
// online catalog's `mix-blend-mode: multiply`, so a white/transparent photo background takes the
// tile color instead of showing as a white box.
async function loadAndEncode(url, { maxDim, cropRatio, blend }) {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());

    let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;
    if (cropRatio) {
        if (sw / sh > cropRatio) {
            sw = Math.round(sh * cropRatio);
            sx = Math.round((bitmap.width - sw) / 2);
        } else {
            sh = Math.round(sw / cropRatio);
            sy = Math.round((bitmap.height - sh) / 2);
        }
    }
    const scale = Math.min(1, maxDim / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = blend ? `rgb(${blend.join(',')})` : '#ffffff';
    ctx.fillRect(0, 0, w, h);
    if (blend) ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
    bitmap.close?.();
    return { data: canvas.toDataURL('image/jpeg', 0.82), w, h };
}

// `sources` is one URL or an ordered list (primary, then backups). Each source but the last gets
// a single attempt so a dead primary falls through to its backup quickly.
function fetchImage(sources, options) {
    const list = [].concat(sources || []).filter(Boolean);
    if (!list.length) return Promise.resolve(null);
    const key = `${list.join('|')}|${options.maxDim}|${options.cropRatio || ''}|${(options.blend || []).join(',')}`;
    if (!imageCache.has(key)) {
        imageCache.set(key, (async () => {
            for (let i = 0; i < list.length; i++) {
                const attempts = i < list.length - 1 ? 1 : IMG_RETRIES + 1;
                for (let attempt = 0; attempt < attempts; attempt++) {
                    try {
                        return await loadAndEncode(list[i], options);
                    } catch (error) {
                        if (attempt < attempts - 1) await sleep(500 * (attempt + 1) + Math.random() * 400);
                    }
                }
            }
            return null;
        })());
    }
    return imageCache.get(key);
}

// Runs the fetches through a small pool: the free image hosts drop connections under bursts.
async function prefetchAll(jobs, onProgress, signal) {
    let next = 0;
    let done = 0;
    async function worker() {
        while (next < jobs.length) {
            if (signal?.aborted) return;
            const job = jobs[next++];
            await fetchImage(job.sources, job.options);
            done++;
            onProgress(done, jobs.length);
        }
    }
    await Promise.all(Array.from({ length: IMG_CONCURRENCY }, worker));
}

function drawImageContain(doc, img, x, y, w, h, pad = 1.5) {
    if (!img) return;
    const maxW = w - pad * 2;
    const maxH = h - pad * 2;
    const ratio = Math.min(maxW / img.w, maxH / img.h);
    const dw = img.w * ratio;
    const dh = img.h * ratio;
    doc.addImage(img.data, 'JPEG', x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawPhotos(doc, photos, x, y, w, h) {
    const count = photos.length;
    if (!count) return;
    const cols = count >= 4 ? 2 : 1;
    const rows = Math.ceil(count / cols);
    const gap = 3;
    const cell = Math.min((w - gap * (cols - 1)) / cols, (h - gap * (rows - 1)) / rows, 52);
    const totalH = cell * rows + gap * (rows - 1);
    const startY = y + Math.max(0, (h - totalH) / 2);
    photos.forEach((img, index) => {
        const cx = x + (index % cols) * (cell + gap);
        const cy = startY + Math.floor(index / cols) * (cell + gap);
        doc.setFillColor(...TILE);
        doc.roundedRect(cx, cy, cell, cell, 1.5, 1.5, 'F');
        drawImageContain(doc, img, cx, cy, cell, cell, 2);
    });
}

function fitValue(doc, text, maxWidth, size) {
    let s = size;
    doc.setFontSize(s);
    while (s > 5.2 && doc.getTextWidth(text) > maxWidth) {
        s -= 0.4;
        doc.setFontSize(s);
    }
    let out = text;
    while (out.length > 2 && doc.getTextWidth(out) > maxWidth) out = out.slice(0, -2);
    return out === text ? out : `${out.trimEnd()}...`;
}

function drawSpecs(doc, specs, x, y, w, h, { singleColumn = false, maxRows = 14 } = {}) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...GOLD);
    doc.text('ESPECIFICACIONES TÉCNICAS', x, y + 3);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.25);
    doc.line(x, y + 5, x + w, y + 5);

    const top = y + 7.5;
    const availH = h - 8;
    if (!specs.length) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7.5);
        doc.setTextColor(...MUTED);
        doc.text('Sin especificaciones disponibles', x, top + 3);
        return;
    }

    const list = specs.slice(0, maxRows);
    const cols = !singleColumn && list.length > 6 ? 2 : 1;
    const colGap = 7;
    const colW = (w - colGap * (cols - 1)) / cols;
    const perCol = Math.ceil(list.length / cols);
    const pitch = Math.min(8.2, availH / perCol);

    list.forEach((spec, index) => {
        const col = Math.floor(index / perCol);
        const row = index % perCol;
        const cx = x + col * (colW + colGap);
        const baseline = top + row * pitch + pitch * 0.62;

        const label = pdfText(spec.label).toUpperCase();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.6);
        doc.setTextColor(...DARK);
        const labelFit = fitValue(doc, label, colW * 0.62, 6.6);
        doc.text(labelFit, cx, baseline);
        const labelW = doc.getTextWidth(labelFit);

        doc.setFont('helvetica', 'normal');
        const valueFit = fitValue(doc, pdfText(spec.value), colW - labelW - 4, 7);
        doc.setTextColor(...DARK);
        doc.text(valueFit, cx + colW, baseline, { align: 'right' });
        const valueW = doc.getTextWidth(valueFit);

        const dotsStart = cx + labelW + 1.5;
        const dotsEnd = cx + colW - valueW - 1.5;
        if (dotsEnd - dotsStart > 2) {
            doc.setDrawColor(...LINE);
            doc.setLineWidth(0.2);
            try { doc.setLineDashPattern([0.3, 0.9], 0); } catch (e) { /* older jsPDF: solid line */ }
            doc.line(dotsStart, baseline - 0.6, dotsEnd, baseline - 0.6);
            try { doc.setLineDashPattern([], 0); } catch (e) { /* noop */ }
        }
    });
}

function drawDrawing(doc, img, x, y, w, h) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...GOLD);
    doc.text('DIMENSIONES', x, y + 3);
    const boxY = y + 6;
    const boxH = Math.max(10, h - 6);
    doc.setFillColor(...BOX);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, boxY, w, boxH, 1.5, 1.5, 'FD');
    drawImageContain(doc, img, x, boxY, w, boxH, 2.5);
}

function drawCodes(doc, codes, x, y) {
    let cx = x;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    codes.forEach((item, index) => {
        if (index > 0) {
            doc.setTextColor(...MUTED);
            doc.text('/', cx + 1, y);
            cx += 4;
        }
        const rgb = hexToRgb(item.color);
        if (rgb) {
            doc.setFillColor(...rgb);
            doc.setDrawColor(190, 190, 190);
            doc.setLineWidth(0.2);
            doc.circle(cx + 1.2, y - 1.1, 1.2, 'FD');
            cx += 3.4;
        }
        const text = pdfText(item.code);
        doc.setTextColor(...MUTED);
        doc.text(text, cx, y);
        cx += doc.getTextWidth(text) + 1.5;
    });
}

function drawProduct(doc, card, images, categoryName, y0, blockH) {
    const contentW = PAGE_W - MARGIN_X * 2;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...GOLD);
    doc.text(pdfText(categoryName).toUpperCase(), MARGIN_X, y0 + 3);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...DARK);
    const titleLines = doc.splitTextToSize(pdfText(card.title).toUpperCase(), contentW).slice(0, 2);
    const titleY = y0 + 9;
    doc.text(titleLines, MARGIN_X, titleY);
    const afterTitle = titleY + (titleLines.length - 1) * 5.6;

    drawCodes(doc, card.codes, MARGIN_X, afterTitle + 5.5);

    const rowTop = afterTitle + 10;
    const rowH = y0 + blockH - rowTop - 1;
    const photosW = 58;
    const gap = 8;
    const drawingKey = card.drawing.length ? `${card.drawing[0]}|drawing` : '';
    const hasDrawing = Boolean(drawingKey);
    const drawingW = hasDrawing ? 70 : 0;
    const specsX = MARGIN_X + photosW + gap;
    const specsW = contentW - photosW - gap - (hasDrawing ? drawingW + gap : 0);

    drawPhotos(doc, card.photos.map(sources => images.get(`${sources[0]}|photo`)).filter(Boolean), MARGIN_X, rowTop, photosW, rowH);
    drawSpecs(doc, card.specs, specsX, rowTop, specsW, rowH);
    if (hasDrawing) {
        drawDrawing(doc, images.get(drawingKey), specsX + specsW + gap, rowTop, drawingW, rowH);
    }
}

// Compact cell for accessories (four per page, 2x2): title + codes, photo(s) on the left, specs
// on the right with the drawing underneath when there is one.
function drawAccessory(doc, card, images, x, y, w, h) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...DARK);
    const titleLines = doc.splitTextToSize(pdfText(card.title).toUpperCase(), w).slice(0, 2);
    const titleY = y + 4;
    doc.text(titleLines, x, titleY);
    const afterTitle = titleY + (titleLines.length - 1) * 4.3;
    drawCodes(doc, card.codes, x, afterTitle + 4.8);

    const rowTop = afterTitle + 8.5;
    const rowH = y + h - rowTop;
    const photosW = 40;
    const gap = 6;
    const rightX = x + photosW + gap;
    const rightW = w - photosW - gap;
    const drawingKey = card.drawing.length ? `${card.drawing[0]}|drawing` : '';

    drawPhotos(doc, card.photos.map(sources => images.get(`${sources[0]}|photo`)).filter(Boolean), x, rowTop, photosW, rowH);
    if (drawingKey) {
        const drawingH = Math.min(30, rowH * 0.42);
        drawSpecs(doc, card.specs, rightX, rowTop, rightW, rowH - drawingH - 2, { singleColumn: true, maxRows: 8 });
        drawDrawing(doc, images.get(drawingKey), rightX, rowTop + rowH - drawingH, rightW, drawingH);
    } else {
        drawSpecs(doc, card.specs, rightX, rowTop, rightW, rowH, { singleColumn: true, maxRows: 8 });
    }
}

// jsPDF's align:'center' ignores charSpace, so letter-spaced text lands off-center; measure it
// ourselves (text width + the gaps between letters) and draw it left-aligned instead.
function centerText(doc, text, y, charSpace, dx = 0) {
    const width = doc.getTextWidth(text) + charSpace * (text.length - 1);
    doc.text(text, (PAGE_W - width) / 2 + dx, y, { charSpace });
}

// "Octubre 2026": month and year of the download
function monthLabel(date = new Date()) {
    const month = date.toLocaleDateString('es-CO', { month: 'long' });
    return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${date.getFullYear()}`;
}

function pageBackground(doc) {
    doc.setFillColor(...CREAM);
    doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
}

function footer(doc, number, logo) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    if (logo) {
        const lh = 4.5;
        doc.addImage(logo.data, 'JPEG', MARGIN_X, FOOTER_Y - lh + 0.6, lh * (logo.w / logo.h), lh);
    } else {
        doc.text('sielu', MARGIN_X, FOOTER_Y);
    }
    doc.text(String(number), PAGE_W - MARGIN_X, FOOTER_Y, { align: 'right' });
}

/**
 * @param {Array<{name:string, image:string, cards:Array<{title:string, codes:{code:string,color:string}[],
 *   photos:string[], specs:{label:string,value:string}[], drawing:string}>}>} categories
 * @param {{onProgress?:(phase:string, value:number)=>void, signal?:AbortSignal}} options
 */
export async function generateCatalogPdf(categories, { onProgress = () => {}, signal } = {}) {
    // 1. Collect and prefetch every image
    const jobs = [];
    const seen = new Set();
    const add = (sources, kind, options) => {
        const list = [].concat(sources || []).filter(Boolean);
        if (!list.length) return;
        const key = `${list[0]}|${kind}`;
        if (seen.has(key)) return;
        seen.add(key);
        jobs.push({ key, sources: list, options });
    };
    const COVER_RATIO = PAGE_W / PAGE_H;
    add('/logo.png', 'logo', { maxDim: 600 });
    categories.forEach(cat => {
        add(cat.image, 'cover', { maxDim: 1500, cropRatio: COVER_RATIO });
        cat.pages.forEach(page => page.cards.forEach(card => {
            card.photos.forEach(sources => add(sources, 'photo', { maxDim: 380, blend: TILE }));
            add(card.drawing, 'drawing', { maxDim: 900, blend: BOX });
        }));
    });

    await prefetchAll(jobs, (done, total) => onProgress('images', done / total), signal);
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');

    const images = new Map();
    for (const job of jobs) images.set(job.key, await fetchImage(job.sources, job.options));

    // 2. Layout
    onProgress('layout', 0);
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [PAGE_W, PAGE_H], compress: true });
    let pageNumber = 1;
    const tocEntries = [];

    // Front cover: logo, "CATÁLOGO" and the month/year the PDF was downloaded
    pageBackground(doc);
    const frontLogo = images.get('/logo.png|logo');
    if (frontLogo) {
        const lw = 60;
        const lh = lw * (frontLogo.h / frontLogo.w);
        doc.addImage(frontLogo.data, 'JPEG', (PAGE_W - lw) / 2 - 1, PAGE_H / 2 - 16 - lh, lw, lh);
    } else {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(...MUTED);
        doc.text('S I E L U', PAGE_W / 2, PAGE_H / 2 - 22, { align: 'center' });
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(34);
    doc.setTextColor(...DARK);
    // dx: optical correction for the glyph side bearings (measured on the rendered page)
    centerText(doc, 'CATÁLOGO', PAGE_H / 2 + 2, 1, -1.6);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.4);
    doc.line(PAGE_W / 2 - 14, PAGE_H / 2 + 12, PAGE_W / 2 + 14, PAGE_H / 2 + 12);
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    centerText(doc, pdfText(monthLabel()).toUpperCase(), PAGE_H / 2 + 21, 1);

    // Reserve the contents page; it is filled in once page numbers are known
    doc.addPage([PAGE_W, PAGE_H], 'landscape');
    pageNumber++;
    const tocPage = pageNumber;

    categories.forEach((cat, catIndex) => {
        const cover = images.get(`${[].concat(cat.image || []).filter(Boolean)[0]}|cover`);
        doc.addPage([PAGE_W, PAGE_H], 'landscape');
        pageNumber++;
        tocEntries.push({ name: cat.name, page: pageNumber });

        if (cover) {
            doc.addImage(cover.data, 'JPEG', 0, 0, PAGE_W, PAGE_H);
            doc.saveGraphicsState();
            doc.setGState(new doc.GState({ opacity: 0.45 }));
            doc.setFillColor(0, 0, 0);
            doc.rect(0, PAGE_H - 62, PAGE_W, 62, 'F');
            doc.restoreGraphicsState();
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(30);
            doc.setTextColor(255, 255, 255);
            doc.text(pdfText(cat.name).toUpperCase(), MARGIN_X + 6, PAGE_H - 20, { charSpace: 1 });
        } else {
            pageBackground(doc);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(26);
            doc.setTextColor(...DARK);
            centerText(doc, pdfText(cat.name).toUpperCase(), PAGE_H / 2, 1);
            doc.setDrawColor(...GOLD);
            doc.setLineWidth(0.4);
            doc.line(PAGE_W / 2 - 14, PAGE_H / 2 + 7, PAGE_W / 2 + 14, PAGE_H / 2 + 7);
        }

        const blockH = (PAGE_H - TOP - 14 - BLOCK_GAP) / 2;
        cat.pages.forEach(pageData => {
            doc.addPage([PAGE_W, PAGE_H], 'landscape');
            pageNumber++;
            pageBackground(doc);

            if (pageData.accessory) {
                const colGap = 10;
                const cellW = (PAGE_W - MARGIN_X * 2 - colGap) / 2;
                doc.setDrawColor(...LINE);
                doc.setLineWidth(0.3);
                pageData.cards.forEach((card, index) => {
                    const cx = MARGIN_X + (index % 2) * (cellW + colGap);
                    const cy = TOP + Math.floor(index / 2) * (blockH + BLOCK_GAP);
                    drawAccessory(doc, card, images, cx, cy, cellW, blockH);
                });
                // Thin separators between the cells
                if (pageData.cards.length > 1) {
                    const midX = MARGIN_X + cellW + colGap / 2;
                    const lineBottom = pageData.cards.length > 2 ? TOP + blockH * 2 + BLOCK_GAP : TOP + blockH;
                    doc.line(midX, TOP, midX, lineBottom);
                }
                if (pageData.cards.length > 2) {
                    const midY = TOP + blockH + BLOCK_GAP / 2;
                    doc.line(MARGIN_X, midY, PAGE_W - MARGIN_X, midY);
                }
            } else {
                drawProduct(doc, pageData.cards[0], images, cat.name, TOP, blockH);
                if (pageData.cards[1]) {
                    const dividerY = TOP + blockH + BLOCK_GAP / 2;
                    doc.setDrawColor(...LINE);
                    doc.setLineWidth(0.3);
                    doc.line(MARGIN_X, dividerY, PAGE_W - MARGIN_X, dividerY);
                    drawProduct(doc, pageData.cards[1], images, cat.name, TOP + blockH + BLOCK_GAP, blockH);
                }
            }
            footer(doc, pageNumber, images.get('/logo.png|logo'));
        });
        onProgress('layout', (catIndex + 1) / categories.length);
    });

    // Back cover
    doc.addPage([PAGE_W, PAGE_H], 'landscape');
    pageNumber++;
    pageBackground(doc);
    const logo = images.get('/logo.png|logo');
    if (logo) {
        const lw = 50;
        const lh = lw * (logo.h / logo.w);
        doc.addImage(logo.data, 'JPEG', (PAGE_W - lw) / 2, PAGE_H / 2 - lh - 6, lw, lh);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    centerText(doc, 'SIELU.DESIGN', PAGE_H / 2 + 6, 0.6);
    doc.text('+57 314 2188971', PAGE_W / 2, PAGE_H / 2 + 12, { align: 'center' });

    // Contents page, now that page numbers exist
    doc.setPage(tocPage);
    pageBackground(doc);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(22);
    doc.setTextColor(...DARK);
    centerText(doc, 'CONTENIDO', 26, 0.8);
    const colW = (PAGE_W - MARGIN_X * 2 - 20) / 2;
    const perCol = Math.ceil(tocEntries.length / 2);
    const rowH = Math.min(8, (PAGE_H - 50) / perCol);
    tocEntries.forEach((entry, index) => {
        const col = Math.floor(index / perCol);
        const row = index % perCol;
        const x = MARGIN_X + col * (colW + 20);
        const y = 42 + row * rowH;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...DARK);
        const name = fitValue(doc, pdfText(entry.name).toUpperCase(), colW - 14, 8);
        doc.text(name, x, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...MUTED);
        doc.text(String(entry.page), x + colW, y, { align: 'right' });
        doc.setDrawColor(...LINE);
        doc.setLineWidth(0.2);
        try { doc.setLineDashPattern([0.3, 0.9], 0); } catch (e) { /* noop */ }
        const nameW = doc.getTextWidth(name);
        doc.line(x + nameW + 2, y - 0.8, x + colW - 8, y - 0.8);
        try { doc.setLineDashPattern([], 0); } catch (e) { /* noop */ }
        doc.link(x, y - 4, colW, rowH, { pageNumber: entry.page });
    });

    onProgress('saving', 1);
    const stamp = new Date().toISOString().slice(0, 10);
    doc.save(`Catalogo-Sielu-${stamp}.pdf`);
    return { pages: pageNumber, images: jobs.length, missing: [...images.values()].filter(v => !v).length };
}
