import { collection, getDocs, query, doc, getDoc } from "firebase/firestore";
import { db } from "./firebase-config.js";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

let allProducts = [];
let categoryOrder = [];

// Configuración integrada en fetchProducts
async function fetchConfig() {
    return;
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

    // Sort products within categories: orden primary, name secondary
    Object.keys(grouped).forEach(cat => {
        grouped[cat].sort((a, b) => {
            const ordA = Number(a.orden) || 0;
            const ordB = Number(b.orden) || 0;
            if (ordA !== ordB) return ordA - ordB;
            return (a.nombre || "").localeCompare(b.nombre || "");
        });
    });

    // Use dynamic categoryOrder
    const sortedCategories = categoryOrder.filter(cat => grouped[cat]);
    // Add any categories from grouped that might not be in the sorted list (fallback)
    Object.keys(grouped).forEach(cat => {
        if (!sortedCategories.includes(cat)) sortedCategories.push(cat);
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
            img.src = item.img || '';
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
            tdCode.setAttribute('data-label', 'Código');
            tdCode.textContent = item.codigo;
            tr.appendChild(tdCode);

            // Precio
            const tdPrice = document.createElement('td');
            tdPrice.setAttribute('data-label', 'Precio');
            tdPrice.className = 'price-cell';
            const priceVal = parseFloat(item.precio);
            tdPrice.textContent = isNaN(priceVal) ? item.precio : "$" + priceVal.toLocaleString('es-CO');
            tr.appendChild(tdPrice);

            // Ficha
            const tdFicha = document.createElement('td');
            tdFicha.setAttribute('data-label', 'Ficha');
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

// PDF Export Logic
function formatCurrency(number) {
    return new Intl.NumberFormat('es-CO').format(Math.round(number));
}

// Helper to convert image URL to Base64
async function getBase64FromUrl(url) {
    if (!url) return null;
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn("Could not load image for PDF:", url);
        return null;
    }
}

async function generatePDF() {
    const btn = document.getElementById('btnDownload');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Generando PDF...';
    btn.disabled = true;

    try {
        const doc = new jsPDF();
        const date = new Date().toLocaleDateString('es-CO');

        // Header
        doc.setFontSize(24);
        doc.setTextColor(219, 207, 172); // Sielu Gold
        doc.text("Sielu", 14, 20);

        doc.setFontSize(14);
        doc.setTextColor(26, 26, 26);
        doc.text("LISTA DE PRECIOS DIGITAL", 14, 30);

        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text(`Generada el: ${date}`, 14, 38);
        doc.text(`Imporlec S.A.S.`, 14, 44);

        // Prepare Data
        const itemsToExport = [...allProducts].filter(item => item.estado !== 'No disponible');

        // Final Sorted list following screen logic
        const grouped = {};
        itemsToExport.forEach(item => {
            const cat = item.cat;
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item);
        });

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

        const tableRows = [];
        for (const cat of sortedCategories) {
            // Category header row
            tableRows.push([
                { content: cat, colSpan: 4, styles: { fillColor: [245, 245, 245], fontStyle: 'bold', textColor: [26, 26, 26] } }
            ]);

            for (const item of grouped[cat]) {
                const imgBase64 = await getBase64FromUrl(item.img);
                tableRows.push([
                    { content: imgBase64 || '', image: imgBase64 }, // We'll handle drawing in didParseCell or similar if needed, but jspdf-autotable handles strings
                    item.nombre,
                    item.codigo,
                    `$${formatCurrency(item.precio)}`
                ]);
            }
        }

        autoTable(doc, {
            startY: 55,
            head: [['IMAGEN', 'PRODUCTO', 'CÓDIGO', 'PRECIO']],
            body: tableRows,
            theme: 'grid',
            headStyles: { fillColor: [219, 207, 172], textColor: [26, 26, 26], fontStyle: 'bold' },
            columnStyles: {
                0: { cellWidth: 30, minCellHeight: 30 },
                1: { cellWidth: 'auto' },
                2: { cellWidth: 35 },
                3: { cellWidth: 35, halign: 'right' }
            },
            styles: { fontSize: 9, cellPadding: 2, valign: 'middle' },
            didDrawCell: (data) => {
                if (data.section === 'body' && data.column.index === 0 && data.cell.raw.image) {
                    const imgSize = 24;
                    const x = data.cell.x + (data.cell.width - imgSize) / 2;
                    const y = data.cell.y + (data.cell.height - imgSize) / 2;
                    doc.addImage(data.cell.raw.image, 'JPEG', x, y, imgSize, imgSize);
                }
            },
            // Hack to make the empty cell text invisible while image is drawn
            didParseCell: (data) => {
                if (data.column.index === 0 && data.cell.raw.image) {
                    data.cell.text = '';
                }
            }
        });

        doc.save(`Lista_Precios_Sielu_${date.replace(/\//g, '-')}.pdf`);

    } catch (e) {
        console.error("Error generating PDF:", e);
        alert("Ocurrió un error al generar el PDF. Verifica que las imágenes estén disponibles.");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

document.getElementById('btnDownload').addEventListener('click', generatePDF);

// Initialize
fetchProducts();
