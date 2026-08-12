import { collection, getDocs, query, doc, updateDoc } from "firebase/firestore";
import { db } from "./firebase-config.js";

const PASSWORD = "Sielu2026";
const loginModal = document.getElementById('loginModal');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const errorMsg = document.getElementById('errorMsg');
const configurator = document.getElementById('catalogConfigurator');
const searchInput = document.getElementById('searchInput');

let allProducts = [];
let categoryOrder = [];

function authenticate() {
    if (passwordInput.value !== PASSWORD) {
        errorMsg.style.display = 'block';
        return;
    }
    sessionStorage.setItem('sielu_auth', 'true');
    loginModal.style.display = 'none';
    document.body.style.overflow = 'auto';
    fetchProducts();
}

if (sessionStorage.getItem('sielu_auth')) {
    loginModal.style.display = 'none';
    fetchProducts();
} else {
    document.body.style.overflow = 'hidden';
    loginBtn.addEventListener('click', authenticate);
    passwordInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') authenticate();
    });
}

async function fetchProducts() {
    try {
        const snapshot = await getDocs(query(collection(db, 'productos_sielu')));
        allProducts = [];
        categoryOrder = [];

        snapshot.forEach(productDoc => {
            if (productDoc.id === '--category-config--') {
                categoryOrder = productDoc.data().order || [];
                return;
            }

            const data = productDoc.data();
            allProducts.push({
                id: productDoc.id,
                category: data.Categoria || 'Sin Categoría',
                name: data.Nombre || 'Producto sin nombre',
                code: data.CodigoFacturacion || '',
                image: data.Imagen || '',
                contextImage: data.ImgContexto || '',
                drawing: data.Dibujo || '',
                specifications: data.Especificaciones || '',
                order: Number(data.Orden ?? data.orden ?? 0)
            });
        });

        renderProducts();
    } catch (error) {
        console.error('Error al cargar productos:', error);
        configurator.innerHTML = '<p class="loading-catalog">No fue posible cargar los productos.</p>';
    }
}

function getOrderedGroups() {
    const filter = searchInput.value.trim().toLowerCase();
    const products = allProducts.filter(product => !filter || [product.name, product.code, product.category]
        .some(value => value.toLowerCase().includes(filter)));
    const groups = new Map();

    products.forEach(product => {
        if (!groups.has(product.category)) groups.set(product.category, []);
        groups.get(product.category).push(product);
    });

    groups.forEach(items => items.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)));
    const orderedCategories = categoryOrder.filter(category => groups.has(category));
    [...groups.keys()].forEach(category => {
        if (!orderedCategories.includes(category)) orderedCategories.push(category);
    });
    return { groups, orderedCategories };
}

function addField(form, labelText, className, value, multiline = false) {
    const field = document.createElement('label');
    field.className = 'catalog-config-field';
    const label = document.createElement('span');
    label.textContent = labelText;
    const control = multiline ? document.createElement('textarea') : document.createElement('input');
    control.className = className;
    control.value = value;
    if (multiline) {
        control.rows = 7;
        control.placeholder = 'Ejemplo: MATERIAL: Aluminio\nCOLOR: Negro';
    } else {
        control.type = 'url';
        control.placeholder = 'https://...';
    }
    field.append(label, control);
    form.appendChild(field);
}

function renderProducts() {
    configurator.innerHTML = '';
    const { groups, orderedCategories } = getOrderedGroups();

    if (!orderedCategories.length) {
        configurator.innerHTML = '<p class="loading-catalog">No se encontraron productos.</p>';
        return;
    }

    orderedCategories.forEach(category => {
        const section = document.createElement('section');
        section.className = 'catalog-config-category';
        const heading = document.createElement('h2');
        heading.textContent = category;
        section.appendChild(heading);

        groups.get(category).forEach(product => {
            const form = document.createElement('form');
            form.className = 'catalog-config-product';

            const identity = document.createElement('div');
            identity.className = 'catalog-config-identity';
            const image = document.createElement('img');
            image.src = product.image;
            image.alt = product.name;
            image.loading = 'lazy';
            image.onerror = () => image.style.display = 'none';
            const title = document.createElement('div');
            title.innerHTML = `<strong></strong><small></small>`;
            title.querySelector('strong').textContent = product.name;
            title.querySelector('small').textContent = product.code || 'Sin código';
            identity.append(image, title);
            form.appendChild(identity);

            const fields = document.createElement('div');
            fields.className = 'catalog-config-fields';
            addField(fields, 'URL imagen en contexto', 'context-image-input', product.contextImage);
            addField(fields, 'URL dibujo técnico', 'drawing-input', product.drawing);
            addField(fields, 'Especificaciones técnicas', 'specifications-input', product.specifications, true);
            form.appendChild(fields);

            const actions = document.createElement('div');
            actions.className = 'catalog-config-actions';
            const saveButton = document.createElement('button');
            saveButton.type = 'submit';
            saveButton.className = 'btn-primary';
            saveButton.textContent = 'Guardar cambios';
            const feedback = document.createElement('span');
            feedback.className = 'catalog-config-feedback';
            actions.append(saveButton, feedback);
            form.appendChild(actions);

            form.addEventListener('submit', async event => {
                event.preventDefault();
                saveButton.disabled = true;
                feedback.textContent = 'Guardando...';
                try {
                    const update = {
                        ImgContexto: form.querySelector('.context-image-input').value.trim(),
                        Dibujo: form.querySelector('.drawing-input').value.trim(),
                        Especificaciones: form.querySelector('.specifications-input').value.trim(),
                        fechaUpdate: new Date()
                    };
                    await updateDoc(doc(db, 'productos_sielu', product.id), update);
                    Object.assign(product, {
                        contextImage: update.ImgContexto,
                        drawing: update.Dibujo,
                        specifications: update.Especificaciones
                    });
                    feedback.textContent = 'Guardado';
                } catch (error) {
                    console.error('Error al guardar catálogo:', error);
                    feedback.textContent = 'No se pudo guardar';
                } finally {
                    saveButton.disabled = false;
                    setTimeout(() => feedback.textContent = '', 2500);
                }
            });
            section.appendChild(form);
        });
        configurator.appendChild(section);
    });
}

searchInput.addEventListener('input', renderProducts);
