import { collection, getDocs, query, doc, updateDoc, deleteField } from "firebase/firestore";
import { db } from "./firebase-config.js";
import { BACKUP_FIELDS, DEFAULT_CLOUD_NAME, isCloudinaryUrl, isBackupConfigured, uploadToCloudinary } from "./image-backup.js";

const PASSWORD = "Sielu2026";
const loginModal = document.getElementById('loginModal');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const errorMsg = document.getElementById('errorMsg');
const configurator = document.getElementById('catalogConfigurator');
const searchInput = document.getElementById('searchInput');
const selectionBar = document.getElementById('selectionBar');
const statusPanel = document.getElementById('catalogStatus');

let allProducts = [];
let categoryOrder = [];
let categoryImages = {}; // { categoryName: coverImageUrl }
let showOnlyPending = false;
let cloudinaryConfig = { cloudName: DEFAULT_CLOUD_NAME, uploadPreset: '' };
const backupUploads = new Map(); // primary url -> Promise<backup url>, so shared images upload once
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
        categoryImages = {};

        snapshot.forEach(productDoc => {
            if (productDoc.id === '--category-config--') {
                categoryOrder = productDoc.data().order || [];
                categoryImages = productDoc.data().images || {};
                cloudinaryConfig = { cloudName: DEFAULT_CLOUD_NAME, uploadPreset: '', ...(productDoc.data().cloudinary || {}) };
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
                catalogName: data.NombreCatalogo || '',
                colorSwatch: data.ColorSwatch || '',
                fields: Object.fromEntries(BACKUP_FIELDS.flatMap(f => [f.primary, f.backup, f.origin])
                    .map(name => [name, data[name] || ''])),
                available: (data.Estado || 'Disponible') !== 'No disponible'
            });
        });

        await normalizeOrphanGroups();
        renderStatusPanel();
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

// Products set to "No disponible" in Administración never show in the visual catalog, so the
// configurator hides them too (they stay in allProducts so group bookkeeping still sees them).
// A product is "pending" when it is available but has no technical specifications loaded yet.
function isPending(product) {
    return product.available && !product.specifications.trim();
}

function renderStatusPanel() {
    if (!statusPanel) return;
    const available = allProducts.filter(p => p.available);
    const pending = available.filter(isPending);
    const hidden = allProducts.length - available.length;

    statusPanel.innerHTML = '';
    const stats = document.createElement('div');
    stats.className = 'catalog-config-status-stats';
    [
        [available.length, 'disponibles en el catálogo'],
        [available.length - pending.length, 'con información cargada'],
        [pending.length, 'pendientes por cargar', pending.length > 0]
    ].forEach(([value, label, warn]) => {
        const stat = document.createElement('div');
        stat.className = 'catalog-config-status-stat' + (warn ? ' is-pending' : '');
        stat.innerHTML = '<strong></strong><span></span>';
        stat.querySelector('strong').textContent = value;
        stat.querySelector('span').textContent = label;
        stats.appendChild(stat);
    });
    statusPanel.appendChild(stats);

    const actions = document.createElement('div');
    actions.className = 'catalog-config-status-actions';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn-primary';
    toggle.textContent = showOnlyPending ? 'Ver todos los disponibles' : 'Ver solo pendientes';
    toggle.disabled = pending.length === 0 && !showOnlyPending;
    toggle.addEventListener('click', () => {
        showOnlyPending = !showOnlyPending;
        renderStatusPanel();
        renderProducts();
    });
    actions.appendChild(toggle);
    if (hidden > 0) {
        const note = document.createElement('small');
        note.textContent = `${hidden} producto${hidden === 1 ? '' : 's'} marcado${hidden === 1 ? '' : 's'} como "No disponible" en Administración no se muestra${hidden === 1 ? '' : 'n'} aquí ni en el catálogo.`;
        actions.appendChild(note);
    }
    statusPanel.appendChild(actions);
    statusPanel.appendChild(buildBackupPanel(available));
}

