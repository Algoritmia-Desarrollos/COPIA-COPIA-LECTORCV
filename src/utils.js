// src/utils.js

/**
 * Escapa texto para insertarlo en HTML. Los nombres, emails y análisis salen
 * de CVs subidos por cualquiera, así que nunca se insertan sin escapar.
 */
export function escapeHtml(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Convierte una fecha a formato relativo legible.
 * Ejemplo: "hace 3 días", "hoy", "hace 2 meses"
 */
export function formatRelativeDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Hoy';
    if (diffDays === 1) return 'Ayer';
    if (diffDays < 7) return `Hace ${diffDays} días`;
    if (diffDays < 30) return `Hace ${Math.floor(diffDays / 7)} sem.`;
    if (diffDays < 365) return `Hace ${Math.floor(diffDays / 30)} meses`;
    return `Hace ${Math.floor(diffDays / 365)} año(s)`;
}

/**
 * Convierte un string a "Title Case", estandarizando los nombres.
 * Ejemplo: "jUan PÉREZ" -> "Juan Pérez"
 * @param {string} str El string del nombre a formatear.
 * @returns {string|null} El nombre formateado o null si la entrada es inválida.
 */
export function toTitleCase(str) {
  if (!str || typeof str !== 'string') return null;
  return str.toLowerCase().trim().replace(/\s+/g, ' ').split(' ').map(word => {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

/**
 * Configura y muestra un modal, asegurando que esté centrado y visible.
 * @param {string} modalId - El ID del overlay del modal.
 */
export function showModal(modalId) {
    const modalOverlay = document.getElementById(modalId);
    if (!modalOverlay) return;

    // Asegura que el overlay tenga la clase correcta para aplicar los estilos de centrado.
    modalOverlay.classList.add('modal-overlay');

    // Quita la clase 'hidden' que usa 'display: none !important'.
    modalOverlay.classList.remove('hidden');

    // Forzar un reflow del navegador es crucial para que la transición funcione
    // después de cambiar la propiedad 'display'.
    void modalOverlay.offsetWidth;

    // Añade la clase 'visible' para iniciar la animación de opacidad y escala.
    modalOverlay.classList.add('visible');
    document.body.style.overflow = 'hidden';

    // Los listeners para cerrar el modal se asignan una vez al cargar la página.
    modalOverlay.onclick = (event) => {
        if (event.target === modalOverlay) {
            hideModal(modalId);
        }
    };
}

/**
 * Oculta un modal y lo saca del layout.
 * @param {string} modalId - El ID del overlay del modal.
 */
export function hideModal(modalId) {
    const modalOverlay = document.getElementById(modalId);
    if (!modalOverlay) {
        return;
    }

    modalOverlay.classList.remove('visible');
    modalOverlay.classList.add('hidden');
    document.body.style.overflow = '';
}

/**
 * Copia texto al portapapeles (con alternativa para navegadores viejos).
 */
export async function copiarAlPortapapeles(texto, inputRespaldo) {
    try {
        await navigator.clipboard.writeText(texto);
    } catch (_) {
        inputRespaldo?.select();
        document.execCommand('copy');
    }
}

// --- LIBRERÍAS BAJO DEMANDA ---
// pdf.js, Tesseract y ExcelJS pesan varios MB: se descargan solo cuando hacen falta.

const LIBRERIAS = {
    pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    exceljs: 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
};
const scriptsCargados = new Map();

function cargarScript(src) {
    if (!scriptsCargados.has(src)) {
        scriptsCargados.set(src, new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = resolve;
            script.onerror = () => {
                scriptsCargados.delete(src);
                reject(new Error('No se pudo cargar una librería. Revisa tu conexión e intenta de nuevo.'));
            };
            document.head.appendChild(script);
        }));
    }
    return scriptsCargados.get(src);
}

export async function cargarPdfJs() {
    await cargarScript(LIBRERIAS.pdfjs);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIBRERIAS.pdfjsWorker;
    return window.pdfjsLib;
}

export async function cargarExcelJS() {
    await cargarScript(LIBRERIAS.exceljs);
    return window.ExcelJS;
}

// Un solo worker de OCR por página: crearlo tarda varios segundos.
let workerOcr = null;
async function obtenerWorkerOcr() {
    if (!workerOcr) {
        workerOcr = cargarScript(LIBRERIAS.tesseract).then(() => window.Tesseract.createWorker('spa'));
        workerOcr.catch(() => { workerOcr = null; });
    }
    return workerOcr;
}

/**
 * Convierte un archivo a data URL (base64).
 */
export function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

/**
 * Extrae texto de un archivo (PDF o imagen) usando OCR si es necesario.
 * @param {File} file - El archivo a procesar.
 * @returns {Promise<string>} El texto extraído del archivo.
 */
export async function extractTextFromFile(file) {
    if (!file) {
        throw new Error("No se proporcionó ningún archivo.");
    }

    const fileType = file.type;

    // --- MANEJO DE PDF ---
    if (fileType === 'application/pdf') {
        const pdfjsLib = await cargarPdfJs();
        let pdf;
        try {
            pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        } catch (error) {
            console.error("No se pudo abrir el PDF:", error);
            throw new Error("No se pudo abrir el PDF, puede estar dañado.");
        }

        // Intento 1: Extracción de texto nativo
        try {
            let textoFinal = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                textoFinal += textContent.items.map(item => item.str).join(' ') + '\n';
            }
            if (textoFinal.trim().length > 50) {
                return textoFinal.trim().replace(/\x00/g, '');
            }
        } catch (error) {
            console.warn("Extracción nativa fallida, se intenta OCR.", error);
        }

        // Intento 2: OCR con Tesseract si el PDF es una imagen escaneada
        try {
            const worker = await obtenerWorkerOcr();
            let ocrText = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 2.0 });
                const canvas = document.createElement('canvas');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                const { data: { text } } = await worker.recognize(canvas);
                ocrText += text + '\n';
            }
            if (ocrText.trim()) return ocrText.trim();
        } catch (error) {
            console.error("El OCR del PDF falló:", error);
        }
        throw new Error("No se pudo leer el texto del PDF.");
    }

    // --- MANEJO DE IMÁGENES ---
    if (fileType.startsWith('image/')) {
        try {
            const worker = await obtenerWorkerOcr();
            const { data: { text } } = await worker.recognize(file);
            return text || '';
        } catch (error) {
            console.error("Error en OCR de imagen:", error);
            throw new Error("No se pudo leer el texto de la imagen.");
        }
    }

    throw new Error(`Tipo de archivo no soportado: ${fileType || 'desconocido'}. Por favor, sube un PDF o una imagen.`);
}
