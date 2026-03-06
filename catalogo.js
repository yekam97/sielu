import { PageFlip } from "page-flip";
import * as pdfjsLib from "pdfjs-dist";

// Establecer la ruta del worker de pdf.js
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

let pageFlip = null;
const PDF_URL = "./Catálogo Sielu Marzo 2026.pdf"; // El archivo debe estar en la carpeta raíz

async function loadAndRenderPDF() {
    const container = document.getElementById('bookContainer');
    container.innerHTML = '<div class="loading-pdf">Cargando catálogo...</div>';

    try {
        const loadingTask = pdfjsLib.getDocument(PDF_URL);
        const pdf = await loadingTask.promise;
        const numPages = pdf.numPages;

        container.innerHTML = ''; // Limpiar el cargando

        for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const scale = 2; // Alta calidad
            const viewport = page.getViewport({ scale });

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderContext = {
                canvasContext: context,
                viewport: viewport
            };

            await page.render(renderContext).promise;

            const pageEl = document.createElement('div');
            pageEl.className = 'page';
            // Si es la primera o la última página, le damos densidad "hard" (cubierta)
            if (i === 1 || i === numPages) {
                pageEl.setAttribute('data-density', 'hard');
            }

            const pageImage = document.createElement('img');
            pageImage.src = canvas.toDataURL('image/jpeg', 0.8);
            pageImage.style.width = '100%';
            pageImage.style.height = '100%';
            pageImage.style.objectFit = 'contain';

            pageEl.appendChild(pageImage);
            container.appendChild(pageEl);
        }

        initFlipbook();
    } catch (error) {
        console.error("Error al cargar el PDF:", error);
        container.innerHTML = '<p>Error al cargar el catálogo PDF. Verifica que el archivo "Catálogo Sielu Marzo 2026.pdf" esté en la carpeta raíz.</p>';
    }
}

function initFlipbook() {
    const container = document.getElementById('bookContainer');
    const pages = document.querySelectorAll('.page');

    // Obtenemos dimensiones de la primera página para la base
    const firstImg = pages[0].querySelector('img');

    pageFlip = new PageFlip(container, {
        width: 550, // base page width
        height: 750, // base page height
        size: "stretch",
        minWidth: 315,
        maxWidth: 1000,
        minHeight: 420,
        maxHeight: 1350,
        maxShadowOpacity: 0.5,
        showCover: true,
        mobileScrollSupport: false
    });

    pageFlip.loadFromHTML(pages);

    document.getElementById('pageControls').style.display = 'flex';
    updateCounter();

    pageFlip.on('flip', (e) => {
        updateCounter();
    });

    document.getElementById('btnNext').onclick = () => pageFlip.flipNext();
    document.getElementById('btnPrev').onclick = () => pageFlip.flipPrev();
}

function updateCounter() {
    const current = pageFlip.getCurrentPageIndex() + 1;
    const total = pageFlip.getPageCount();
    document.getElementById('pageCounter').innerText = `${current} / ${total}`;
}

// Iniciar proceso
loadAndRenderPDF();