// Cloudinary settings + one-click backup of every available product's pending images.
function buildBackupPanel(available) {
    const wrap = document.createElement('div');
    wrap.className = 'catalog-config-backup-panel';

    const configured = isBackupConfigured(cloudinaryConfig);
    const pending = pendingBackups(available);

    const summary = document.createElement('div');
    summary.className = 'catalog-config-backup-summary';
    const text = document.createElement('span');
    text.textContent = configured
        ? `Imágenes de respaldo: ${pending === 0 ? 'todas respaldadas' : `${pending} por respaldar`}`
        : 'Imágenes de respaldo: configura Cloudinary para activarlas';
    summary.appendChild(text);

    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'btn-primary';
    run.textContent = pending ? `Respaldar ${pending} imágenes` : 'Todo respaldado';
    run.disabled = !configured || pending === 0;
    const progress = document.createElement('span');
    progress.className = 'catalog-config-feedback';
    summary.append(run, progress);
    wrap.appendChild(summary);

    run.addEventListener('click', async () => {
        run.disabled = true;
        const result = await runBulkBackup((done, total) => {
            progress.textContent = `Respaldando ${done} de ${total}...`;
        });
        progress.textContent = result.aborted
            ? `Detenido: ${result.firstError}`
            : (result.failed
                ? `${result.done} respaldadas, ${result.failed} con error (${result.firstError})`
                : `${result.done} imágenes respaldadas`);
        renderStatusPanel();
        renderProducts();
    });

    const details = document.createElement('details');
    details.open = !configured;
    const toggle = document.createElement('summary');
    toggle.textContent = 'Configuración de Cloudinary';
    details.appendChild(toggle);

    const form = document.createElement('div');
    form.className = 'catalog-config-backup-settings';
    const cloudInput = document.createElement('input');
    cloudInput.type = 'text';
    cloudInput.placeholder = 'Cloud name';
    cloudInput.value = cloudinaryConfig.cloudName || '';
    const presetInput = document.createElement('input');
    presetInput.type = 'text';
    presetInput.placeholder = 'Upload preset (unsigned)';
    presetInput.value = cloudinaryConfig.uploadPreset || '';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'catalog-config-backup-btn';
    save.textContent = 'Guardar';
    const saved = document.createElement('span');
    saved.className = 'catalog-config-feedback';
    form.append(cloudInput, presetInput, save, saved);
    details.appendChild(form);

    const help = document.createElement('small');
    help.textContent = 'En Cloudinary: Settings > Upload > Upload presets > "Add upload preset", con Signing mode "Unsigned". Escribe aquí el nombre del preset.';
    details.appendChild(help);
    wrap.appendChild(details);

    save.addEventListener('click', async () => {
        const next = { cloudName: cloudInput.value.trim(), uploadPreset: presetInput.value.trim() };
        saved.textContent = 'Guardando...';
        try {
            await updateDoc(doc(db, 'productos_sielu', '--category-config--'), { cloudinary: next });
            cloudinaryConfig = next;
            saved.textContent = 'Guardado';
            renderStatusPanel();
        } catch (error) {
            console.error('Error al guardar la configuración de Cloudinary:', error);
            saved.textContent = 'No se pudo guardar';
        }
    });

    return wrap;
}

// Backs up every pending image of the available products, a few uploads at a time. Stops early
// when several in a row fail (usually a wrong cloud name / upload preset) instead of hammering.
async function runBulkBackup(onProgress) {
    const jobs = [];
    allProducts.filter(p => p.available).forEach(product =>
        BACKUP_FIELDS.forEach(f => { if (backupNeeded(product, f)) jobs.push({ product, f }); }));

    const state = { total: jobs.length, done: 0, failed: 0, firstError: '', aborted: false };
    let next = 0;
    let consecutive = 0;
    async function worker() {
        while (next < jobs.length && consecutive < 5) {
            const job = jobs[next++];
            try {
                await backupField(job.product, job.f);
                consecutive = 0;
                state.done++;
            } catch (error) {
                consecutive++;
                state.failed++;
                state.firstError = state.firstError || error.message || String(error);
            }
            onProgress(state.done + state.failed, state.total);
        }
    }
    await Promise.all([worker(), worker(), worker()]);
    state.aborted = consecutive >= 5;
    return state;
}

