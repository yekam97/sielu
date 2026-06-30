import { collection, getDocs, query } from "firebase/firestore";
import { db } from "./firebase-config.js";
import { PageFlip } from "page-flip";

let allProducts = [];
let categoryOrder = [];
let pageFlipInstance = null;
let currentView = 'list'; // 'list' or 'flipbook'

// Map to store the starting page index of each category in the flipbook
let categoryPageMap = {};

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
                dibujo: data.Dibujo || ''
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

        // Render Product Cards
        grouped[cat].forEach(item => {
            const specs = parseSpecifications(item.especificaciones, item);
            
            const card = document.createElement('div');
            card.className = 'catalog-card';

            const cardLeft = document.createElement('div');
            cardLeft.className = 'card-left';
            
            const img = document.createElement('img');
            img.className = 'context-img';
            img.src = item.imgContexto || item.img || '';
            img.alt = item.nombre;
            img.loading = 'lazy';
            img.onerror = () => { img.style.display = 'none'; };
            cardLeft.appendChild(img);

            const cardRight = document.createElement('div');
            cardRight.className = 'card-right';

            // Title and model (Poppins)
            const productTitle = document.createElement('h3');
            productTitle.className = 'product-title';
            productTitle.textContent = item.nombre;
            cardRight.appendChild(productTitle);

            const productModel = document.createElement('p');
            productModel.className = 'product-model';
            productModel.textContent = item.codigo ? `MODEL: ${item.codigo}` : '';
            cardRight.appendChild(productModel);

            // Specifications section
            const specsSection = document.createElement('div');
            specsSection.className = 'specs-section';

            const specsTitle = document.createElement('h4');
            specsTitle.className = 'section-title';
            specsTitle.textContent = 'ESPECIFICACIONES TÉCNICAS';
            specsSection.appendChild(specsTitle);

            const specsList = document.createElement('div');
            specsList.className = 'specs-list';

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
            cardRight.appendChild(specsSection);

            // Technical Drawing section
            if (item.dibujo) {
                const drawingSection = document.createElement('div');
                drawingSection.className = 'drawing-section';

                const drawingTitle = document.createElement('h4');
                drawingTitle.className = 'section-title';
                drawingTitle.textContent = 'GRÁFICO DE DIMENSIONES';
                drawingSection.appendChild(drawingTitle);

                const drawingContainer = document.createElement('div');
                drawingContainer.className = 'drawing-container';

                const drawingImg = document.createElement('img');
                drawingImg.className = 'drawing-img';
                drawingImg.src = item.dibujo;
                drawingImg.alt = `Dimensiones de ${item.nombre}`;
                drawingImg.loading = 'lazy';
                drawingImg.onerror = () => { drawingSection.style.display = 'none'; };
                drawingContainer.appendChild(drawingImg);
                
                drawingSection.appendChild(drawingContainer);
                cardRight.appendChild(drawingSection);
            }

            card.appendChild(cardLeft);
            card.appendChild(cardRight);
            grid.appendChild(card);
        });

        section.appendChild(grid);
        container.appendChild(section);
    });
}

