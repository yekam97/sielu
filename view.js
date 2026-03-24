import { collection, getDocs, query, doc, getDoc } from "firebase/firestore";
import { db } from "./firebase-config.js";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

let allProducts = [];
let categoryOrder = [];
let collapsedCategories = new Set(); // Track collapsed state

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

let currentFilter = '';

function renderTable(filter = currentFilter) {
    currentFilter = filter;
    const tbody = document.querySelector('#priceTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    let items = [...allProducts];

    // Filter by Status
    items = items.filter(item => item.estado !== 'No disponible');

    // Filter by search text
    if (currentFilter) {
        const lowerFilter = currentFilter.toLowerCase();
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

    // Sort products within categories
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

    if (items.length === 0 && allProducts.length > 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem;">No se encontraron resultados.</td></tr>`;
        return;
    }

    sortedCategories.forEach(cat => {
        const isCollapsed = collapsedCategories.has(cat);

        // Category Header
        const catRow = document.createElement('tr');
        catRow.className = `category-header ${isCollapsed ? 'collapsed' : ''}`;
        catRow.style.cursor = 'pointer';
        catRow.innerHTML = `
            <td colspan="5">
                <div class="category-header-content">
                    <span style="font-weight: bold;">${cat}</span>
                    <span class="toggle-icon">${isCollapsed ? '⊕' : '⊖'}</span>
                </div>
            </td>
        `;

        // Toggle Logic with better robustness
        catRow.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (collapsedCategories.has(cat)) {
                collapsedCategories.delete(cat);
            } else {
                collapsedCategories.add(cat);
            }
            renderTable(currentFilter);
        });

        tbody.appendChild(catRow);

        if (!isCollapsed) {
            grouped[cat].forEach(item => {
                const tr = document.createElement('tr');

                // Imagen
                const tdImg = document.createElement('td');
                tdImg.setAttribute('data-label', 'Imagen');
                const img = document.createElement('img');
                img.src = item.img || '';
                img.className = 'product-img';
                img.loading = 'lazy';
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

                const adjustment = getGlobalAdjustment() / 100;
                const priceVal = parseFloat(item.precio);
                const adjustedPrice = priceVal * (1 + adjustment);

                tdPrice.textContent = isNaN(priceVal) ? item.precio : "$" + Math.round(adjustedPrice).toLocaleString('es-CO');
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
        }
    });
}

// Get global adjustment value
function getGlobalAdjustment() {
    const el = document.getElementById('globalAdjustment');
    return el ? parseFloat(el.value) || 0 : 0;
}

// Search handler
document.getElementById('searchInput').addEventListener('input', e => {
    renderTable(e.target.value);
});

// Adjustment handler
document.getElementById('globalAdjustment').addEventListener('input', () => {
    renderTable();
});

// PDF Export Logic
function formatCurrency(number) {
    return new Intl.NumberFormat('es-CO').format(Math.round(number));
}

// Helper to convert image URL to Base64 and get dimensions
async function getImageDataFromUrl(url) {
    if (!url) return null;
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result;
                const img = new Image();
                img.onload = () => {
                    resolve({
                        base64: base64,
                        width: img.width,
                        height: img.height
                    });
                };
                img.onerror = () => resolve({ base64: base64, width: 0, height: 0 });
                img.src = base64;
            };
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
        const date = new Date().toLocaleDateString('es-CO', { month: 'long' });
        const year = new Date().getFullYear();
        const fullDate = `Marzo ${year}`;

        // 1. Full-width Tan Header Block
        const pageWidth = doc.internal.pageSize.width;
        doc.setFillColor(219, 207, 172); // Sielu Tan
        doc.rect(0, 0, pageWidth, 75, 'F'); // Increased height

        // Header Text
        doc.setFont("helvetica", "normal");
        doc.setFontSize(36);
        doc.setTextColor(0, 0, 0); // Black text
        doc.text(`Lista de Precios ${fullDate}`, pageWidth / 2, 25, { align: 'center' });

        const logoInfo = await getImageDataFromUrl('/logo.png');
        if (logoInfo && logoInfo.base64 && logoInfo.width > 0) {
            const maxH = 40;
            const maxW = 100;
            let finalW = maxW;
            let finalH = maxW * (logoInfo.height / logoInfo.width);

            if (finalH > maxH) {
                finalH = maxH;
                finalW = maxH * (logoInfo.width / logoInfo.height);
            }
            const x = (pageWidth - finalW) / 2;
            const y = 30 + (maxH - finalH) / 2; // Position slightly lower
            doc.addImage(logoInfo.base64, 'PNG', x, y, finalW, finalH);
        } else {
            doc.setFontSize(50);
            doc.setFont("helvetica", "bold");
            doc.text("Sielu", pageWidth / 2, 55, { align: 'center' });
        }

        // Footer Drawing Function
        const drawFooter = (doc, pageNumber) => {
            const pageHeight = doc.internal.pageSize.height;
            doc.setFontSize(10);
            doc.setTextColor(85, 85, 85);
            doc.setFont("helvetica", "normal");

            doc.text("Sielu", 14, pageHeight - 10);
            doc.text(`Página ${pageNumber}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
            doc.text("+57 3224082010", pageWidth - 14, pageHeight - 10, { align: 'right' });
        };

        // Prepare Data
        const itemsToExport = [...allProducts].filter(item => item.estado !== 'No disponible');

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

        let currentY = 90; // Start lower due to larger header

        for (let i = 0; i < sortedCategories.length; i++) {
            const cat = sortedCategories[i];

            // Category title before table
            doc.setFontSize(26);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(0, 0, 0);
            doc.text(cat, pageWidth / 2, currentY, { align: 'center' });
            currentY += 12;

            // Smaller bold sub-category title
            doc.setFontSize(11);
            doc.setFont("helvetica", "bold");
            doc.text(cat, pageWidth / 2, currentY, { align: 'center' });
            currentY += 8;

            const tableRows = [];
            const adjustment = getGlobalAdjustment() / 100;

            for (const item of grouped[cat]) {
                const imgInfo = await getImageDataFromUrl(item.img);
                const adjustedPrice = item.precio * (1 + adjustment);
                tableRows.push([
                    { content: '', imageInfo: imgInfo },
                    (item.nombre || "").toUpperCase(),
                    item.codigo,
                    formatCurrency(adjustedPrice) // No '$' here, handled in hook
                ]);
            }

            autoTable(doc, {
                startY: currentY,
                head: [['Imagen', 'Nombre', 'Código Facturación', 'Precio antes de IVA']],
                body: tableRows,
                theme: 'plain',
                rowPageBreak: 'avoid',
                headStyles: {
                    fillColor: [255, 253, 242],
                    textColor: [0, 0, 0],
                    fontStyle: 'bold',
                    halign: 'center',
                    fontSize: 10
                },
                columnStyles: {
                    0: { cellWidth: 40, minCellHeight: 40, halign: 'center', valign: 'middle' },
                    1: { cellWidth: 'auto', halign: 'center', valign: 'middle' },
                    2: { cellWidth: 40, halign: 'center', valign: 'middle' },
                    3: { cellWidth: 45, halign: 'right', valign: 'middle' }
                },
                styles: { fontSize: 9, cellPadding: 3, valign: 'middle', lineColor: [255, 255, 255], lineWidth: 0, font: 'helvetica' },
                didDrawCell: (data) => {
                    if (data.section === 'body' && data.column.index === 0 && data.cell.raw.imageInfo) {
                        const info = data.cell.raw.imageInfo;
                        const maxW = 30;
                        const maxH = 30;

                        let finalW = maxW;
                        let finalH = maxH;

                        if (info.width && info.height) {
                            const ratio = info.width / info.height;
                            if (ratio > 1) {
                                // Landscape
                                finalH = maxW / ratio;
                            } else {
                                // Portrait
                                finalW = maxH * ratio;
                            }
                        }

                        const x = data.cell.x + (data.cell.width - finalW) / 2;
                        const y = data.cell.y + (data.cell.height - finalH) / 2;

                        doc.addImage(info.base64, 'JPEG', x, y, finalW, finalH);
                    }

                    // Add explicitly separated $ sign for prices
                    if (data.section === 'body' && data.column.index === 3) {
                        doc.setFont("helvetica", "normal");
                        doc.setFontSize(9);
                        doc.setTextColor(0, 0, 0);
                        const paddingX = data.cell.padding('left');
                        const textY = data.cell.y + (data.cell.height / 2) + 3; // Center roughly
                        doc.text('$', data.cell.x + paddingX, textY);
                    }
                },
                margin: { top: 30, bottom: 25 },
                didDrawPage: (data) => {
                    drawFooter(doc, doc.internal.getNumberOfPages());
                }
            });

            currentY = doc.lastAutoTable.finalY + 20;

            if (i < sortedCategories.length - 1 && currentY > 240) {
                doc.addPage();
                currentY = 20;
            }
        }

        // Final footer cleanup/check (in case of only one page)
        const totalPages = doc.internal.getNumberOfPages();
        for (let j = 1; j <= totalPages; j++) {
            doc.setPage(j);
            drawFooter(doc, j);
        }

        doc.save(`Lista_Precios_Sielu_${fullDate.replace(/\s+/g, '_')}.pdf`);

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
