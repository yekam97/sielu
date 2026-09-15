import { collection, getDocs, query, doc, updateDoc } from "firebase/firestore";
import { db } from "./firebase-config.js";

const PASSWORD = "Sielu2026";
const loginModal = document.getElementById('loginModal');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const errorMsg = document.getElementById('errorMsg');
const configurator = document.getElementById('catalogConfigurator');
const searchInput = document.getElementById('searchInput');
const selectionBar = document.getElementById('selectionBar');

let allProducts = [];
let categoryOrder = [];
const selectedIds = new Set();

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
                order: Number(data.Orden ?? data.orden ?? 0),
                groupId: data.GrupoId || '',
                catalogName: data.NombreCatalogo || ''
            });
        });

        await normalizeOrphanGroups();
        renderProducts();
    } catch (error) {
        console.error('Error al cargar productos:', error);
        configurator.innerHTML = '<p class="loading-catalog">No fue posible cargar los productos.</p>';
    }
}

// If a GrupoId ends up left on only one product (e.g. after removing the rest),
// clear it so that product goes back to behaving like a normal, ungrouped item.
async function normalizeOrphanGroups() {
    const counts = new Map();
    allProducts.forEach(p => {
        if (!p.groupId) return;
        counts.set(p.groupId, (counts.get(p.groupId) || 0) + 1);
    });
    const orphans = allProducts.filter(p => p.groupId && counts.get(p.groupId) === 1);
    if (orphans.length === 0) return;

    await Promise.all(orphans.map(async product => {
        try {
            await updateDoc(doc(db, 'productos_sielu', product.id), { GrupoId: '', NombreCatalogo: '' });
            product.groupId = '';
            product.catalogName = '';
        } catch (error) {
            console.error('Error al limpiar grupo huérfano:', error);
        }
    }));
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

// Collapse products that share a GrupoId into a single mergeable card.
function mergeIntoCards(products) {
    const byGroup = new Map();
    const cards = [];

    products.forEach(product => {
        if (product.groupId) {
            if (!byGroup.has(product.groupId)) {
                const card = { isGroup: true, groupId: product.groupId, members: [] };
                byGroup.set(product.groupId, card);
                cards.push(card);
            }
            byGroup.get(product.groupId).members.push(product);
        } else {
            cards.push({ isGroup: false, groupId: null, members: [product] });
        }
    });

    cards.forEach(card => {
        card.members.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
        if (card.members.length < 2) card.isGroup = false;
    });

    return cards;
}

function addField(form, labelText, className, value, multiline = false, inputType = 'url') {
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
        control.type = inputType;
        control.placeholder = inputType === 'url' ? 'https://...' : '';
    }
    field.append(label, control);
    form.appendChild(field);
    return control;
}

function buildThumbWrap(product, { removable = false } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'catalog-config-thumb-wrap';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'catalog-config-select';
    checkbox.title = 'Seleccionar para unir';
    checkbox.checked = selectedIds.has(product.id);
    checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedIds.add(product.id);
        else selectedIds.delete(product.id);
        renderSelectionBar();
    });
    wrap.appendChild(checkbox);

    const image = document.createElement('img');
    image.src = product.image;
    image.alt = product.name;
    image.loading = 'lazy';
    image.onerror = () => image.style.display = 'none';
    wrap.appendChild(image);

    if (removable) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'catalog-config-remove-member';
        removeBtn.title = 'Quitar del grupo';
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', () => removeFromGroup(product));
        wrap.appendChild(removeBtn);
    }

    return wrap;
}

async function removeFromGroup(product) {
    try {
        await updateDoc(doc(db, 'productos_sielu', product.id), { GrupoId: '', NombreCatalogo: '' });
        selectedIds.delete(product.id);
        await fetchProducts();
    } catch (error) {
        console.error('Error al quitar del grupo:', error);
        alert('No se pudo quitar el producto del grupo.');
    }
}

