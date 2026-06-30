import { collection, getDocs, query } from "firebase/firestore";
import { db } from "./firebase-config.js";
import { PageFlip } from "page-flip";

let allProducts = [];
let categoryOrder = [];
let pageFlipInstance = null;
let currentView = 'list'; // 'list' or 'flipbook'

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

// RENDER FLIPBOOK VIEW
function renderFlipbook() {
    const container = document.getElementById('bookContainer');
    container.innerHTML = '';

    const filteredItems = getFilteredItems();

    // 1. Front Cover Page
    const coverPage = document.createElement('div');
    coverPage.className = 'page -cover';
    coverPage.setAttribute('data-density', 'hard');
    coverPage.innerHTML = `
        <div class="page-content" style="justify-content: center; align-items: center; text-align: center; height: 100%; padding: 2rem;">
            <p style="font-family: var(--font-sans); font-size: 0.85rem; letter-spacing: 5px; color: var(--sielu-text-muted); text-transform: uppercase; margin-bottom: 2.5rem;">S I E L U</p>
            <h1 style="font-family: 'Cormorant Garamond', serif; font-size: 3.2rem; font-weight: 300; color: var(--sielu-text-dark); margin: 0 0 1rem; letter-spacing: 2px; text-transform: uppercase; line-height: 1.2;">Catálogo Técnico</h1>
            <div style="width: 65px; height: 1px; background-color: var(--sielu-accent); margin: 1.5rem auto 2.5rem;"></div>
            <p style="font-family: var(--font-sans); font-size: 0.75rem; letter-spacing: 3px; color: var(--sielu-text-muted); text-transform: uppercase;">Volumen 01</p>
        </div>
    `;
    container.appendChild(coverPage);

    if (filteredItems.length === 0) {
        const noResultsPage = document.createElement('div');
        noResultsPage.className = 'page';
        noResultsPage.innerHTML = `
            <div class="page-content" style="justify-content: center; align-items: center; text-align: center; height: 100%;">
                <p style="font-family: var(--font-sans); font-size: 1rem; color: var(--sielu-text-muted);">No se encontraron productos para esta búsqueda.</p>
            </div>
        `;
        container.appendChild(noResultsPage);
        return;
    }

    const { grouped, sortedCategories } = getGroupedAndSortedItems(filteredItems);

    // 2. Index Page
    const indexPage = document.createElement('div');
    indexPage.className = 'page';
    let indexHtml = `
        <div class="page-content" style="height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 1.5rem 0;">
            <h2 style="font-family: 'Cormorant Garamond', serif; font-size: 2.4rem; font-weight: 400; color: var(--sielu-text-dark); margin-bottom: 2rem; text-align: center; text-transform: uppercase; letter-spacing: 1px;">Contenido</h2>
            <div style="display: flex; flex-direction: column; gap: 0.8rem; width: 100%; max-width: 320px; margin: 0 auto;">
    `;
    sortedCategories.forEach(cat => {
        indexHtml += `
            <div style="display: flex; justify-content: space-between; font-family: var(--font-sans); font-size: 0.8rem; border-bottom: 1px dotted #B0A795; padding-bottom: 3px;">
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

    // 3. Product Pages
    sortedCategories.forEach(cat => {
        grouped[cat].forEach(item => {
            const specs = parseSpecifications(item.especificaciones, item);

            const page = document.createElement('div');
            page.className = 'page';
            
            page.innerHTML = `
                <div class="page-content" style="height: 100%; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box;">
                    <!-- Product Image -->
                    <div style="width: 100%; height: 260px; overflow: hidden; border-radius: 4px; background-color: #FAF5EE; box-shadow: 0 4px 15px rgba(0,0,0,0.02); border: 1px solid #ECE7DB;">
                        <img src="${item.imgContexto || item.img || ''}" style="width: 100%; height: 100%; object-fit: cover;" alt="${item.nombre}" onerror="this.style.display='none'">
                    </div>
                    
                    <!-- Category Name Tag -->
                    <div style="text-align: left; margin-top: 0.8rem;">
                        <span style="font-family: var(--font-sans); font-size: 0.7rem; font-weight: 600; color: var(--sielu-accent); text-transform: uppercase; letter-spacing: 1px;">${cat}</span>
                    </div>

                    <!-- Product Title & Model (Poppins) -->
                    <div style="text-align: left; margin: 0.2rem 0 0.8rem;">
                        <h3 style="font-family: 'Poppins', sans-serif; font-size: 1.15rem; font-weight: 600; margin: 0 0 0.1rem; color: var(--sielu-text-dark); text-transform: uppercase; line-height: 1.3;">${item.nombre}</h3>
                        <p style="font-family: var(--font-sans); font-size: 0.75rem; font-weight: 500; color: var(--sielu-text-muted); margin: 0; letter-spacing: 0.5px;">MODEL: ${item.codigo}</p>
                    </div>
                    
                    <!-- Specs List (Dotted Leaders) -->
                    <div style="flex-grow: 1; display: flex; flex-direction: column; justify-content: flex-start; margin-bottom: 0.8rem;">
                        <h4 style="font-family: 'Cormorant Garamond', serif; font-size: 0.85rem; font-weight: 700; color: var(--sielu-text-dark); letter-spacing: 1px; margin-bottom: 0.4rem; text-transform: uppercase; border-bottom: 1px solid #ECE7DB; padding-bottom: 2px;">Especificaciones</h4>
                        <div style="display: flex; flex-direction: column; gap: 0.35rem;">
                            ${specs.length > 0 ? specs.slice(0, 6).map(spec => `
                                <div style="display: flex; align-items: baseline; justify-content: space-between; width: 100%;">
                                    <span style="font-family: var(--font-sans); font-weight: 600; font-size: 0.65rem; color: var(--sielu-text-dark); text-transform: uppercase; white-space: nowrap;">${spec.label}</span>
                                    <span style="flex-grow: 1; border-bottom: 1px dotted #B0A795; margin: 0 4px; align-self: flex-end; margin-bottom: 2px;"></span>
                                    <span style="font-family: var(--font-sans); font-size: 0.7rem; color: var(--sielu-text-dark); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60%;">${spec.value}</span>
                                </div>
                            `).join('') : `
                                <div style="font-family: var(--font-sans); font-size: 0.7rem; color: #888; font-style: italic;">Sin especificaciones disponibles</div>
                            `}
                        </div>
                    </div>
                    
                    <!-- Technical Drawing -->
                    ${item.dibujo ? `
                    <div style="border-top: 1px solid #ECE7DB; padding-top: 0.4rem; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 85px;">
                        <img src="${item.dibujo}" style="max-height: 75px; max-width: 100%; object-fit: contain; mix-blend-mode: multiply;" alt="Dimensiones" onerror="this.parentNode.style.display='none'">
                    </div>
                    ` : ''}
                </div>
            `;
            container.appendChild(page);
        });
    });

    // 4. Back Cover Page
    const backCoverPage = document.createElement('div');
    backCoverPage.className = 'page -cover';
    backCoverPage.setAttribute('data-density', 'hard');
    backCoverPage.innerHTML = `
        <div class="page-content" style="justify-content: center; align-items: center; text-align: center; height: 100%; padding: 2rem;">
            <img src="/logo.png" style="max-width: 160px; margin-bottom: 2rem; display: block;" alt="Sielu Logo" onerror="this.style.display='none'">
            <div style="width: 40px; height: 1px; background-color: var(--sielu-accent); margin: 1.5rem auto;"></div>
            <p style="font-family: var(--font-sans); font-size: 0.8rem; color: var(--sielu-text-muted); margin-bottom: 0.4rem; letter-spacing: 1px;">sielu.design</p>
            <p style="font-family: var(--font-sans); font-size: 0.8rem; color: var(--sielu-text-muted); letter-spacing: 0.5px;">+57 314 2188971</p>
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
        width: 550, // base page width
        height: 750, // base page height
        size: "stretch",
        minWidth: 315,
        maxWidth: 1000,
        minHeight: 420,
        maxHeight: 1350,
        maxShadowOpacity: 0.4,
        showCover: true,
        mobileScrollSupport: false
    });
    
    pageFlipInstance.loadFromHTML(pages);
    
    // Update page counter
    updatePageCounter();
    
    pageFlipInstance.on('flip', () => {
        updatePageCounter();
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
const categoryDropdownWrapper = document.getElementById('categoryDropdownWrapper');
const viewToggleText = document.getElementById('viewToggleText');
const viewToggleIcon = document.getElementById('viewToggleIcon');

if (viewToggleBtn) {
    viewToggleBtn.addEventListener('click', () => {
        if (currentView === 'list') {
            currentView = 'flipbook';
            catalogMain.style.display = 'none';
            if (categoryDropdownWrapper) categoryDropdownWrapper.style.display = 'none';
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
            if (categoryDropdownWrapper) categoryDropdownWrapper.style.display = 'block';
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
