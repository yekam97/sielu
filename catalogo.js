import { collection, getDocs, query, doc, getDoc } from "firebase/firestore";
import { db } from "./firebase-config.js";
import { PageFlip } from "page-flip";

let allProducts = [];
let categoryOrder = [];
let pageFlip = null;

async function fetchConfig() {
    try {
        const configRef = doc(db, "sielu_config", "categories");
        const configSnap = await getDoc(configRef);
        if (configSnap.exists()) {
            categoryOrder = configSnap.data().order || [];
        }
    } catch (error) {
        console.error("Error fetching config:", error);
    }
}

async function fetchProducts() {
    try {
        await fetchConfig();
        const q = query(collection(db, "productos_sielu"));
        const querySnapshot = await getDocs(q);

        allProducts = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            allProducts.push({
                id: doc.id,
                nombre: data.Nombre || '',
                cat: data.Categoria || 'Sin Categoría',
                img: data.Imagen || '',
                codigo: data.CodigoFacturacion || '',
                material: data.Material || '-',
                ip: data.IP || '-',
                color: data.Color || '-',
                temp: data.Temp || '-',
                garantia: data.Garantia || '-',
                dibujo: data.Dibujo || '',
                estado: data.Estado || 'Disponible'
            });
        });

        // Group and prepare pages
        renderBook();
    } catch (error) {
        console.error("Error fetching products: ", error);
        document.getElementById('bookContainer').innerHTML = '<p>Error cargando el catálogo interactivo.</p>';
    }
}

function renderBook() {
    const container = document.getElementById('bookContainer');
    container.innerHTML = '';

    const items = allProducts.filter(p => p.estado !== 'No disponible');

    const grouped = {};
    items.forEach(item => {
        const cat = item.cat;
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(item);
    });

    const sortedCategories = categoryOrder.filter(cat => grouped[cat]);
    Object.keys(grouped).forEach(cat => {
        if (!sortedCategories.includes(cat)) sortedCategories.push(cat);
    });

    // 1. Portada
    const cover = document.createElement('div');
    cover.className = 'page -cover';
    cover.setAttribute('data-density', 'hard');
    cover.innerHTML = `
        <div class="page-content">
            <p style="font-family: var(--font-serif); font-size: 1.5rem; color: rgba(26,26,26,0.6);">Sielu</p>
            <h1 style="font-family: var(--font-serif); font-size: 4rem; margin: 1rem 0;">Catálogo Visual</h1>
            <p style="font-family: var(--font-serif); font-size: 1.2rem;">Colección Profesional 2026</p>
            <div style="margin-top: 4rem; width: 60px; height: 2px; background: var(--sielu-text-dark);"></div>
        </div>
    `;
    container.appendChild(cover);

    // 2. Páginas de productos (2 por spread -> 1 por página física para mayor claridad visual)
    let pageCounter = 1;
    sortedCategories.forEach(cat => {
        grouped[cat].forEach(item => {
            const pageEl = document.createElement('div');
            pageEl.className = 'page';
            pageEl.innerHTML = `
                <div class="page-content">
                    <div class="page-catalog-item">
                        <div class="page-info-header">
                            <h2>${item.nombre}</h2>
                            <span style="font-size: 0.9rem; color: #888;">${item.codigo}</span>
                        </div>
                        
                        <div style="text-align: center; margin: 1rem 0;">
                            <img src="${item.img}" style="max-height: 200px; width: auto; max-width: 100%; object-fit: contain;">
                        </div>

                        <div class="page-tech-grid">
                            <div><span style="color:var(--sielu-accent); display:block; font-size: 0.75rem;">Material</span> <b>${item.material}</b></div>
                            <div><span style="color:var(--sielu-accent); display:block; font-size: 0.75rem;">Grado IP</span> <b>${item.ip}</b></div>
                            <div><span style="color:var(--sielu-accent); display:block; font-size: 0.75rem;">Color</span> <b>${item.color}</b></div>
                            <div><span style="color:var(--sielu-accent); display:block; font-size: 0.75rem;">Temp.</span> <b>${item.temp}</b></div>
                        </div>

                        ${item.dibujo ? `
                        <div class="page-drawing-box">
                            <img src="${item.dibujo}" class="page-tech-drawing" alt="Dibujo técnico">
                        </div>
                        ` : ''}
                    </div>
                    <div class="page-footer">Página ${pageCounter++}</div>
                </div>
            `;
            container.appendChild(pageEl);
        });
    });

    // 3. Contraportada
    const backCover = document.createElement('div');
    backCover.className = 'page -cover';
    backCover.setAttribute('data-density', 'hard');
    backCover.innerHTML = `
        <div class="page-content">
            <h2 style="font-family: var(--font-serif);">SIELU</h2>
            <p>Iluminación que inspira</p>
        </div>
    `;
    container.appendChild(backCover);

    initFlipbook();
}

function initFlipbook() {
    const screenWidth = window.innerWidth;
    const isMobile = screenWidth < 768;

    pageFlip = new PageFlip(document.getElementById('bookContainer'), {
        width: 550, // base page width
        height: 750, // base page height
        size: "fit", // usar 'fit' asegura que mantenga la proporción y no te aplaste el contenido
        minWidth: isMobile ? 320 : 450,
        maxWidth: 1000,
        minHeight: isMobile ? 500 : 700,
        maxHeight: 1350,
        maxShadowOpacity: 0.5,
        showCover: true,
        mobileScrollSupport: false // true if we want to allow scrolling on mobile
    });

    pageFlip.loadFromHTML(document.querySelectorAll('.page'));

    document.getElementById('pageControls').style.display = 'flex';
    updateCounter();

    pageFlip.on('flip', (e) => {
        updateCounter();
    });

    document.getElementById('btnNext').onclick = () => pageFlip.flipNext();
    document.getElementById('btnPrev').onclick = () => pageFlip.flipPrev();
}

function updateCounter() {
    const current = pageFlip.getCurrentPageIndex() + 1;
    const total = pageFlip.getPageCount();
    document.getElementById('pageCounter').innerText = `${current} / ${total}`;
}

fetchProducts();
