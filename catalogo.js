import { collection, getDocs, query } from "firebase/firestore";
import { db } from "./firebase-config.js";
import { PageFlip } from "page-flip";

let allProducts = [];
let categoryOrder = [];
let pageFlipInstance = null;
let currentView = 'list'; // 'list' or 'flipbook'

// More specs than this flow into two columns (list view and flipbook) so cards keep a similar height
const SPECS_TWO_COL_THRESHOLD = 6;

// Map to store the starting page index of each category in the flipbook
let categoryPageMap = {};

// Product images live on free third-party hosts (catbox.moe, etc.) that reset connections
// (ERR_HTTP2_PROTOCOL_ERROR) when many requests arrive at once. Two defenses:
//  1. A small download queue: images only start loading once they are near the viewport, and at
//     most IMG_MAX_CONCURRENT are in flight at a time (native loading="lazy" can't cap that).
//  2. A failed image is retried a few times with a growing, jittered delay (through the same
//     queue) before giving up and hiding it, so one dropped connection never removes a photo.
const IMG_MAX_CONCURRENT = 6;
const IMG_MAX_RETRIES = 3;
const IMG_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
let imgActive = 0;
const imgQueue = [];

function pumpImages() {
    while (imgActive < IMG_MAX_CONCURRENT && imgQueue.length) {
        const img = imgQueue.shift();
        if (!img.isConnected) continue;
        imgActive++;
        let settled = false;
        const settle = () => {
            if (settled) return;
            settled = true;
            imgActive--;
            pumpImages();
        };
        img.addEventListener('load', settle, { once: true });
        img.addEventListener('error', settle, { once: true });
        img.src = img.dataset.src;
    }
}

const imgObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        imgObserver.unobserve(entry.target);
        imgQueue.push(entry.target);
    });
    pumpImages();
}, { rootMargin: '600px' });

// Show a transparent placeholder now and load the real image when it nears the viewport.
function lazyImage(img, src) {
    img.src = IMG_PLACEHOLDER;
    img.dataset.src = src;
    imgObserver.observe(img);
}

function observePageImages(root) {
    root.querySelectorAll('img[data-src]').forEach(img => imgObserver.observe(img));
}

function retryImage(img, onGiveUp) {
    const tries = Number(img.dataset.retries || 0);
    if (tries >= IMG_MAX_RETRIES) {
        onGiveUp();
        return;
    }
    img.dataset.retries = String(tries + 1);
    const delay = 700 * (tries + 1) + Math.random() * 700;
    setTimeout(() => {
        imgQueue.push(img);
        pumpImages();
    }, delay);
}

// Used by the flipbook's inline onerror handlers; 'thumb' hides the thumbnail box, 'drawing'
// hides the whole dimensions column once retries are exhausted.
window.sieluRetryImg = (img, kind) => retryImage(img, () => {
    (kind === 'drawing' ? img.parentNode.parentNode : img.parentNode).style.display = 'none';
});

// Parse specifications field (e.g. "TIPO LÁMPARA: Spot\nMATERIAL: Aluminio") into key-value pairs
function parseSpecifications(specsText, item) {
    if (specsText && specsText.trim()) {
        return specsText
            .split('\n')
            .map(line => {
                const colonIndex = line.indexOf(':');
                if (colonIndex === -1) return null;
                const label = line.substring(0, colonIndex).trim();
                const value = line.substring(colonIndex + 1).trim();
                if (!label || !value) return null;
                return { label, value };
            })
            .filter(Boolean);
    }
    
    // Fallback for older products using individual fields
    const specs = [];
    if (item.material) specs.push({ label: 'MATERIAL', value: item.material });
    if (item.color) specs.push({ label: 'COLOR/ACABADO', value: item.color });
    if (item.temp) specs.push({ label: 'TEMPERATURA DE COLOR', value: item.temp });
    if (item.ip) specs.push({ label: 'GRADO DE PROTECCIÓN (IP)', value: `IP${item.ip}` });
    return specs;
}

// Build the "CODE1 / CODE2" markup, prefixing each code with a colored dot when that
// member has a ColorSwatch assigned (set per-product in the configurador, so a group of
// merged products can show a different color next to each of its codes).
function buildCodesHtml(members) {
    return members
        .filter(member => member.codigo)
        .map(member => {
            const dot = member.colorSwatch
                ? `<span class="code-dot" style="background-color: ${member.colorSwatch};"></span>`
                : '';
            return `<span class="code-item">${dot}${member.codigo}</span>`;
        })
        .join('<span class="code-sep">/</span>');
}