function getOrderedGroups() {
    const filter = searchInput.value.trim().toLowerCase();
    const products = allProducts.filter(product => product.available
        && (!showOnlyPending || isPending(product))
        && (!filter || [product.name, product.code, product.category]
            .some(value => value.toLowerCase().includes(filter))));
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

// Small color picker saved immediately on change — drives the colored dot shown next to this
// product's code in the visual catalog. Independent per product, so each code in a merged group
// can get its own color.
function buildColorInput(product) {
    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'catalog-config-color-input';
    input.title = 'Color del círculo junto al código en el catálogo';
    input.value = product.colorSwatch || '#cccccc';
    input.addEventListener('change', async () => {
        try {
            await updateDoc(doc(db, 'productos_sielu', product.id), { ColorSwatch: input.value });
            product.colorSwatch = input.value;
        } catch (error) {
            console.error('Error al guardar el color:', error);
            alert('No se pudo guardar el color.');
        }
    });
    return input;
}

// URL field for a category's cover image (shown as a full page in catalogo.html's list and
// flipbook views). Updates only this one category's key via a dot-path field update — never the
// whole images map — so it can't clobber other categories' images with a stale local snapshot.
// Clearing the field uses deleteField(): setDoc/updateDoc with {merge:true} on a nested object
// only ever adds/overwrites keys present in the payload, it never removes keys just by omitting
// them, so writing images:{} would silently leave the old URL in place.
function buildCategoryImageField(category) {
    const wrap = document.createElement('div');
    wrap.className = 'catalog-config-category-image';

    const label = document.createElement('span');
    label.textContent = 'Imagen de portada de la categoría (se muestra como una página con el nombre de la categoría)';
    wrap.appendChild(label);

    const row = document.createElement('div');
    row.className = 'catalog-config-category-image-row';

    const preview = document.createElement('img');
    preview.className = 'catalog-config-category-image-preview';
    preview.alt = category;
    preview.src = categoryImages[category] || '';
    preview.hidden = !categoryImages[category];
    preview.onerror = () => { preview.hidden = true; };
    row.appendChild(preview);

    const input = document.createElement('input');
    input.type = 'url';
    input.placeholder = 'https://...';
    input.value = categoryImages[category] || '';
    row.appendChild(input);

    const feedback = document.createElement('span');
    feedback.className = 'catalog-config-feedback';
    row.appendChild(feedback);

    input.addEventListener('change', async () => {
        const url = input.value.trim();
        feedback.textContent = 'Guardando...';
        try {
            const configRef = doc(db, 'productos_sielu', '--category-config--');
            const fieldPath = `images.${category}`;
            if (url) {
                await updateDoc(configRef, { [fieldPath]: url });
                categoryImages[category] = url;
            } else {
                await updateDoc(configRef, { [fieldPath]: deleteField() });
                delete categoryImages[category];
            }
            preview.src = url;
            preview.hidden = !url;
            feedback.textContent = 'Guardado';
        } catch (error) {
            console.error('Error al guardar la imagen de categoría:', error);
            feedback.textContent = 'No se pudo guardar';
        } finally {
            setTimeout(() => feedback.textContent = '', 2500);
        }
    });

    wrap.appendChild(row);
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
        section.appendChild(buildCategoryImageField(category));

        const cards = mergeIntoCards(groups.get(category));
        cards.forEach(card => {
            section.appendChild(card.isGroup ? renderGroupCard(card) : renderSingleCard(card.members[0]));
        });
        configurator.appendChild(section);
    });

    renderSelectionBar();
}

// --- IMAGE BACKUPS (Cloudinary) ---
// Each image (photo, drawing, context) can have a backup link that the catalog falls back to when
// the primary host fails. Backups are generated automatically (upload to Cloudinary) and can also
// be typed by hand. product.fields mirrors the raw Firestore values of the primary/backup/origin
// fields of BACKUP_FIELDS.

function backupNeeded(product, f) {
    const primary = product.fields[f.primary];
    if (!primary || isCloudinaryUrl(primary)) return false;
    return !(product.fields[f.backup] && product.fields[f.origin] === primary);
}

function backupStatus(product, f) {
    const primary = product.fields[f.primary];
    if (!primary) return { text: 'sin imagen', cls: 'is-none' };
    if (isCloudinaryUrl(primary) && !product.fields[f.backup]) return { text: 'ya está en Cloudinary', cls: 'is-ok' };
    if (product.fields[f.backup] && product.fields[f.origin] === primary) return { text: 'respaldada', cls: 'is-ok' };
    if (product.fields[f.backup]) return { text: 'desactualizada', cls: 'is-pending' };
    return { text: 'sin respaldo', cls: 'is-pending' };
}

