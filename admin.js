import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, query, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase-config.js";

// --- AUTHENTICATION ---
const PASSWORD = "Sielu2026";
if (!sessionStorage.getItem('sielu_auth')) {
    const input = prompt("Introduce la contraseña de administrador Sielu:");
    if (input === PASSWORD) {
        sessionStorage.setItem('sielu_auth', 'true');
    } else {
        alert("Contraseña incorrecta.");
        window.location.href = "index.html";
    }
}

let allProducts = [];
let categoryOrder = [];
let collapsedCategories = new Set();

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

async function saveCategoryOrder() {
    try {
        const configRef = doc(db, "sielu_config", "categories");
        await setDoc(configRef, { order: categoryOrder }, { merge: true });
    } catch (error) {
        console.error("Error saving category order:", error);
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
                cat: data.Categoria || 'Sin Categoría',
                nombre: data.Nombre || '',
                img: data.Imagen || '',
                codigo: data.CodigoFacturacion || '',
                precio: data.PrecioAntesIVA || 0,
                ficha: data.FichaTecnica || '',
                estado: data.Estado || 'Disponible'
            });
        });

        // Update categoryOrder if new categories exist
        const currentCats = [...new Set(allProducts.map(p => p.cat))];
        let changed = false;
        currentCats.forEach(cat => {
            if (!categoryOrder.includes(cat)) {
                categoryOrder.push(cat);
                changed = true;
            }
        });

        // Remove empty categories from tracker
        const oldLen = categoryOrder.length;
        categoryOrder = categoryOrder.filter(cat => currentCats.includes(cat));
        if (oldLen !== categoryOrder.length) changed = true;

        if (changed) await saveCategoryOrder();

        renderTable(document.getElementById('searchInput').value);
    } catch (error) {
        console.error("Error fetching products: ", error);
    }
}

function renderTable(filter = '') {
    const tbody = document.querySelector('#adminTable tbody');
    tbody.innerHTML = '';

    let items = [...allProducts];

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

    sortedCategories.forEach((cat, index) => {
        const isCollapsed = collapsedCategories.has(cat);

        const catRow = document.createElement('tr');
        catRow.className = 'category-header' + (isCollapsed ? ' collapsed' : '');

        const catCell = document.createElement('td');
        catCell.colSpan = 8;

        const headerContent = document.createElement('div');
        headerContent.className = 'category-header-content';
        headerContent.innerHTML = `
            <div>
                <span class="toggle-icon">${isCollapsed ? '▶' : '▼'}</span>
                <span>${cat}</span>
            </div>
            <div class="category-controls">
                <button class="category-btn" ${index === 0 ? 'disabled' : ''} onclick="event.stopPropagation(); window.moveCategory('${cat}', -1)">▲</button>
                <button class="category-btn" ${index === sortedCategories.length - 1 ? 'disabled' : ''} onclick="event.stopPropagation(); window.moveCategory('${cat}', 1)">▼</button>
            </div>
        `;

        catCell.onclick = () => {
            if (collapsedCategories.has(cat)) {
                collapsedCategories.delete(cat);
            } else {
                collapsedCategories.add(cat);
            }
            renderTable(document.getElementById('searchInput').value);
        };

        catCell.appendChild(headerContent);
        catRow.appendChild(catCell);
        tbody.appendChild(catRow);

        grouped[cat].forEach((item) => {
            const tr = document.createElement('tr');
            if (isCollapsed) tr.classList.add('hidden');

            tr.innerHTML = `
                <td data-label="Imagen"><img src="${item.img || ''}" class="product-img" onerror="this.style.display='none'"></td>
                <td data-label="Producto">
                    <strong>${item.nombre}</strong><br>
                    <small>${item.cat}</small>
                </td>
                <td data-label="Código">${item.codigo}</td>
                <td data-label="Precio">$${parseFloat(item.precio).toLocaleString('es-CO')}</td>
                <td data-label="Estado">
                    <button class="btn-toggle ${item.estado === 'Disponible' ? 'available' : ''}" onclick="window.toggleStatus('${item.id}', '${item.estado}')">
                        ${item.estado}
                    </button>
                </td>
                <td data-label="Acciones">
                    <button class="btn-edit" onclick="window.editItem('${item.id}')">Editar</button>
                    <button class="btn-delete" style="background:#ff5252; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;" onclick="window.deleteItem('${item.id}')">Eliminar</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    });
}

// --- WINDOW HELPERS ---
window.moveCategory = async (cat, direction) => {
    const index = categoryOrder.indexOf(cat);
    if (index === -1) return;
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= categoryOrder.length) return;

    [categoryOrder[index], categoryOrder[newIndex]] = [categoryOrder[newIndex], categoryOrder[index]];
    await saveCategoryOrder();
    renderTable(document.getElementById('searchInput').value);
};

window.toggleStatus = async (id, currentStatus) => {
    try {
        const newStatus = currentStatus === 'Disponible' ? 'No disponible' : 'Disponible';
        await updateDoc(doc(db, "productos_sielu", id), { Estado: newStatus });
        await fetchProducts();
    } catch (e) {
        console.error("Error updating status: ", e);
    }
};

window.deleteItem = async (id) => {
    if (confirm('¿Eliminar este producto?')) {
        try {
            await deleteDoc(doc(db, "productos_sielu", id));
            await fetchProducts();
        } catch (e) {
            console.error("Error deleting doc: ", e);
        }
    }
};

window.editItem = (id) => {
    const item = allProducts.find(i => i.id === id);
    if (!item) return;

    document.getElementById('productId').value = item.id;
    document.getElementById('cat').value = item.cat;
    document.getElementById('nombre').value = item.nombre;
    document.getElementById('codigo').value = item.codigo;
    document.getElementById('price').value = item.precio;
    document.getElementById('img').value = item.img;
    document.getElementById('sheet').value = item.ficha;

    document.getElementById('submitBtn').textContent = 'Guardar cambios';
    document.getElementById('cancelBtn').style.display = 'block';
    document.getElementById('productForm').classList.add('editing');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// --- FORM HANDLING ---
const form = document.getElementById('productForm');
const submitBtn = document.getElementById('submitBtn');
const cancelBtn = document.getElementById('cancelBtn');

function resetForm() {
    form.reset();
    document.getElementById('productId').value = '';
    submitBtn.textContent = 'Agregar producto';
    cancelBtn.style.display = 'none';
    form.classList.remove('editing');
}

cancelBtn.addEventListener('click', resetForm);

form.addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('productId').value;
    const cat = document.getElementById('cat').value.trim();
    const data = {
        Categoria: cat,
        Nombre: document.getElementById('nombre').value.trim(),
        CodigoFacturacion: document.getElementById('codigo').value.trim(),
        PrecioAntesIVA: parseFloat(document.getElementById('price').value),
        Imagen: document.getElementById('img').value.trim(),
        FichaTecnica: document.getElementById('sheet').value.trim(),
        fechaUpdate: new Date()
    };

    submitBtn.disabled = true;
    try {
        if (id) {
            await updateDoc(doc(db, "productos_sielu", id), data);
        } else {
            data.Estado = 'Disponible';
            await addDoc(collection(db, "productos_sielu"), data);
        }

        if (!categoryOrder.includes(cat)) {
            categoryOrder.push(cat);
            await saveCategoryOrder();
        }

        resetForm();
        await fetchProducts();
    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        submitBtn.disabled = false;
    }
});

document.getElementById('searchInput').addEventListener('input', e => renderTable(e.target.value));

fetchProducts();