async function fetchProducts() {
    try {
        const q = query(collection(db, "productos_sielu"));
        const querySnapshot = await getDocs(q);

        allProducts = [];
        querySnapshot.forEach((doc) => {
            if (doc.id === "--category-config--") {
                categoryOrder = doc.data().order || [];
                return;
            }

            const data = doc.data();
            allProducts.push({
                id: doc.id,
                nombre: data.Nombre || '',
                cat: data.Categoria || 'Sin Categoría',
                img: data.Imagen || '',
                codigo: data.CodigoFacturacion || '',
                precio: data.PrecioAntesIVA || 0,
                ficha: data.FichaTecnica || '',
                orden: Number(data.Orden ?? data.orden ?? 0),
                estado: data.Estado || 'Disponible',
                material: data.Material || '',
                ip: data.IP || '',
                color: data.Color || '',
                temp: data.Temp || '',
                especificaciones: data.Especificaciones || '',
                imgContexto: data.ImgContexto || '',
                dibujo: data.Dibujo || '',
                grupoId: data.GrupoId || '',
                nombreCatalogo: data.NombreCatalogo || '',
                colorSwatch: data.ColorSwatch || ''
            });
        });

        // Filter only available products
        allProducts = allProducts.filter(item => item.estado === 'Disponible');

        renderCatalog();
        setupScrollListener();
    } catch (error) {
        console.error("Error fetching products: ", error);
        document.getElementById('catalogContainer').innerHTML = 
            `<div class="loading-catalog" style="color: red; padding: 5rem;">Error al cargar el catálogo de productos: ${error.message}</div>`;
    }
}

// Get filtered items based on search input
function getFilteredItems() {
    const filter = document.getElementById('searchInput').value.toLowerCase();
    let filteredItems = allProducts;
    if (filter) {
        filteredItems = allProducts.filter(item => 
            item.nombre.toLowerCase().includes(filter) ||
            item.codigo.toLowerCase().includes(filter) ||
            item.cat.toLowerCase().includes(filter)
        );
    }
    return filteredItems;
}

// Collapse products sharing a non-empty GrupoId into a single "card" (multiple
// photos + codes, one shared set of specs/drawing taken from the lowest-Orden member).
function mergeGroupedItems(items) {
    const byGroup = new Map();
    const cards = [];

    items.forEach(item => {
        if (item.grupoId) {
            if (!byGroup.has(item.grupoId)) {
                const card = { isGroup: true, grupoId: item.grupoId, members: [] };
                byGroup.set(item.grupoId, card);
                cards.push(card);
            }
            byGroup.get(item.grupoId).members.push(item);
        } else {
            cards.push({ isGroup: false, members: [item] });
        }
    });

    cards.forEach(card => {
        card.members.sort((a, b) => {
            const ordA = Number(a.orden) || 0;
            const ordB = Number(b.orden) || 0;
            if (ordA !== ordB) return ordA - ordB;
            return a.nombre.localeCompare(b.nombre);
        });
        // A GrupoId left on only one available product behaves like a normal single card.
        if (card.members.length < 2) card.isGroup = false;
        card.orden = Number(card.members[0].orden) || 0;
        card.nombre = card.members[0].nombreCatalogo || card.members[0].nombre;
        // Sort by the real product name, never by the (optionally overridden) catalog display
        // name — otherwise renaming a group's display name in the configurador would also move
        // it to wherever that new name falls alphabetically among same-Orden products.
        card.sortNombre = card.members[0].nombre;
    });

    cards.sort((a, b) => a.orden - b.orden || a.sortNombre.localeCompare(b.sortNombre));
    return cards;
}

// Group and sort items by category
function getGroupedAndSortedItems(items) {
    const grouped = {};
    items.forEach(item => {
        const cat = item.cat;
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(item);
    });

    // Sort items within each category by Orden and then Nombre
    Object.keys(grouped).forEach(cat => {
        grouped[cat].sort((a, b) => {
            const ordA = Number(a.orden) || 0;
            const ordB = Number(b.orden) || 0;
            if (ordA !== ordB) return ordA - ordB;
            return a.nombre.localeCompare(b.nombre);
        });
    });

    // Sort categories using categoryOrder
    const sortedCategories = categoryOrder.filter(cat => grouped[cat]);
    Object.keys(grouped).forEach(cat => {
        if (!sortedCategories.includes(cat)) sortedCategories.push(cat);
    });

    return { grouped, sortedCategories };
}