async function backupField(product, f) {
    if (!backupNeeded(product, f)) return false;
    const primary = product.fields[f.primary];
    if (!backupUploads.has(primary)) {
        const upload = uploadToCloudinary(primary, cloudinaryConfig);
        backupUploads.set(primary, upload);
        upload.catch(() => backupUploads.delete(primary));
    }
    const url = await backupUploads.get(primary);
    await updateDoc(doc(db, 'productos_sielu', product.id), { [f.backup]: url, [f.origin]: primary });
    product.fields[f.backup] = url;
    product.fields[f.origin] = primary;
    return true;
}

// Returns { done, failed } — a failure doesn't stop the remaining fields.
async function backupProducts(products, fieldKeys = BACKUP_FIELDS.map(f => f.key)) {
    const result = { done: 0, failed: [] };
    for (const product of products) {
        for (const f of BACKUP_FIELDS.filter(x => fieldKeys.includes(x.key))) {
            try {
                if (await backupField(product, f)) result.done++;
            } catch (error) {
                result.failed.push({ product, field: f, message: error.message || String(error) });
            }
        }
    }
    return result;
}

function pendingBackups(products) {
    return products.reduce((sum, product) =>
        sum + BACKUP_FIELDS.filter(f => backupNeeded(product, f)).length, 0);
}

async function saveManualBackup(products, f, url) {
    await Promise.all(products.map(product => {
        const update = url
            ? { [f.backup]: url, [f.origin]: product.fields[f.primary] || '' }
            : { [f.backup]: deleteField(), [f.origin]: deleteField() };
        return updateDoc(doc(db, 'productos_sielu', product.id), update);
    }));
    products.forEach(product => {
        product.fields[f.backup] = url;
        product.fields[f.origin] = url ? (product.fields[f.primary] || '') : '';
    });
}

function backupSummary(result, emptyText) {
    if (result.failed.length) return `No se pudo respaldar: ${result.failed[0].message}`;
    if (!result.done) return emptyText;
    return `${result.done} respaldo${result.done === 1 ? '' : 's'} creado${result.done === 1 ? '' : 's'}`;
}

// Row shown on each card: one backup URL per image (photo is per product, drawing/context are
// shared by a group), its status, and a "Respaldar ahora" button.
function buildBackupRow(products) {
    const wrap = document.createElement('div');
    wrap.className = 'catalog-config-backup';

    const title = document.createElement('span');
    title.className = 'catalog-config-backup-title';
    title.textContent = 'Imágenes de respaldo (se usan si el enlace principal falla)';
    wrap.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'catalog-config-backup-grid';
    wrap.appendChild(grid);

    const bar = document.createElement('div');
    bar.className = 'catalog-config-backup-bar';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'catalog-config-backup-btn';
    button.textContent = 'Respaldar ahora';
    const message = document.createElement('span');
    message.className = 'catalog-config-feedback';
    bar.append(button, message);
    wrap.appendChild(bar);

    // photo -> one entry per product; drawing/context -> one entry shared by all products
    const entries = [];
    BACKUP_FIELDS.forEach(f => {
        if (f.key === 'photo') {
            products.forEach(product => entries.push({
                f, targets: [product],
                label: products.length > 1 ? `Foto respaldo · ${product.code || product.name}` : 'Foto respaldo'
            }));
        } else {
            entries.push({ f, targets: products, label: f.key === 'drawing' ? 'Dibujo respaldo' : 'Contexto respaldo' });
        }
    });

    const refreshers = [];
    entries.forEach(entry => {
        const field = document.createElement('label');
        field.className = 'catalog-config-field';
        const label = document.createElement('span');
        const input = document.createElement('input');
        input.type = 'url';
        input.placeholder = 'https://... (se genera automáticamente)';
        const badge = document.createElement('em');
        badge.className = 'catalog-config-backup-badge';
        label.append(entry.label + ' ', badge);
        field.append(label, input);
        grid.appendChild(field);

        const refresh = () => {
            input.value = entry.targets[0].fields[entry.f.backup] || '';
            const states = entry.targets.map(p => backupStatus(p, entry.f));
            const worst = states.find(s => s.cls === 'is-pending') || states[0];
            badge.textContent = worst.text;
            badge.className = 'catalog-config-backup-badge ' + worst.cls;
        };
        refreshers.push(refresh);
        refresh();

        input.addEventListener('change', async () => {
            message.textContent = 'Guardando...';
            try {
                await saveManualBackup(entry.targets, entry.f, input.value.trim());
                message.textContent = 'Guardado';
            } catch (error) {
                console.error('Error al guardar el respaldo:', error);
                message.textContent = 'No se pudo guardar';
            }
            refresh();
            setTimeout(() => message.textContent = '', 2500);
        });
    });

    wrap.refresh = () => refreshers.forEach(fn => fn());

    // After saving a card: backs up only what is missing, without blocking the save feedback.
    wrap.autoBackup = async fieldKeys => {
        if (!isBackupConfigured(cloudinaryConfig)) return;
        const needed = products.some(p => BACKUP_FIELDS.some(f => fieldKeys.includes(f.key) && backupNeeded(p, f)));
        if (!needed) { wrap.refresh(); return; }
        message.textContent = 'Respaldando imágenes...';
        const result = await backupProducts(products, fieldKeys);
        wrap.refresh();
        message.textContent = backupSummary(result, '');
        setTimeout(() => message.textContent = '', 4000);
    };

    button.addEventListener('click', async () => {
        if (!isBackupConfigured(cloudinaryConfig)) {
            message.textContent = 'Configura Cloudinary (panel de arriba) para respaldar automáticamente.';
            return;
        }
        button.disabled = true;
        message.textContent = 'Respaldando imágenes...';
        const result = await backupProducts(products);
        wrap.refresh();
        message.textContent = backupSummary(result, 'Todo ya estaba respaldado');
        button.disabled = false;
    });

    return wrap;
}

