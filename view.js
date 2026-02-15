import { collection, getDocs, query } from "firebase/firestore";
import { db } from "./firebase-config.js";

let allProducts = [];

// Sielu specific categories (can be expanded)
const CATEGORY_ORDER = [
    "BALAS PARA LED/GU10",
    "BALAS PARA GU10",
    "CINTAS LED",
    "PERFILES"
];

async function fetchProducts() {
    try {
        const q = query(collection(db, "productos_sielu"));
        const querySnapshot = await getDocs(q);

        allProducts = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            allProducts.push({
                id: doc.id,
                nombre: data.Nombre || '',
                cat: data.Categoria || 'General',
                img: data.Imagen || '',
                codigo: data.CodigoFacturacion || '',
                precio: data.PrecioAntesIVA || 0,
                ficha: data.FichaTecnica || '',
                estado: data.Estado || 'Disponible'
            });
        });

        renderTable();
    } catch (error) {
        console.error("Error fetching products: ", error);
        // Fallback for demo if no DB configured
        showEmptyState();
    }
}

function showEmptyState() {
    const tbody = document.querySelector('#priceTable tbody');
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem;">No se pudieron cargar los datos. Verifica la configuración de Firebase.</td></tr>`;
}

function renderTable(filter = '') {
    const tbody = document.querySelector('#priceTable tbody');
    tbody.innerHTML = '';

    let items = [...allProducts];

    // Filter by Status
    items = items.filter(item => item.estado !== 'No disponible');

    // Filter by search text
    if (filter) {
        const lowerFilter = filter.toLowerCase();
        items = items.filter(item =>
            item.nombre.toLowerCase().includes(lowerFilter) ||
            item.codigo.toLowerCase().includes(lowerFilter) ||
            item.cat.toLowerCase().includes(lowerFilter)
        );
    }

    // Group by category
    const grouped = {};
    items.forEach(item => {
        const cat = item.cat;
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(item);
    });

    const sortedCategories = Object.keys(grouped).sort((a, b) => {
        const indexA = CATEGORY_ORDER.indexOf(a);
        const indexB = CATEGORY_ORDER.indexOf(b);
        if (indexA === -1 && indexB === -1) return a.localeCompare(b);
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
    });

    if (items.length === 0 && allProducts.length > 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem;">No se encontraron resultados.</td></tr>`;
        return;
    }

    sortedCategories.forEach(cat => {
        // Category Header
        const catRow = document.createElement('tr');
        catRow.className = 'category-header';
        catRow.innerHTML = `<td colspan="5">${cat}</td>`;
        tbody.appendChild(catRow);

        grouped[cat].forEach(item => {
            const tr = document.createElement('tr');

            // Imagen
            const tdImg = document.createElement('td');
            tdImg.setAttribute('data-label', 'Imagen');
            const img = document.createElement('img');
            img.src = item.img || 'placeholder.png';
            img.className = 'product-img';
            img.onerror = () => { img.style.display = 'none'; };
            tdImg.appendChild(img);
            tr.appendChild(tdImg);

            // Nombre
            const tdName = document.createElement('td');
            tdName.setAttribute('data-label', 'Nombre');
            tdName.textContent = item.nombre;
            tr.appendChild(tdName);

            // Código
            const tdCode = document.createElement('td');
            tdCode.setAttribute('data-label', 'Código Facturación');
            tdCode.textContent = item.codigo;
            tr.appendChild(tdCode);

            // Precio
            const tdPrice = document.createElement('td');
            tdPrice.setAttribute('data-label', 'Precio antes de IVA');
            tdPrice.className = 'price-cell';
            const priceVal = parseFloat(item.precio);
            tdPrice.textContent = isNaN(priceVal) ? item.precio : "$" + priceVal.toLocaleString('es-CO');
            tr.appendChild(tdPrice);

            // Ficha
            const tdFicha = document.createElement('td');
            tdFicha.setAttribute('data-label', 'Ficha Técnica');
            if (item.ficha) {
                const a = document.createElement('a');
                a.href = item.ficha;
                a.target = '_blank';
                a.className = 'btn-ficha';
                a.textContent = 'Ver Ficha';
                tdFicha.appendChild(a);
            } else {
                tdFicha.textContent = '-';
            }
            tr.appendChild(tdFicha);

            tbody.appendChild(tr);
        });
    });
}

// Search handler
document.getElementById('searchInput').addEventListener('input', e => {
    renderTable(e.target.value);
});

// PDF Export Logic (Simplified from Briolight)
document.getElementById('btnDownload').addEventListener('click', () => {
    alert("Función de exportación PDF en preparación. Requiere configuración final de imágenes.");
});

// Initialize
fetchProducts();
