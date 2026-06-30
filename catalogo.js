import { collection, getDocs, query } from "firebase/firestore";
import { db } from "./firebase-config.js";

let allProducts = [];
let categoryOrder = [];

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

function renderCatalog() {
    const filter = document.getElementById('searchInput').value.toLowerCase();
    const container = document.getElementById('catalogContainer');
    const nav = document.getElementById('catalogNav');
    
    container.innerHTML = '';
    nav.innerHTML = '';

    // Filter items based on search input
    let filteredItems = allProducts;
    if (filter) {
        filteredItems = allProducts.filter(item => 
            item.nombre.toLowerCase().includes(filter) ||
            item.codigo.toLowerCase().includes(filter) ||
            item.cat.toLowerCase().includes(filter)
        );
    }

    if (filteredItems.length === 0) {
        container.innerHTML = '<div class="loading-catalog">No se encontraron productos en el catálogo.</div>';
        return;
    }

    // Group items by category
    const grouped = {};
    filteredItems.forEach(item => {
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

    // Render Navigation and Category Sections
    sortedCategories.forEach((cat, index) => {
        // Safe ID for scrolling anchor
        const catId = `cat-${cat.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase()}`;

        // Create Navigation Tab
        const tab = document.createElement('a');
        tab.className = `catalog-nav-item ${index === 0 ? 'active' : ''}`;
        tab.textContent = cat;
        tab.href = `#${catId}`;
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            const targetEl = document.getElementById(catId);
            if (targetEl) {
                const headerOffset = 140; // Offset for sticky navbar + header
                const elementPosition = targetEl.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
                
                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });
            }
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

            // Title and model
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

function setupScrollListener() {
    const sections = document.querySelectorAll('.catalog-category-section');
    const navItems = document.querySelectorAll('.catalog-nav-item');

    window.addEventListener('scroll', () => {
        let current = '';
        const scrollPosition = window.scrollY + 180; // offset to match header / sticky bar

        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.offsetHeight;
            if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
                current = section.getAttribute('id');
            }
        });

        if (current) {
            navItems.forEach(item => {
                item.classList.remove('active');
                if (item.getAttribute('href') === `#${current}`) {
                    item.classList.add('active');
                }
            });
        }
    });
}

// Search handler
document.getElementById('searchInput').addEventListener('input', renderCatalog);

// Initialize fetch
fetchProducts();
