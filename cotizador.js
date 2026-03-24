import { collection, getDocs, query } from "firebase/firestore";
import { db } from "./firebase-config.js";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

let allProducts = [];
let quoteItems = [];
const IVA_RATE = 0.19;

// --- LOGIN LOGIC ---
const loginModal = document.getElementById('loginModal');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const errorMsg = document.getElementById('errorMsg');
const quoteContainer = document.getElementById('quoteContainer');

loginBtn.addEventListener('click', checkPassword);
passwordInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') checkPassword();
});

function checkPassword() {
    if (passwordInput.value === 'Sielu2026') {
        loginModal.style.display = 'none';
        quoteContainer.style.display = 'block';
        fetchProducts(); // Load products once logged in
    } else {
        errorMsg.style.display = 'block';
    }
}

// --- DATA FETCHING ---
async function fetchProducts() {
    try {
        const q = query(collection(db, "productos_sielu"));
        const querySnapshot = await getDocs(q);

        allProducts = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.Estado !== 'No disponible') {
                allProducts.push({
                    id: doc.id,
                    nombre: data.Nombre || '',
                    codigo: data.CodigoFacturacion || '',
                    precioBase: parseFloat(data.PrecioAntesIVA) || 0
                });
            }
        });

        setupAutocomplete();

    } catch (error) {
        console.error("Error fetching products: ", error);
        alert("Error cargando productos database.");
    }
}

// --- AUTOCOMPLETE & SEARCH ---
const searchInput = document.getElementById('productSearch');
const autocompleteList = document.getElementById('autocompleteList');

function setupAutocomplete() {
    searchInput.addEventListener('input', function () {
        const val = this.value;
        autocompleteList.innerHTML = '';

        if (!val) {
            autocompleteList.style.display = 'none';
            return;
        }

        const matches = allProducts.filter(p =>
            p.nombre.toLowerCase().includes(val.toLowerCase()) ||
            p.codigo.toLowerCase().includes(val.toLowerCase())
        );

        if (matches.length > 0) {
            autocompleteList.style.display = 'block';

            // Limit to 10 results for performance
            matches.slice(0, 10).forEach(match => {
                const div = document.createElement('div');
                div.className = 'autocomplete-item';
                div.innerHTML = `<span><b>${match.codigo}</b> - ${match.nombre}</span> <span>$${formatCurrency(match.precioBase)}</span>`;

                div.addEventListener('click', () => {
                    addToQuote(match);
                    searchInput.value = '';
                    autocompleteList.style.display = 'none';
                });

                autocompleteList.appendChild(div);
            });
        } else {
            autocompleteList.style.display = 'none';
        }
    });

    // Close autocomplete when clicking outside
    document.addEventListener('click', function (e) {
        if (e.target !== searchInput && e.target !== autocompleteList) {
            autocompleteList.style.display = 'none';
        }
    });
}

// --- QUOTE LOGIC ---
function addToQuote(product) {
    // Check if item already exists
    const existing = quoteItems.find(item => item.id === product.id);
    if (existing) {
        existing.qty += 1;
    } else {
        quoteItems.push({
            ...product,
            qty: 1,
            manualPrice: null,
            isLocked: false
        });
    }
    renderQuoteTable();
}

function removeFromQuote(id) {
    quoteItems = quoteItems.filter(item => item.id !== id);
    renderQuoteTable();
}

function updateQty(id, newQty) {
    const item = quoteItems.find(i => i.id === id);
    if (item) {
        const val = parseInt(newQty);
        if (val > 0) {
            item.qty = val;
            renderQuoteTable();
        }
    }
}

function updatePrice(id, newPrice) {
    const item = quoteItems.find(i => i.id === id);
    if (item) {
        const val = parseFloat(newPrice);
        if (!isNaN(val)) {
            item.manualPrice = val;
            item.isLocked = true;
            renderQuoteTable();
        }
    }
}

function resetPrice(id) {
    const item = quoteItems.find(i => i.id === id);
    if (item) {
        item.isLocked = false;
        item.manualPrice = null;
        renderQuoteTable();
    }
}

function getMarkupPercentage() {
    const val = parseFloat(document.getElementById('quoteMarkup').value);
    return isNaN(val) ? 0 : val;
}

function calculateItemPrice(item) {
    if (item.isLocked && item.manualPrice !== null) {
        return item.manualPrice;
    }
    const markup = getMarkupPercentage() / 100;
    return item.precioBase + (item.precioBase * markup);
}