async function ungroupAll(card) {
    try {
        await Promise.all(card.members.map(member =>
            updateDoc(doc(db, 'productos_sielu', member.id), { GrupoId: '', NombreCatalogo: '' })
        ));
        card.members.forEach(member => selectedIds.delete(member.id));
        await fetchProducts();
    } catch (error) {
        console.error('Error al desagrupar:', error);
        alert('No se pudo desagrupar el producto.');
    }
}

function renderProducts() {
    configurator.innerHTML = '';
    const { groups, orderedCategories } = getOrderedGroups();

    if (!orderedCategories.length) {
        configurator.innerHTML = '<p class="loading-catalog">No se encontraron productos.</p>';
        renderSelectionBar();
        return;
    }

    orderedCategories.forEach(category => {
        const section = document.createElement('section');
        section.className = 'catalog-config-category';
        const heading = document.createElement('h2');
        heading.textContent = category;
        section.appendChild(heading);

        const cards = mergeIntoCards(groups.get(category));
        cards.forEach(card => {
            section.appendChild(card.isGroup ? renderGroupCard(card) : renderSingleCard(card.members[0]));
        });
        configurator.appendChild(section);
    });

    renderSelectionBar();
}

function renderSingleCard(product) {
    const form = document.createElement('form');
    form.className = 'catalog-config-product';

    const identity = document.createElement('div');
    identity.className = 'catalog-config-identity';
    identity.appendChild(buildThumbWrap(product));
    const title = document.createElement('div');
    title.innerHTML = `<strong></strong><small></small>`;
    title.querySelector('strong').textContent = product.name;
    title.querySelector('small').textContent = product.code || 'Sin código';
    identity.appendChild(title);
    form.appendChild(identity);

    const fields = document.createElement('div');
    fields.className = 'catalog-config-fields';
    const contextInput = addField(fields, 'URL imagen en contexto', 'context-image-input', product.contextImage);
    const drawingInput = addField(fields, 'URL dibujo técnico', 'drawing-input', product.drawing);
    const specsInput = addField(fields, 'Especificaciones técnicas', 'specifications-input', product.specifications, true);
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
                ImgContexto: contextInput.value.trim(),
                Dibujo: drawingInput.value.trim(),
                Especificaciones: specsInput.value.trim(),
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

    return form;
}

function renderGroupCard(card) {
    const representative = card.members[0];
    const form = document.createElement('form');
    form.className = 'catalog-config-product catalog-config-product--group';

    const membersRow = document.createElement('div');
    membersRow.className = 'catalog-config-group-members';
    card.members.forEach(member => {
        const memberBlock = document.createElement('div');
        memberBlock.className = 'catalog-config-group-member';
        memberBlock.appendChild(buildThumbWrap(member, { removable: true }));
        const code = document.createElement('small');
        code.textContent = member.code || 'Sin código';
        memberBlock.appendChild(code);
        membersRow.appendChild(memberBlock);
    });
    const ungroupBtn = document.createElement('button');
    ungroupBtn.type = 'button';
    ungroupBtn.className = 'catalog-config-ungroup-btn';
    ungroupBtn.textContent = 'Desagrupar todo';
    ungroupBtn.addEventListener('click', () => ungroupAll(card));
    membersRow.appendChild(ungroupBtn);
    form.appendChild(membersRow);

    const groupNote = document.createElement('p');
    groupNote.className = 'catalog-config-group-note';
    groupNote.textContent = `${card.members.length} productos unidos · comparten estas especificaciones e imágenes en el catálogo visual.`;
    form.appendChild(groupNote);

    const fields = document.createElement('div');
    fields.className = 'catalog-config-fields';
    const nameInput = addField(fields, 'Nombre para el catálogo (opcional)', 'catalog-name-input',
        representative.catalogName, false, 'text');
    nameInput.placeholder = representative.name;
    const contextInput = addField(fields, 'URL imagen en contexto', 'context-image-input', representative.contextImage);
    const drawingInput = addField(fields, 'URL dibujo técnico', 'drawing-input', representative.drawing);
    const specsInput = addField(fields, 'Especificaciones técnicas', 'specifications-input', representative.specifications, true);
    form.appendChild(fields);

    const actions = document.createElement('div');
    actions.className = 'catalog-config-actions';
    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.className = 'btn-primary';
    saveButton.textContent = 'Guardar cambios del grupo';
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
                NombreCatalogo: nameInput.value.trim(),
                ImgContexto: contextInput.value.trim(),
                Dibujo: drawingInput.value.trim(),
                Especificaciones: specsInput.value.trim(),
                fechaUpdate: new Date()
            };
            await Promise.all(card.members.map(member =>
                updateDoc(doc(db, 'productos_sielu', member.id), update)
            ));
            card.members.forEach(member => Object.assign(member, {
                catalogName: update.NombreCatalogo,
                contextImage: update.ImgContexto,
                drawing: update.Dibujo,
                specifications: update.Especificaciones
            }));
            feedback.textContent = 'Guardado';
        } catch (error) {
            console.error('Error al guardar grupo:', error);
            feedback.textContent = 'No se pudo guardar';
        } finally {
            saveButton.disabled = false;
            setTimeout(() => feedback.textContent = '', 2500);
        }
    });

    return form;
}