function renderSingleCard(product) {
    const form = document.createElement('form');
    form.className = 'catalog-config-product';

    const identity = document.createElement('div');
    identity.className = 'catalog-config-identity';
    identity.appendChild(buildThumbWrap(product));
    const title = document.createElement('div');
    const nameEl = document.createElement('strong');
    nameEl.textContent = product.name;
    title.appendChild(nameEl);
    const codeRow = document.createElement('div');
    codeRow.className = 'catalog-config-code-row';
    const codeEl = document.createElement('small');
    codeEl.textContent = product.code || 'Sin código';
    codeRow.append(codeEl, buildColorInput(product));
    title.appendChild(codeRow);
    identity.appendChild(title);
    form.appendChild(identity);

    const fields = document.createElement('div');
    fields.className = 'catalog-config-fields';
    const contextInput = addField(fields, 'URL imagen en contexto', 'context-image-input', product.contextImage);
    const drawingInput = addField(fields, 'URL dibujo técnico', 'drawing-input', product.drawing);
    const specsInput = addField(fields, 'Especificaciones técnicas', 'specifications-input', product.specifications, true);
    form.appendChild(fields);

    const backupRow = buildBackupRow([product]);
    form.appendChild(backupRow);

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
            product.fields.ImgContexto = update.ImgContexto;
            product.fields.Dibujo = update.Dibujo;
            feedback.textContent = 'Guardado';
            backupRow.refresh();
            backupRow.autoBackup(['drawing', 'context']);
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
        const codeRow = document.createElement('div');
        codeRow.className = 'catalog-config-code-row';
        const code = document.createElement('small');
        code.textContent = member.code || 'Sin código';
        codeRow.append(code, buildColorInput(member));
        memberBlock.appendChild(codeRow);
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

    const backupRow = buildBackupRow(card.members);
    form.appendChild(backupRow);

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
            card.members.forEach(member => {
                Object.assign(member, {
                    catalogName: update.NombreCatalogo,
                    contextImage: update.ImgContexto,
                    drawing: update.Dibujo,
                    specifications: update.Especificaciones
                });
                member.fields.ImgContexto = update.ImgContexto;
                member.fields.Dibujo = update.Dibujo;
            });
            feedback.textContent = 'Guardado';
            backupRow.refresh();
            backupRow.autoBackup(['drawing', 'context']);
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
