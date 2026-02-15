import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, query } from "firebase/firestore";
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

async function fetchProducts() {
    try {
        const q = query(collection(db, "productos_sielu"));
        const querySnapshot = await getDocs(q);

        allProducts = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            allProducts.push({
                id: doc.id,
                cat: data.Categoria || '',
                nombre: data.Nombre || '',
                img: data.Imagen || '',
                codigo: data.CodigoFacturacion || '',
                precio: data.PrecioAntesIVA || 0,
                ficha: data.FichaTecnica || '',
                estado: data.Estado || 'Disponible'
            });
        });

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
            item.codigo.toLowerCase().includes(lowerFilter)
        );
    }

    items.forEach(item => {
        const tr = document.createElement('tr');

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
}

// Exposure to window for onclick handlers
window.toggleStatus = async (id, current) => {
    const next = current === 'Disponible' ? 'No disponible' : 'Disponible';
    await updateDoc(doc(db, "productos_sielu", id), { Estado: next });
    fetchProducts();
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

    document.getElementById('submitBtn').textContent = 'Guardar Cambios';
    document.getElementById('cancelBtn').style.display = 'inline-block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.deleteItem = async (id) => {
    if (confirm('¿Eliminar este producto?')) {
        await deleteDoc(doc(db, "productos_sielu", id));
        fetchProducts();
    }
};

// Form submit
document.getElementById('productForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('productId').value;
    const data = {
        Categoria: document.getElementById('cat').value.trim(),
        Nombre: document.getElementById('nombre').value.trim(),
        CodigoFacturacion: document.getElementById('codigo').value.trim(),
        PrecioAntesIVA: parseFloat(document.getElementById('price').value),
        Imagen: document.getElementById('img').value.trim(),
        FichaTecnica: document.getElementById('sheet').value.trim(),
        fechaUpdate: new Date()
    };

    try {
        if (id) {
            await updateDoc(doc(db, "productos_sielu", id), data);
        } else {
            data.Estado = 'Disponible';
            await addDoc(collection(db, "productos_sielu"), data);
        }
        document.getElementById('productForm').reset();
        document.getElementById('productId').value = '';
        document.getElementById('submitBtn').textContent = 'Agregar Producto';
        document.getElementById('cancelBtn').style.display = 'none';
        fetchProducts();
        alert('Éxito');
    } catch (err) {
        alert('Error: ' + err.message);
    }
});

document.getElementById('searchInput').addEventListener('input', e => renderTable(e.target.value));

document.getElementById('cancelBtn').onclick = () => {
    document.getElementById('productForm').reset();
    document.getElementById('productId').value = '';
    document.getElementById('submitBtn').textContent = 'Agregar Producto';
    document.getElementById('cancelBtn').style.display = 'none';
};

fetchProducts();