// RENDER LIST VIEW
function renderCatalog() {
    const container = document.getElementById('catalogContainer');
    const nav = document.getElementById('categoryDropdownContent');
    
    container.innerHTML = '';
    if (nav) nav.innerHTML = '';

    const filteredItems = getFilteredItems();

    if (filteredItems.length === 0) {
        container.innerHTML = '<div class="loading-catalog">No se encontraron productos en el catálogo.</div>';
        return;
    }

    const { grouped, sortedCategories } = getGroupedAndSortedItems(filteredItems);

    // Render Navigation and Category Sections
    sortedCategories.forEach((cat, index) => {
        // Safe ID for scrolling anchor
        const catId = `cat-${cat.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase()}`;

        // Create Navigation Option in Dropdown
        const tab = document.createElement('div');
        tab.className = `dropdown-item`;
        tab.textContent = cat;
        tab.setAttribute('data-target', catId);
        tab.addEventListener('click', () => {
            if (currentView === 'list') {
                const targetEl = document.getElementById(catId);
                if (targetEl) {
                    const headerOffset = 100; // Offset for header
                    const elementPosition = targetEl.getBoundingClientRect().top;
                    const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
                    
                    window.scrollTo({
                        top: offsetPosition,
                        behavior: 'smooth'
                    });
                }
            } else {
                // Flipbook view: turn to target page
                const targetPage = categoryPageMap[cat];
                if (pageFlipInstance && targetPage !== undefined) {
                    pageFlipInstance.flip(targetPage);
                }
            }
            // Close dropdown
            document.getElementById('categoryDropdownContent').classList.remove('show');
        });
        nav.appendChild(tab);

        // Create Section Element
        const section = document.createElement('section');
        section.className = 'catalog-category-section';
        section.id = catId;

        // Section Title
        const title = document.createElement('h2');
        title.className = 'catalog-category-title';
        title.textContent = cat;
        section.appendChild(title);

        // Cards Grid
        const grid = document.createElement('div');
        grid.className = 'catalog-cards-grid';

        // Render Product Cards: two products (or groups) share one card, one on top / one below
        const cardItems = mergeGroupedItems(grouped[cat]);
        for (let i = 0; i < cardItems.length; i += 2) {
            const pair = cardItems.slice(i, i + 2);

            const card = document.createElement('div');
            card.className = 'catalog-card catalog-card--flat';

            card.appendChild(buildListProductBlock(pair[0]));
            if (pair[1]) {
                const divider = document.createElement('div');
                divider.className = 'card-pair-divider';
                card.appendChild(divider);
                card.appendChild(buildListProductBlock(pair[1]));
            }

            grid.appendChild(card);
        }

        section.appendChild(grid);
        container.appendChild(section);
    });
}