// --- SELECTION / MERGE BAR ---

function renderSelectionBar() {
    if (!selectionBar) return;
    const count = selectedIds.size;

    if (count === 0) {
        selectionBar.hidden = true;
        selectionBar.innerHTML = '';
        return;
    }

    const selectedProducts = allProducts.filter(p => selectedIds.has(p.id));
    const categories = new Set(selectedProducts.map(p => p.category));
    const sameCategory = categories.size <= 1;
    const canMerge = count >= 2 && sameCategory;

    selectionBar.hidden = false;
    selectionBar.innerHTML = '';

    const label = document.createElement('span');
    label.className = 'catalog-config-selection-count';
    label.textContent = count === 1
        ? '1 producto seleccionado'
        : `${count} productos seleccionados`;
    selectionBar.appendChild(label);

    if (!sameCategory) {
        const warning = document.createElement('span');
        warning.className = 'catalog-config-selection-warning';
        warning.textContent = 'Selecciona productos de una sola categoría para unirlos.';
        selectionBar.appendChild(warning);
    }

    const mergeBtn = document.createElement('button');
    mergeBtn.type = 'button';
    mergeBtn.className = 'btn-primary';
    mergeBtn.textContent = 'Unir en un producto de catálogo';
    mergeBtn.disabled = !canMerge;
    mergeBtn.addEventListener('click', () => mergeSelected(selectedProducts));
    selectionBar.appendChild(mergeBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'catalog-config-cancel-selection';
    cancelBtn.textContent = 'Cancelar selección';
    cancelBtn.addEventListener('click', () => {
        selectedIds.clear();
        renderProducts();
    });
    selectionBar.appendChild(cancelBtn);
}

async function mergeSelected(selectedProducts) {
    if (selectedProducts.length < 2) return;
    const categories = new Set(selectedProducts.map(p => p.category));
    if (categories.size > 1) return;

    const sorted = [...selectedProducts].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    const representative = sorted[0];
    const groupId = `grp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    const update = {
        GrupoId: groupId,
        ImgContexto: representative.contextImage,
        Dibujo: representative.drawing,
        Especificaciones: representative.specifications,
        NombreCatalogo: representative.catalogName || representative.name,
        fechaUpdate: new Date()
    };

    try {
        await Promise.all(sorted.map(product =>
            updateDoc(doc(db, 'productos_sielu', product.id), update)
        ));
        selectedIds.clear();
        await fetchProducts();
    } catch (error) {
        console.error('Error al unir productos:', error);
        alert('No se pudieron unir los productos.');
    }
}

searchInput.addEventListener('input', renderProducts);
