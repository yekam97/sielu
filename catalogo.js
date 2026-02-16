import { collection, getDocs, query, doc, getDoc } from "firebase/firestore";
import { db } from "./firebase-config.js";

let allProducts = [];
let categoryOrder = [];

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

        renderCatalog();
    } catch (error) {
        console.error("Error fetching products: ", error);
        document.getElementById('catalogContent').innerHTML = '<p>Error cargando el catálogo.</p>';
    }
}

function renderCatalog(filter = '') {
    const container = document.getElementById('catalogContent');
    container.innerHTML = '';

    let items = allProducts.filter(p => p.estado !== 'No disponible');

    if (filter) {
        const lowerFilter = filter.toLowerCase();
        items = items.filter(item =>
            item.nombre.toLowerCase().includes(lowerFilter) ||
            item.codigo.toLowerCase().includes(lowerFilter) ||
            item.cat.toLowerCase().includes(lowerFilter)
        );
    }

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

    let globalIndex = 1;

    sortedCategories.forEach(cat => {
        // We could add a category title if needed, but the image shows a continuous layout
        grouped[cat].forEach(item => {
            const itemEl = document.createElement('div');
            itemEl.className = 'catalog-item';

            itemEl.innerHTML = `
                <div class="page-number">${globalIndex++}</div>
                <div class="catalog-left-images">
                    <img src="${item.img}" class="catalog-main-img" alt="${item.nombre}">
                </div>
                <div class="catalog-info">
                    <h2>${item.nombre}</h2>
                    <span class="catalog-id">${item.codigo}</span>
                    <p style="margin-bottom: 2rem;">Chasis de alta calidad para iluminación profesional.</p>
                    
                    <div class="tech-grid">
                        <div class="tech-item">
                            <span class="tech-label">Tipo lámpara</span>
                            <span class="tech-value">${item.cat}</span>
                        </div>
                        <div class="tech-item">
                            <span class="tech-label">Material</span>
                            <span class="tech-value">${item.material}</span>
                        </div>
                        <div class="tech-item">
                            <span class="tech-label">Grado IP</span>
                            <span class="tech-value">${item.ip}</span>
                        </div>
                        <div class="tech-item">
                            <span class="tech-label">Color</span>
                            <span class="tech-value">${item.color}</span>
                        </div>
                        <div class="tech-item">
                            <span class="tech-label">Color Temp.</span>
                            <span class="tech-value">${item.temp}</span>
                        </div>
                        <div class="tech-item">
                            <span class="tech-label">Garantía</span>
                            <span class="tech-value">${item.garantia}</span>
                        </div>
                    </div>
                </div>
                <div class="catalog-right">
                    ${item.dibujo ? `<img src="${item.dibujo}" class="tech-drawing" alt="Dibujo técnico">` : '<span style="color:#ccc italic">Sin dibujo técnico</span>'}
                </div>
            `;
            container.appendChild(itemEl);
        });
    });
}

document.getElementById('searchInput').addEventListener('input', e => renderCatalog(e.target.value));

fetchProducts();