// RENDER FLIPBOOK VIEW (Landscape Layout to match List view card)
function renderFlipbook() {
    const container = document.getElementById('bookContainer');
    container.innerHTML = '';
    categoryPageMap = {};

    const filteredItems = getFilteredItems();

    // 1. Front Cover Page (Landscape 1050x560)
    const coverPage = document.createElement('div');
    coverPage.className = 'page -cover';
    coverPage.style.width = '1050px';
    coverPage.style.height = '560px';
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
        noResultsPage.style.width = '1050px';
        noResultsPage.style.height = '560px';
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
    indexPage.style.width = '1050px';
    indexPage.style.height = '560px';
    
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

    // 3. Product Pages (Landscape - Exact match of list view card layout)
    sortedCategories.forEach(cat => {
        // Map category starting page
        categoryPageMap[cat] = pageIndex;

        grouped[cat].forEach(item => {
            const specs = parseSpecifications(item.especificaciones, item);

            const page = document.createElement('div');
            page.className = 'page';
            page.style.width = '1050px';
            page.style.height = '560px';
            page.style.padding = '0';
            
            page.innerHTML = `
                <div class="page-content" style="height: 100%; display: flex; flex-direction: row; box-sizing: border-box; overflow: hidden; width: 100%;">
                    <!-- Left: Context Image -->
                    <div style="flex: 1.1; height: 100%; position: relative; overflow: hidden; background-color: #EFECE6;">
                        <img src="${item.imgContexto || item.img || ''}" style="width: 100%; height: 100%; object-fit: cover; display: block;" alt="${item.nombre}" onerror="this.style.display='none'">
                    </div>
                    
                    <!-- Right: Product Details -->
                    <div style="flex: 1.2; padding: 2.5rem; display: flex; flex-direction: column; justify-content: flex-start; box-sizing: border-box; height: 100%; overflow: hidden;">
                        
                        <!-- Category name -->
                        <div style="text-align: left; margin-bottom: 0.3rem;">
                            <span style="font-family: var(--font-sans); font-size: 0.75rem; font-weight: 600; color: var(--sielu-accent); text-transform: uppercase; letter-spacing: 1px;">${cat}</span>
                        </div>

                        <!-- Title & Model -->
                        <h3 style="font-family: 'Poppins', sans-serif; font-size: 1.7rem; font-weight: 600; text-align: left; color: var(--sielu-text-dark); margin: 0 0 0.2rem; line-height: 1.3; text-transform: uppercase;">${item.nombre}</h3>
                        <p style="font-family: var(--font-sans); font-size: 0.85rem; font-weight: 500; color: var(--sielu-text-muted); text-align: left; letter-spacing: 1px; margin: 0 0 1.5rem; text-transform: uppercase;">MODEL: ${item.codigo}</p>
                        
                        <!-- Specs -->
                        <div class="specs-section" style="width: 100%; margin-bottom: 1.5rem;">
                            <h4 style="font-family: 'Cormorant Garamond', serif; font-size: 1.1rem; font-weight: 700; color: var(--sielu-text-dark); letter-spacing: 1.5px; margin-bottom: 0.6rem; text-transform: uppercase; border-bottom: 1px solid #ECE7DB; padding-bottom: 2px;">ESPECIFICACIONES TÉCNICAS</h4>
                            <div class="specs-list" style="display: flex; flex-direction: column; gap: 0.4rem;">
                                ${specs.length > 0 ? specs.slice(0, 6).map(spec => `
                                    <div class="spec-item" style="display: flex; align-items: baseline; justify-content: space-between; width: 100%;">
                                        <span class="spec-label" style="font-family: var(--font-sans); font-weight: 600; font-size: 0.8rem; color: var(--sielu-text-dark); text-transform: uppercase; white-space: nowrap;">${spec.label}</span>
                                        <span class="spec-dots" style="flex-grow: 1; border-bottom: 1px dotted #B0A795; margin: 0 8px; align-self: flex-end; margin-bottom: 3px;"></span>
                                        <span class="spec-value" style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--sielu-text-dark); text-align: right; word-break: break-word;">${spec.value}</span>
                                    </div>
                                `).join('') : `
                                    <div style="font-family: var(--font-sans); font-size: 0.8rem; color: #888; font-style: italic;">Sin especificaciones disponibles</div>
                                `}
                            </div>
                        </div>
                        
                        <!-- Drawing -->
                        ${item.dibujo ? `
                        <div class="drawing-section" style="width: 100%; margin-top: auto;">
                            <h4 style="font-family: 'Cormorant Garamond', serif; font-size: 1.05rem; font-weight: 700; color: var(--sielu-text-dark); letter-spacing: 1.5px; margin-bottom: 0.5rem; text-transform: uppercase;">GRÁFICO DE DIMENSIONES</h4>
                            <div class="drawing-container" style="display: flex; justify-content: flex-end; align-items: center; width: 100%; margin-top: 0.2rem; height: 95px;">
                                <img class="drawing-img" src="${item.dibujo}" style="max-height: 90px; max-width: 100%; object-fit: contain; mix-blend-mode: multiply; filter: contrast(1.1);" alt="Dimensiones" onerror="this.parentNode.parentNode.style.display='none'">
                            </div>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;
            container.appendChild(page);
            pageIndex++;
        });
    });

    // 4. Back Cover Page (Landscape)
    const backCoverPage = document.createElement('div');
    backCoverPage.className = 'page -cover';
    backCoverPage.style.width = '1050px';
    backCoverPage.style.height = '560px';
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
    if (pageFlipInstance) {
        pageFlipInstance.destroy();
    }
    
    const container = document.getElementById('bookContainer');
    const pages = container.querySelectorAll('.page');
    
    pageFlipInstance = new PageFlip(container, {
        width: 1050, // base page width (landscape)
        height: 560, // base page height (landscape)
        size: "stretch",
        minWidth: 500,
        maxWidth: 1100,
        minHeight: 250,
        maxHeight: 595,
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
            renderFlipbook();
            initPageFlip();
        } else {
            currentView = 'list';
            flipbookMain.style.display = 'none';
            catalogMain.style.display = 'block';
            viewToggleText.textContent = 'Vista Flipbook';
            viewToggleIcon.textContent = '📖';
            
            if (pageFlipInstance) {
                pageFlipInstance.destroy();
                pageFlipInstance = null;
            }
            
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
        renderFlipbook();
        initPageFlip();
    }
});

// Initialize fetch
fetchProducts();