// Build one product's block (title + photo/specs/dimensions columns) for the list view.
// Two of these share a single .catalog-card--flat, stacked with a divider between them.
function buildListProductBlock(cardData) {
    const representative = cardData.members[0];
    const specs = parseSpecifications(representative.especificaciones, representative);

    const block = document.createElement('div');
    block.className = 'card-product-block';

    // Title block
    const titleBlock = document.createElement('div');
    titleBlock.className = 'card-title-block';

    const productTitle = document.createElement('h3');
    productTitle.className = 'product-title';
    productTitle.textContent = cardData.nombre;
    titleBlock.appendChild(productTitle);

    const productModel = document.createElement('p');
    productModel.className = 'product-model';
    productModel.innerHTML = buildCodesHtml(cardData.members);
    titleBlock.appendChild(productModel);

    block.appendChild(titleBlock);

    // Columns: product photo(s), specs, dimensions
    const columns = document.createElement('div');
    columns.className = 'card-columns';

    const photosCol = document.createElement('div');
    photosCol.className = 'card-photos';
    if (cardData.isGroup) photosCol.classList.add('is-group');

    const thumbGroup = document.createElement('div');
    thumbGroup.className = 'product-thumb-group';
    // 1 photo: single · 2-3: stacked vertically · 4+: 2-column grid ("quadrant")
    const photoCount = cardData.members.length;
    thumbGroup.dataset.layout = photoCount >= 4 ? 'grid' : photoCount > 1 ? 'stack' : 'single';
    thumbGroup.dataset.count = String(photoCount);
    cardData.members.forEach(member => {
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'product-thumb';
        const thumbImg = document.createElement('img');
        thumbImg.alt = member.nombre;
        lazyImage(thumbImg, member.img || member.imgContexto || '');
        thumbImg.onerror = () => retryImage(thumbImg, () => { thumbWrap.style.display = 'none'; });
        thumbWrap.appendChild(thumbImg);
        thumbGroup.appendChild(thumbWrap);
    });
    photosCol.appendChild(thumbGroup);
    columns.appendChild(photosCol);

    // Specifications section
    const specsSection = document.createElement('div');
    specsSection.className = 'specs-section';

    const specsTitle = document.createElement('h4');
    specsTitle.className = 'section-title';
    specsTitle.textContent = 'ESPECIFICACIONES TÉCNICAS';
    specsSection.appendChild(specsTitle);

    const specsList = document.createElement('div');
    specsList.className = 'specs-list';
    // Long spec lists flow into two columns so every card keeps a similar height
    if (specs.length > SPECS_TWO_COL_THRESHOLD) {
        specsSection.classList.add('specs-section--wide');
        specsList.style.setProperty('--spec-rows', String(Math.ceil(specs.length / 2)));
    }

    if (specs.length > 0) {
        specs.forEach(spec => {
            const itemEl = document.createElement('div');
            itemEl.className = 'spec-item';
            itemEl.innerHTML = `
                <span class="spec-label">${spec.label}</span>
                <span class="spec-dots"></span>
                <span class="spec-value">${spec.value}</span>
            `;
            specsList.appendChild(itemEl);
        });
    } else {
        const itemEl = document.createElement('div');
        itemEl.className = 'spec-item';
        itemEl.innerHTML = `
            <span class="spec-label" style="font-style: italic; color: #888;">Sin especificaciones disponibles</span>
        `;
        specsList.appendChild(itemEl);
    }
    specsSection.appendChild(specsList);
    columns.appendChild(specsSection);

    // Technical Drawing section
    if (representative.dibujo) {
        const drawingSection = document.createElement('div');
        drawingSection.className = 'drawing-section';

        const drawingTitle = document.createElement('h4');
        drawingTitle.className = 'section-title';
        drawingTitle.textContent = 'DIMENSIONES';
        drawingSection.appendChild(drawingTitle);

        const drawingContainer = document.createElement('div');
        drawingContainer.className = 'drawing-container';

        const drawingImg = document.createElement('img');
        drawingImg.className = 'drawing-img';
        drawingImg.alt = `Dimensiones de ${cardData.nombre}`;
        lazyImage(drawingImg, representative.dibujo);
        drawingImg.onerror = () => retryImage(drawingImg, () => { drawingSection.style.display = 'none'; });
        drawingContainer.appendChild(drawingImg);

        drawingSection.appendChild(drawingContainer);

        columns.appendChild(drawingSection);
    }

    block.appendChild(columns);
    return block;
}

// Flipbook page proportions: a horizontal ("landscape") letter sheet, 11x8.5in, instead of the
// previous wider 1050x560 ratio.
const FLIP_PAGE_RATIO = 11 / 8.5;
const FLIP_PAGE_W = 1000;
const FLIP_PAGE_H = Math.round(FLIP_PAGE_W / FLIP_PAGE_RATIO);
const FLIP_MIN_WIDTH = 800;

