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
                estado: data.Estado || 'Disponible',
                material: data.Material || '',
                ip: data.IP || '',
                color: data.Color || '',
                temp: data.Temp || '',
                especificaciones: data.Especificaciones || ''
            });
        });

        // Auto-collapse categories by default on mobile (only on initial load)
        if (window.innerWidth <= 768 && collapsedCategories.size === 0) {
            const uniqueCats = new Set(allProducts.map(p => p.cat));
            uniqueCats.forEach(cat => collapsedCategories.add(cat));
        }

        renderTable();
    } catch (error) {
        console.error("Error fetching products: ", error);
        showEmptyState();
    }
}

function showEmptyState() {
    const tbody = document.querySelector('#priceTable tbody');
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 5rem;">No se pudieron cargar los datos. Verifica la configuración de Firebase.</td></tr>`;
}

let currentFilter = '';

function renderTable(filter = currentFilter) {
    currentFilter = filter;
    const tbody = document.querySelector('#priceTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    let items = [...allProducts];
    items = items.filter(item => item.estado !== 'No disponible');

    if (currentFilter) {
        const lowerFilter = currentFilter.toLowerCase();
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
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 5rem;">No se encontraron resultados.</td></tr>`;
        return;
    }

    sortedCategories.forEach(cat => {
        const isCollapsed = collapsedCategories.has(cat);

        const catRow = document.createElement('tr');
        catRow.className = `category-row ${isCollapsed ? 'collapsed' : ''}`;
        catRow.innerHTML = `
            <td colspan="5">
                <div class="category-header-main">
                    <div class="cat-title-group" style="cursor: pointer;">
                        <i data-lucide="${isCollapsed ? 'plus-circle' : 'minus-circle'}" class="cat-toggle-icon"></i>
                        <span class="cat-name">${cat}</span>
                    </div>
                    <button class="cat-download-btn" title="Descargar Categoría">
                        <i data-lucide="file-down"></i>
                        <span>Descargar Categoría</span>
                    </button>
                </div>
            </td>
        `;

        catRow.querySelector('.cat-title-group').onclick = () => {
            if (collapsedCategories.has(cat)) collapsedCategories.delete(cat);
            else collapsedCategories.add(cat);
            renderTable(currentFilter);
        };

        catRow.querySelector('.cat-download-btn').onclick = (e) => {
            e.stopPropagation();
            generatePDF(true, cat);
        };

        tbody.appendChild(catRow);

        if (!isCollapsed) {
            grouped[cat].forEach(item => {
                const tr = document.createElement('tr');
                tr.className = 'product-row';

                tr.innerHTML = `
                    <td class="cell-img" data-label="Imagen">
                        <div class="img-container">
                            <img src="${item.img || ''}" alt="${item.nombre}" loading="lazy" onerror="this.style.display='none'">
                        </div>
                    </td>
                    <td class="cell-name" data-label="Nombre">
                        <div class="name-group">
                            <span class="product-name">${item.nombre}</span>
                        </div>
                    </td>
                    <td class="cell-code" data-label="Facturación">${item.codigo}</td>
                    <td class="cell-price" data-label="Precio Unitario">
                        <div class="price-group">
                            <span class="price-val">$${Math.round(item.precio * (1 + getGlobalAdjustment() / 100)).toLocaleString('es-CO')}</span>
                            <span class="price-label">COP (Antes de IVA)</span>
                        </div>
                    </td>
                    <td class="cell-ficha" data-label="Ficha">
                        ${item.ficha ? `<a href="${item.ficha}" target="_blank" class="ficha-link"><i data-lucide="file-text"></i></a>` : '-'}
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    });

    // Re-initialize Lucide Icons after table render
    if (window.lucide) {
        window.lucide.createIcons();
    }
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

async function generatePDF(includePrices = true, categoryFilter = null) {
    const mainBtn = document.getElementById('btnDownload');
    const noPriceBtn = document.getElementById('btnDownloadNoPrices');

    const originalText = mainBtn.innerHTML;

    // UI Feedback
    mainBtn.disabled = true;
    if (noPriceBtn) noPriceBtn.disabled = true;
    if (categoryFilter) {
        // Find category button if called from there
        console.log("Downloading category:", categoryFilter);
    }

    try {
        const doc = new jsPDF();
        const now = new Date();
        const year = now.getFullYear();
        const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
            "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
        ];
        const fullDate = `${monthNames[now.getMonth()]} ${year}`;

        // 1. Full-width Tan Header Block
        const pageWidth = doc.internal.pageSize.width;
        doc.setFillColor(219, 207, 172); // Sielu Tan
        doc.rect(0, 0, pageWidth, 75, 'F');

        // Header Text
        doc.setFont("helvetica", "normal");
        doc.setFontSize(30);
        doc.setTextColor(0, 0, 0);
        const titleText = categoryFilter ? `${categoryFilter}` : `Lista de Precios ${fullDate}`;
        doc.text(titleText, pageWidth / 2, 25, { align: 'center' });

        const logoInfo = await getImageDataFromUrl('logo.png');
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
            const y = 30 + (maxH - finalH) / 2;
            doc.addImage(logoInfo.base64, 'PNG', x, y, finalW, finalH);
        }

        // Footer Drawing Function
        const drawFooter = (doc, pageNumber) => {
            const pageHeight = doc.internal.pageSize.height;
            doc.setFontSize(10);
            doc.setTextColor(85, 85, 85);
            doc.text(`Página ${pageNumber}`, 14, pageHeight - 10);
            doc.text("+57 314 2188971", pageWidth - 14, pageHeight - 10, { align: 'right' });

            if (pageNumber > 1 && logoInfo && logoInfo.base64) {
                const topW = 35;
                const topH = topW * (logoInfo.height / logoInfo.width);
                doc.addImage(logoInfo.base64, 'PNG', pageWidth - 5 - topW, 5, topW, topH);
            }
        };

        // Prepare Data
        let itemsToExport = [...allProducts].filter(item => item.estado !== 'No disponible');
        if (categoryFilter) {
            itemsToExport = itemsToExport.filter(item => item.cat === categoryFilter);
        }

        const grouped = {};
        itemsToExport.forEach(item => {
            const cat = item.cat;
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item);
        });

        Object.keys(grouped).forEach(cat => {
            grouped[cat].sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));
        });

        const sortedCategories = categoryFilter ? [categoryFilter] : categoryOrder.filter(cat => grouped[cat]);
        if (!categoryFilter) {
            Object.keys(grouped).forEach(cat => {
                if (!sortedCategories.includes(cat)) sortedCategories.push(cat);
            });
        }

        let currentY = 90;

        for (let i = 0; i < sortedCategories.length; i++) {
            const cat = sortedCategories[i];
            const tableRows = [];
            const adjustment = getGlobalAdjustment() / 100;

            for (const item of grouped[cat]) {
                const imgInfo = await getImageDataFromUrl(item.img);
                const adjustedPrice = item.precio * (1 + adjustment);

                const row = [
                    { content: '', imageInfo: imgInfo },
                    (item.nombre || "").toUpperCase(),
                    item.codigo
                ];
                if (includePrices) {
                    row.push(formatCurrency(adjustedPrice));
                }
                tableRows.push(row);
            }

            const headers = ['Imagen', 'Nombre', 'Código Facturación'];
            if (includePrices) headers.push('Precio antes de IVA');

            const colStyles = {
                0: { cellWidth: 40, minCellHeight: 32, halign: 'center', valign: 'middle' },
                1: { cellWidth: 'auto', halign: 'center', valign: 'middle' },
                2: { cellWidth: 40, halign: 'center', valign: 'middle' }
            };
            if (includePrices) colStyles[3] = { cellWidth: 45, halign: 'right', valign: 'middle' };

            autoTable(doc, {
                startY: currentY,
                head: [
                    [{ content: cat, colSpan: includePrices ? 4 : 3, styles: { halign: 'center', fillColor: [255, 252, 242], textColor: [0, 0, 0], fontSize: 12, fontStyle: 'bold' } }],
                    headers
                ],
                body: tableRows,
                theme: 'plain',
                rowPageBreak: 'avoid',
                headStyles: { fillColor: [255, 252, 242], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', fontSize: 10 },
                columnStyles: colStyles,
                styles: { fontSize: 9, cellPadding: 1, valign: 'middle', lineColor: [255, 255, 255], lineWidth: 0.5, font: 'helvetica' },
                didDrawCell: (data) => {
                    if (data.section === 'body' && data.column.index === 0 && data.cell.raw.imageInfo) {
                        const info = data.cell.raw.imageInfo;
                        const maxW = 30;
                        const maxH = 30;
                        let finalW = maxW, finalH = maxH;
                        if (info.width && info.height) {
                            const ratio = info.width / info.height;
                            ratio > 1 ? (finalH = maxW / ratio) : (finalW = maxH * ratio);
                        }
                        const x = data.cell.x + (data.cell.width - finalW) / 2;
                        const y = data.cell.y + (data.cell.height - finalH) / 2;
                        try {
                            // Auto-detect format from base64 data URL
                            let fmt = 'JPEG';
                            if (info.base64.startsWith('data:image/png')) fmt = 'PNG';
                            else if (info.base64.startsWith('data:image/webp')) fmt = 'WEBP';
                            doc.addImage(info.base64, fmt, x, y, finalW, finalH);
                        } catch (imgErr) {
                            console.warn('Imagen omitida en PDF (formato no compatible):', imgErr.message);
                        }
                    }
                    if (includePrices && data.section === 'body' && data.column.index === 3) {
                        doc.setFont("helvetica", "normal");
                        doc.setFontSize(9);
                        doc.text('$', data.cell.x + data.cell.padding('left'), data.cell.y + (data.cell.height / 2) + 3);
                    }
                },
                margin: { top: 30, bottom: 25 }
            });

            currentY = doc.lastAutoTable.finalY + 20;
            if (i < sortedCategories.length - 1 && currentY > 240) {
                doc.addPage();
                currentY = 20;
            }
        }

        // CONTACTO Section
        if (currentY > 230) { doc.addPage(); currentY = 20; } else { currentY += 10; }
        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(219, 207, 172);
        doc.text("CONTACTO", pageWidth / 2, currentY, { align: 'center' });
        currentY += 12;
        doc.setFontSize(11);
        doc.text("WhatsApp", pageWidth / 3, currentY, { align: 'center' });
        doc.text("Instagram", (pageWidth / 3) * 2, currentY, { align: 'center' });
        currentY += 6;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(0, 0, 0);
        doc.text("+57 314 2188971", pageWidth / 3, currentY, { align: 'center' });
        doc.text("@sielu.design", (pageWidth / 3) * 2, currentY, { align: 'center' });

        const totalPages = doc.internal.getNumberOfPages();
        for (let j = 1; j <= totalPages; j++) {
            doc.setPage(j);
            drawFooter(doc, j);
        }

        const fileName = categoryFilter ? `Sielu_${categoryFilter.replace(/\s+/g, '_')}` : `Lista_Precios_Sielu_${fullDate.replace(/\s+/g, '_')}`;
        doc.save(`${fileName}${includePrices ? '' : '_Sin_Precios'}.pdf`);

    } catch (e) {
        console.error("Error generating PDF:", e);
        alert("Ocurrió un error al generar el PDF.");
    } finally {
        mainBtn.disabled = false;
        if (noPriceBtn) noPriceBtn.disabled = false;
    }
}

document.getElementById('btnDownload').addEventListener('click', () => generatePDF(true));
document.getElementById('btnDownloadNoPrices').addEventListener('click', () => generatePDF(false));

// Initialize
fetchProducts();
