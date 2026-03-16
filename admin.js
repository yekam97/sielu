import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, query, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase-config.js";

// --- AUTHENTICATION ---
const PASSWORD = "Sielu2026";
const loginModal = document.getElementById('loginModal');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const errorMsg = document.getElementById('errorMsg');

if (!sessionStorage.getItem('sielu_auth')) {
    loginModal.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // Prevent scrolling while logging in

    loginBtn.addEventListener('click', checkPassword);
    passwordInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') checkPassword();
    });
} else {
    // Already authenticated
    fetchProducts();
}

function checkPassword() {
    if (passwordInput.value === PASSWORD) {
        sessionStorage.setItem('sielu_auth', 'true');
        loginModal.style.display = 'none';
        document.body.style.overflow = 'auto';
        fetchProducts();
    } else {
        errorMsg.style.display = 'block';
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
            console.log("Config de categorías cargada:", categoryOrder);
        } else {
            console.log("No se encontró config de categorías, usando vacío.");
            categoryOrder = [];
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
                material: data.Material || '',
                ip: data.IP || '',
                color: data.Color || '',
                temp: data.Temp || '',
                garantia: data.Garantia || '-',
                dibujo: data.Dibujo || '',
                orden: Number(data.Orden ?? data.orden ?? 0),
                estado: data.Estado || 'Disponible'
            });
        });

        // Update categoryOrder if new categories exist
        const currentCats = [...new Set(allProducts.map(p => p.cat))];
        let changed = false;

        // Solo agregar categorías nuevas, no eliminar ni reordenar automáticamente aquí
        currentCats.forEach(cat => {
            if (!categoryOrder.includes(cat)) {
                categoryOrder.push(cat);
                changed = true;
                console.log("Nueva categoría detectada y añadida al final:", cat);
            }
        });

        if (changed) {
            await saveCategoryOrder();
        }

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

    // Sort products within categories: by 'orden' primary, and 'nombre' secondary
    Object.keys(grouped).forEach(cat => {
        grouped[cat].sort((a, b) => {
            const ordA = Number(a.orden) || 0;
            const ordB = Number(b.orden) || 0;
            if (ordA !== ordB) return ordA - ordB;
            return (a.nombre || "").localeCompare(b.nombre || "");
        });
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
                <span style="font-size: 0.8rem; margin-right: 5px;">Orden:</span>
                <input type="number" 
                       class="cat-order-input" 
                       value="${categoryOrder.indexOf(cat) + 1}" 
                       onclick="event.stopPropagation()"
                       onchange="window.updateCategoryOrder(this, '${cat.replace(/'/g, "\\'")}', this.value)"
                       style="width: 50px; padding: 2px; border: 1px solid #ccc; border-radius: 4px; text-align: center;">
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
                <td data-label="Orden">
                    <input type="number" 
                           class="order-input" 
                           value="${item.orden || 0}" 
                           onchange="window.updateProductOrder(this, '${item.id}', this.value)"
                           style="width: 60px; padding: 5px; border: 1px solid #ddd; border-radius: 4px; text-align: center;">
                </td>
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
window.updateCategoryOrder = async (inputEl, catName, newOrder) => {
    let newIdx = parseInt(newOrder) - 1; // 1-based user input
    if (isNaN(newIdx)) return;

    // Normalize index
    const currentIdx = categoryOrder.indexOf(catName);
    if (currentIdx === -1) return;

    if (inputEl) inputEl.style.background = '#e3f2fd'; // Visual feedback "saving"

    // Remove from old position and insert at new
    categoryOrder.splice(currentIdx, 1);

    if (newIdx < 0) newIdx = 0;
    if (newIdx >= categoryOrder.length) {
        categoryOrder.push(catName);
    } else {
        categoryOrder.splice(newIdx, 0, catName);
    }

    try {
        await saveCategoryOrder();
        if (inputEl) inputEl.style.background = '#c8e6c9'; // Success
        setTimeout(() => renderTable(document.getElementById('searchInput').value), 500);
    } catch (e) {
        console.error("Error saving category order:", e);
        if (inputEl) inputEl.style.background = '#ffcdd2'; // Error
    }
};

window.updateProductOrder = async (inputEl, id, newOrder) => {
    const val = Number(newOrder); // Usar Number para consistencia con view.js
    if (isNaN(val)) return;

    try {
        if (inputEl) inputEl.style.background = '#e3f2fd'; // Azul: Guardando

        console.log(`Guardando nuevo orden para ${id}: ${val}`);
        await updateDoc(doc(db, "productos_sielu", id), { Orden: val });

        // Actualizar datos locales
        const item = allProducts.find(p => p.id === id);
        if (item) item.orden = val;

        if (inputEl) {
            inputEl.style.background = '#c8e6c9'; // Verde: Éxito
            setTimeout(() => inputEl.style.background = '', 2000);
        }

        // Re-ordenar la tabla después de un pequeño delay para que el usuario vea el éxito
        setTimeout(() => renderTable(document.getElementById('searchInput').value), 800);
    } catch (e) {
        console.error("Error al guardar el orden del producto:", e);
        if (inputEl) inputEl.style.background = '#ffcdd2'; // Rojo: Error
        alert("Error al guardar. Revisa la consola.");
    }
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
    document.getElementById('material').value = item.material || '';
    document.getElementById('ip').value = item.ip || '';
    document.getElementById('color').value = item.color || '';
    document.getElementById('temp').value = item.temp || '';
    document.getElementById('garantia').value = item.garantia || '';
    document.getElementById('dibujo').value = item.dibujo || '';

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
        Material: document.getElementById('material').value.trim(),
        IP: document.getElementById('ip').value.trim(),
        Color: document.getElementById('color').value.trim(),
        Temp: document.getElementById('temp').value.trim(),
        Garantia: document.getElementById('garantia').value.trim(),
        Dibujo: document.getElementById('dibujo').value.trim(),
        Orden: 0, // Default for new products
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