// Build the product block used inside a flipbook page (two per page: top/bottom half).
// PageFlip scales the physical page's rendered pixel size depending on viewport width, so a fixed
// pixel budget either clips on small renders or leaves a growing dead zone of empty space on large
// ones. Instead, the title block is flex-shrink:0 (renders at its natural, modest size, never
// squeezed) and the photo/specs/dimensions row is flex:1 1 0 — it always fills exactly whatever
// vertical space remains in the half, so thumbnails/specs/drawing grow on tall page renders and
// shrink on short ones, with overflow:hidden at each level as a clean-clip safety net rather than
// relying on precomputed numbers. The .spec-item/.drawing-container classes' own padding/border
// (sized for the much roomier list-view card) are explicitly zeroed out here instead of reused.
function buildFlipCardHtml(cardData, cat) {
    const representative = cardData.members[0];
    const specs = parseSpecifications(representative.especificaciones, representative);
    // Photo layout: 1 photo single · 2-3 stacked vertically · 4+ in a 2-column grid. The group's
    // overall aspect-ratio (cols/rows) is derived from its definite height, so the square thumbs
    // scale with the row's real height without needing precomputed pixel sizes.
    const photoCount = cardData.members.length;
    const photoCols = photoCount >= 4 ? 2 : 1;
    const photoRows = Math.ceil(photoCount / photoCols);
    const photoGap = 8;
    const wideSpecs = specs.length > SPECS_TWO_COL_THRESHOLD;
    // Two-column specs need horizontal room, so a lone photo is capped smaller next to them
    const thumbCap = photoCount >= 4 ? 140 : photoCount > 1 ? 190 : wideSpecs ? 190 : 260;
    const specRows = Math.ceil(specs.length / 2);
    const specsListStyle = wideSpecs
        ? `flex: 1 1 auto; min-height: 0; overflow: hidden; display: grid; grid-auto-flow: column; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(${specRows}, auto); align-content: center; column-gap: 1.25rem; row-gap: clamp(4px, 2%, 10px);`
        : 'flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; justify-content: center; gap: clamp(5px, 3%, 16px);';
    const specFont = wideSpecs ? 0.66 : 0.72;
    const thumbsHtml = cardData.members.map(member => `
        <div class="product-thumb" style="width: 100%; height: 100%; padding: 0.5rem; box-sizing: border-box;">
            <img src="${IMG_PLACEHOLDER}" data-src="${member.img || member.imgContexto || ''}" alt="${member.nombre}" onerror="window.sieluRetryImg(this, 'thumb')">
        </div>
    `).join('');
    const thumbGroupStyle = `flex: 0 0 auto; height: 100%; aspect-ratio: ${photoCols} / ${photoRows}; max-height: ${thumbCap * photoRows + photoGap * (photoRows - 1)}px; overflow: hidden; display: grid; grid-template-columns: repeat(${photoCols}, minmax(0, 1fr)); grid-template-rows: repeat(${photoRows}, minmax(0, 1fr)); gap: ${photoGap}px; align-self: center;`;

    return `
        <div style="height: 100%; overflow: hidden; box-sizing: border-box; display: flex; flex-direction: column;">
            <div style="flex: 0 0 auto; overflow: hidden; margin-bottom: 0.6rem; box-sizing: border-box;">
                <div style="line-height: 1; margin: 0 0 3px;">
                    <span style="font-family: var(--font-sans); font-size: 0.7rem; font-weight: 600; color: var(--sielu-accent); text-transform: uppercase; letter-spacing: 1px;">${cat}</span>
                </div>
                <h3 style="font-family: 'Poppins', sans-serif; font-size: 1.2rem; font-weight: 700; color: var(--sielu-text-dark); margin: 0 0 3px; line-height: 1.2; text-transform: uppercase; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${cardData.nombre}</h3>
                <p style="font-family: var(--font-sans); font-size: 0.74rem; font-weight: 500; color: var(--sielu-text-muted); letter-spacing: 1px; margin: 0; line-height: 1; text-transform: uppercase;">${buildCodesHtml(cardData.members)}</p>
            </div>

            <div style="display: flex; gap: 1.75rem; align-items: stretch; flex: 1 1 0; min-height: 0; overflow: hidden; box-sizing: border-box;">
                <div class="product-thumb-group" style="${thumbGroupStyle}">${thumbsHtml}</div>

                <div style="flex: ${wideSpecs ? '2 1 420px' : '1 1 280px'}; height: 100%; overflow: hidden; display: flex; flex-direction: column; box-sizing: border-box;">
                    <h4 style="font-family: 'Cormorant Garamond', serif; font-size: 0.95rem; font-weight: 700; color: var(--sielu-gold); letter-spacing: 0.6px; margin: 0 0 8px; line-height: 1; flex-shrink: 0; text-transform: uppercase; border-bottom: 1px solid #ECE7DB; padding-bottom: 5px;">ESPECIFICACIONES TÉCNICAS</h4>
                    <div style="${specsListStyle}">
                        ${specs.length > 0 ? specs.slice(0, 12).map(spec => `
                            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 0.4rem; padding: 0; border: 0; line-height: 1.15; flex-shrink: 0; min-width: 0;">
                                <span style="font-family: var(--font-sans); font-weight: 600; font-size: ${specFont}rem; color: var(--sielu-text-dark); text-transform: uppercase; ${wideSpecs ? '' : 'white-space: nowrap;'}">${spec.label}</span>
                                <span style="flex-grow: 1; border-bottom: 1px dotted #B0A795; margin: 0 6px; min-width: 6px;"></span>
                                <span style="font-family: var(--font-sans); font-size: ${specFont + 0.02}rem; color: var(--sielu-text-dark); text-align: right; min-width: 0;">${spec.value}</span>
                            </div>
                        `).join('') : `
                            <div style="font-family: var(--font-sans); font-size: 0.74rem; color: #888; font-style: italic; line-height: 1.2;">Sin especificaciones disponibles</div>
                        `}
                    </div>
                </div>

                ${representative.dibujo ? `
                <div style="flex: 1 1 260px; height: 100%; overflow: hidden; display: flex; flex-direction: column; box-sizing: border-box;">
                    <h4 style="font-family: 'Cormorant Garamond', serif; font-size: 0.9rem; font-weight: 700; color: var(--sielu-gold); letter-spacing: 0.6px; margin: 0 0 8px; line-height: 1; flex-shrink: 0; text-transform: uppercase;">DIMENSIONES</h4>
                    <div style="flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; justify-content: center; align-items: center; padding: 4px; box-sizing: border-box;">
                        <img src="${IMG_PLACEHOLDER}" data-src="${representative.dibujo}" style="max-height: 100%; max-width: 100%; object-fit: contain; mix-blend-mode: multiply; filter: contrast(1.1);" alt="Dimensiones" onerror="window.sieluRetryImg(this, 'drawing')">
                    </div>
                </div>
                ` : ''}
            </div>
        </div>
    `;
}