function renderQuoteTable() {
    const tbody = document.getElementById('quoteBody');
    tbody.innerHTML = '';

    let subtotal = 0;

    quoteItems.forEach(item => {
        const quotedPrice = calculateItemPrice(item);
        const totalItemPrice = quotedPrice * item.qty;
        subtotal += totalItemPrice;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${item.codigo}</td>
            <td>${item.nombre}</td>
            <td>
                <input type="number" class="qty-input" value="${item.qty}" min="1" 
                       onchange="window.updateQuoteQty('${item.id}', this.value)">
            </td>
            <td style="display: flex; align-items: center; gap: 5px;">
                <input type="number" class="price-input" value="${Math.round(quotedPrice)}" 
                       style="width: 100px; padding: 4px; border: 1px solid ${item.isLocked ? '#DBCFAC' : '#ddd'}; border-radius: 4px; ${item.isLocked ? 'background: #FFFDF2;' : ''}"
                       onchange="window.updateQuotePrice('${item.id}', this.value)">
                ${item.isLocked ? `<button onclick="window.resetQuotePrice('${item.id}')" title="Re-vincular al margen global" style="border:none; background:none; cursor:pointer; font-size: 1.2rem;">🔗</button>` : ''}
            </td>
            <td>$${formatCurrency(totalItemPrice)}</td>
            <td>
                <button class="remove-btn" onclick="window.removeQuoteItem('${item.id}')">Eliminar</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    const iva = subtotal * IVA_RATE;
    const total = subtotal + iva;

    document.getElementById('labelSubtotal').innerText = `$${formatCurrency(subtotal)}`;
    document.getElementById('labelIVA').innerText = `$${formatCurrency(iva)}`;
    document.getElementById('labelTotal').innerText = `$${formatCurrency(total)}`;
}

// Re-render when markup changes
document.getElementById('quoteMarkup').addEventListener('input', renderQuoteTable);

// Global functions for inline HTML handlers
window.updateQuoteQty = updateQty;
window.updateQuotePrice = updatePrice;
window.resetQuotePrice = resetPrice;
window.removeQuoteItem = removeFromQuote;

function formatCurrency(number) {
    return new Intl.NumberFormat('es-CO').format(Math.round(number));
}

// --- PDF EXPORT ---
document.getElementById('btnExportPDF').addEventListener('click', generatePDF);

// Helper to convert image URL to Base64
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
                    resolve({ base64: base64, width: img.width, height: img.height });
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
    if (quoteItems.length === 0) {
        alert("Agrega al menos un producto a la cotización.");
        return;
    }

    const btn = document.getElementById('btnExportPDF');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Generando PDF...';
    btn.disabled = true;

    try {
        const doc = new jsPDF();
        const de = document.getElementById('quoteFrom').value || 'Asesor Sielu';
        const para = document.getElementById('quoteTo').value || 'Cliente';
        const date = new Date().toLocaleDateString('es-CO');

        // Header Logo
        const logoInfo = await getImageDataFromUrl('/logo.png');
        if (logoInfo && logoInfo.base64 && logoInfo.width > 0) {
            const maxH = 15;
            const maxW = 40;
            let finalW = maxW;
            let finalH = maxW * (logoInfo.height / logoInfo.width);
            if (finalH > maxH) {
                finalH = maxH;
                finalW = maxH * (logoInfo.width / logoInfo.height);
            }
            doc.addImage(logoInfo.base64, 'PNG', 14, 10, finalW, finalH);
        } else {
            doc.setFontSize(22);
            doc.setTextColor(219, 207, 172); // Sielu Accent
            doc.text("Sielu", 14, 20);
        }

        doc.setFontSize(16);
        doc.setTextColor(26, 26, 26);
        doc.text("COTIZACIÓN COMERCIAL", 14, 30);

        doc.setFontSize(11);
        doc.setTextColor(85, 85, 85);
        doc.text(`Fecha: ${date}`, 14, 40);
        doc.text(`De: ${de}`, 14, 46);
        doc.text(`Para: ${para}`, 14, 52);

        // Table
        const tableData = quoteItems.map(item => {
            const quotedPrice = calculateItemPrice(item);
            const total = quotedPrice * item.qty;
            return [
                item.codigo,
                item.nombre,
                item.qty.toString(),
                `$${formatCurrency(quotedPrice)}`,
                `$${formatCurrency(total)}`
            ];
        });

        let finalY = 60;

        autoTable(doc, {
            startY: 60,
            head: [['CÓDIGO', 'PRODUCTO', 'CANT.', 'V. UNITARIO', 'V. TOTAL']],
            body: tableData,
            theme: 'striped',
            headStyles: { fillColor: [219, 207, 172], textColor: [26, 26, 26] },
            styles: { fontSize: 9, cellPadding: 3 },
            didDrawPage: function (data) {
                finalY = data.cursor.y;
            }
        });

        // Totals
        let subtotal = 0;
        quoteItems.forEach(item => subtotal += calculateItemPrice(item) * item.qty);
        const iva = subtotal * IVA_RATE;
        const total = subtotal + iva;

        // Position totals on the right side
        const pageWidth = doc.internal.pageSize.width;
        const rightMargin = pageWidth - 14;

        doc.setFontSize(10);
        doc.text(`Subtotal: $${formatCurrency(subtotal)}`, rightMargin, finalY + 10, { align: 'right' });
        doc.text(`IVA (19%): $${formatCurrency(iva)}`, rightMargin, finalY + 16, { align: 'right' });

        doc.setFontSize(13);
        doc.setFont(undefined, 'bold');
        doc.text(`TOTAL: $${formatCurrency(total)}`, rightMargin, finalY + 24, { align: 'right' });

        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(150, 150, 150);
        doc.text("Esta cotización está sujeta a disponibilidad de inventario.", pageWidth / 2, 280, { align: 'center' });

        doc.save(`Cotización_Sielu_${para.replace(/\s+/g, '_')}_${date}.pdf`);

    } catch (e) {
        console.error("Error generating PDF:", e);
        alert("Ocurrió un error al generar la cotización.");
    } finally {
        const btn = document.getElementById('btnExportPDF');
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}