// RENDER FLIPBOOK VIEW (Landscape Layout to match List view card)
// PageFlip's destroy() removes the container element from the DOM, so it must be recreated
// before each render (opening the flipbook a second time used to crash on a null container).
function getBookContainer() {
    let container = document.getElementById('bookContainer');
    if (!container) {
        container = document.createElement('div');
        container.className = 'container--book';
        container.id = 'bookContainer';
        document.querySelector('#flipbookMain .book-viewport').appendChild(container);
    }
    return container;
}

function destroyPageFlip() {
    if (pageFlipInstance) {
        pageFlipInstance.destroy();
        pageFlipInstance = null;
    }
}

// Tear down any previous book first (destroy() would otherwise remove the freshly rendered
// pages along with the container), then render and initialize.
function rebuildFlipbook() {
    destroyPageFlip();
    renderFlipbook();
    initPageFlip();
}

function renderFlipbook() {
    const container = getBookContainer();
    container.innerHTML = '';
    categoryPageMap = {};

    const filteredItems = getFilteredItems();

    // 1. Front Cover Page (Landscape, proportional to a horizontal letter page)
    const coverPage = document.createElement('div');
    coverPage.className = 'page -cover';
    coverPage.style.width = `${FLIP_PAGE_W}px`;
    coverPage.style.height = `${FLIP_PAGE_H}px`;
    coverPage.style.padding = '0';
    coverPage.innerHTML = `
        <div class="page-content" style="justify-content: center; align-items: center; text-align: center; height: 100%; padding: 3rem; box-sizing: border-box; display: flex; flex-direction: column;">
            <p style="font-family: var(--font-sans); font-size: 0.9rem; letter-spacing: 6px; color: var(--sielu-text-muted); text-transform: uppercase; margin-bottom: 1.5rem;">S I E L U</p>
            <h1 style="font-family: 'Cormorant Garamond', serif; font-size: 3.5rem; font-weight: 300; color: var(--sielu-text-dark); margin: 0; letter-spacing: 3px; text-transform: uppercase; line-height: 1.2;">Catálogo Técnico</h1>
            <div style="width: 80px; height: 1px; background-color: var(--sielu-accent); margin: 1.5rem auto 1.5rem;"></div>
            <p style="font-family: var(--font-sans); font-size: 0.8rem; letter-spacing: 3px; color: var(--sielu-text-muted); text-transform: uppercase;">Volumen 01</p>
        </div>
    `;
    container.appendChild(coverPage);

    if (filteredItems.length === 0) {
        const noResultsPage = document.createElement('div');
        noResultsPage.className = 'page';
        noResultsPage.style.width = `${FLIP_PAGE_W}px`;
        noResultsPage.style.height = `${FLIP_PAGE_H}px`;
        noResultsPage.innerHTML = `
            <div class="page-content" style="justify-content: center; align-items: center; text-align: center; height: 100%; display: flex;">
                <p style="font-family: var(--font-sans); font-size: 1.1rem; color: var(--sielu-text-muted);">No se encontraron productos para esta búsqueda.</p>
            </div>
        `;
        container.appendChild(noResultsPage);
        return;
    }

    const { grouped, sortedCategories } = getGroupedAndSortedItems(filteredItems);

    // 2. Index Page (Landscape)
    const indexPage = document.createElement('div');
    indexPage.className = 'page';
    indexPage.style.width = `${FLIP_PAGE_W}px`;
    indexPage.style.height = `${FLIP_PAGE_H}px`;
    
    let indexHtml = `
        <div class="page-content" style="height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 2rem; box-sizing: border-box;">
            <h2 style="font-family: 'Cormorant Garamond', serif; font-size: 2.4rem; font-weight: 400; color: var(--sielu-text-dark); margin-bottom: 2rem; text-transform: uppercase; letter-spacing: 1px;">Contenido</h2>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem 3rem; width: 100%; max-width: 700px;">
    `;
    sortedCategories.forEach(cat => {
        indexHtml += `
            <div style="display: flex; justify-content: space-between; font-family: var(--font-sans); font-size: 0.85rem; border-bottom: 1px dotted #B0A795; padding-bottom: 3px;">
                <span style="font-weight: 600; color: var(--sielu-text-dark); text-transform: uppercase; letter-spacing: 0.5px;">${cat}</span>
            </div>
        `;
    });
    indexHtml += `
            </div>
        </div>
    `;
    indexPage.innerHTML = indexHtml;
    container.appendChild(indexPage);

    let pageIndex = 2; // Index starts at 2 (0: Cover, 1: Index)

    // 3. Product Pages (two products per page: one on top, one below — groups count as one slot)
    sortedCategories.forEach(cat => {
        // Map category starting page
        categoryPageMap[cat] = pageIndex;

        const cardItems = mergeGroupedItems(grouped[cat]);
        for (let i = 0; i < cardItems.length; i += 2) {
            const pair = cardItems.slice(i, i + 2);

            const page = document.createElement('div');
            page.className = 'page';
            page.style.width = `${FLIP_PAGE_W}px`;
            page.style.height = `${FLIP_PAGE_H}px`;
            page.style.padding = '0';

            page.innerHTML = `
                <div class="page-content" style="height: 100%; display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; width: 100%; padding: 1rem 2.5rem;">
                    <div style="flex: 1 1 0; min-height: 0; overflow: hidden;">${buildFlipCardHtml(pair[0], cat)}</div>
                    ${pair[1] ? '<div style="flex: 0 0 auto; height: 1px; background: #ECE7DB; margin: 0.5rem 0;"></div>' : ''}
                    ${pair[1] ? `<div style="flex: 1 1 0; min-height: 0; overflow: hidden;">${buildFlipCardHtml(pair[1], cat)}</div>` : ''}
                </div>
            `;
            container.appendChild(page);
            observePageImages(page);
            pageIndex++;
        }
    });

    // 4. Back Cover Page (Landscape)
    const backCoverPage = document.createElement('div');
    backCoverPage.className = 'page -cover';
    backCoverPage.style.width = `${FLIP_PAGE_W}px`;
    backCoverPage.style.height = `${FLIP_PAGE_H}px`;
    backCoverPage.style.padding = '0';
    backCoverPage.innerHTML = `
        <div class="page-content" style="justify-content: center; align-items: center; text-align: center; height: 100%; padding: 3rem; box-sizing: border-box; display: flex; flex-direction: column;">
            <img src="/logo.png" style="max-width: 180px; margin-bottom: 1.5rem; display: block;" alt="Sielu Logo" onerror="this.style.display='none'">
            <div style="width: 50px; height: 1px; background-color: var(--sielu-accent); margin: 1rem auto;"></div>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--sielu-text-muted); margin-bottom: 0.4rem; letter-spacing: 1.5px; text-transform: uppercase;">sielu.design</p>
            <p style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--sielu-text-muted); letter-spacing: 1px;">+57 314 2188971</p>
        </div>
    `;
    container.appendChild(backCoverPage);
}

// INITIALIZE PAGEFLIP
function initPageFlip() {
    const container = getBookContainer();
    const pages = container.querySelectorAll('.page');
    
    pageFlipInstance = new PageFlip(container, {
        width: FLIP_PAGE_W, // base page width (horizontal-letter-proportioned landscape)
        height: FLIP_PAGE_H, // base page height
        size: "stretch",
        // minWidth raised from PageFlip's typical 500 default: below it, the compact two-per-page
        // card content (see buildFlipCardHtml) would run out of room and get clipped.
        minWidth: FLIP_MIN_WIDTH,
        maxWidth: 1100,
        minHeight: Math.round(FLIP_MIN_WIDTH / FLIP_PAGE_RATIO),
        maxHeight: Math.round(1100 / FLIP_PAGE_RATIO),
        maxShadowOpacity: 0.3,
        showCover: false, // Single landscape page mode, no double cover
        mode: "portrait", // Forces single-page view in PageFlip
        mobileScrollSupport: false
    });
    
    pageFlipInstance.loadFromHTML(pages);
    
    // Update page counter
    updatePageCounter();
    
    pageFlipInstance.on('flip', () => {
        updatePageCounter();
        updateDropdownActiveTabForFlipbook();
    });
    
    document.getElementById('btnPrev').onclick = () => pageFlipInstance.flipPrev();
    document.getElementById('btnNext').onclick = () => pageFlipInstance.flipNext();
}

function updatePageCounter() {
    if (!pageFlipInstance) return;
    const current = pageFlipInstance.getCurrentPageIndex() + 1;
    const total = pageFlipInstance.getPageCount();
    document.getElementById('pageCounter').innerText = `${current} / ${total}`;
}

// Update the dropdown active tab and text when flipping pages in flipbook view
function updateDropdownActiveTabForFlipbook() {
    if (!pageFlipInstance || currentView !== 'flipbook') return;
    const currentPageIndex = pageFlipInstance.getCurrentPageIndex();
    const dropdownItems = document.querySelectorAll('.dropdown-item');
    const activeCategoryName = document.getElementById('activeCategoryName');

    let activeCat = '';
    
    // Find which category matches the current page index
    const sortedCats = Object.keys(categoryPageMap).sort((a, b) => categoryPageMap[a] - categoryPageMap[b]);
    for (let i = 0; i < sortedCats.length; i++) {
        const cat = sortedCats[i];
        const startPage = categoryPageMap[cat];
        const nextStartPage = categoryPageMap[sortedCats[i + 1]] || Infinity;
        
        if (currentPageIndex >= startPage && currentPageIndex < nextStartPage) {
            activeCat = cat;
            break;
        }
    }

    let foundActive = false;
    if (activeCat) {
        dropdownItems.forEach(item => {
            item.classList.remove('active');
            if (item.textContent === activeCat) {
                item.classList.add('active');
                if (activeCategoryName) {
                    activeCategoryName.textContent = item.textContent;
                }
                foundActive = true;
            }
        });
    }

    if (!foundActive && activeCategoryName) {
        activeCategoryName.textContent = 'Ir a Categoría...';
    }
}

// SCROLL SPY FOR LIST VIEW
function setupScrollListener() {
    const sections = document.querySelectorAll('.catalog-category-section');
    const dropdownItems = document.querySelectorAll('.dropdown-item');
    const activeCategoryName = document.getElementById('activeCategoryName');

    window.addEventListener('scroll', () => {
        if (currentView !== 'list') return; // Disable scroll spy in flipbook view
        
        let current = '';
        const scrollPosition = window.scrollY + 160; // offset to match header / controls bar

        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.offsetHeight;
            if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
                current = section.getAttribute('id');
            }
        });

        let foundActive = false;
        if (current) {
            dropdownItems.forEach(item => {
                item.classList.remove('active');
                if (item.getAttribute('data-target') === current) {
                    item.classList.add('active');
                    if (activeCategoryName) {
                        activeCategoryName.textContent = item.textContent;
                    }
                    foundActive = true;
                }
            });
        }

        if (!foundActive && activeCategoryName) {
            activeCategoryName.textContent = 'Ir a Categoría...';
        }
    });
}

// Dropdown Toggle Logic (List View)
const dropdownBtn = document.getElementById('categoryDropdownBtn');
const dropdownContent = document.getElementById('categoryDropdownContent');

if (dropdownBtn && dropdownContent) {
    dropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownContent.classList.toggle('show');
    });

    window.addEventListener('click', (e) => {
        if (!dropdownBtn.contains(e.target) && !dropdownContent.contains(e.target)) {
            dropdownContent.classList.remove('show');
        }
    });
}

// VIEW TOGGLE LOGIC
const viewToggleBtn = document.getElementById('viewToggleBtn');
const catalogMain = document.getElementById('catalogMain');
const flipbookMain = document.getElementById('flipbookMain');
const viewToggleText = document.getElementById('viewToggleText');
const viewToggleIcon = document.getElementById('viewToggleIcon');

if (viewToggleBtn) {
    viewToggleBtn.addEventListener('click', () => {
        if (currentView === 'list') {
            currentView = 'flipbook';
            catalogMain.style.display = 'none';
            flipbookMain.style.display = 'flex';
            viewToggleText.textContent = 'Vista de Lista';
            viewToggleIcon.textContent = '📋';
            
            // Render and initialize flipbook
            rebuildFlipbook();
        } else {
            currentView = 'list';
            flipbookMain.style.display = 'none';
            catalogMain.style.display = 'block';
            viewToggleText.textContent = 'Vista Flipbook';
            viewToggleIcon.textContent = '📖';
            
            destroyPageFlip();

            // Re-render list to ensure sync
            renderCatalog();
        }
    });
}

// Search handler
document.getElementById('searchInput').addEventListener('input', () => {
    if (currentView === 'list') {
        renderCatalog();
    } else {
        rebuildFlipbook();
    }
});

// Initialize fetch
fetchProducts();
