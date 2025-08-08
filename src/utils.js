// src/utils.js

/**
 * Convierte un string a "Title Case", estandarizando los nombres.
 * Ejemplo: "jUan PÉREZ" -> "Juan Pérez"
 * @param {string} str El string del nombre a formatear.
 * @returns {string|null} El nombre formateado o null si la entrada es inválida.
 */
// src/utils.js

// Asignar eventos de cierre a todos los modales una vez que el DOM esté cargado.
document.addEventListener('DOMContentLoaded', () => {
    const allCloseButtons = document.querySelectorAll('.modal-close-btn');
    allCloseButtons.forEach(button => {
        const modal = button.closest('.modal-container, .modal-overlay');
        if (modal) {
            button.onclick = () => hideModal(modal.id);
        }
    });
});

export function toTitleCase(str) {
  if (!str || typeof str !== 'string') return null;
  return str.toLowerCase().trim().replace(/\s+/g, ' ').split(' ').map(word => {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

/**
 * Muestra un elemento spinner.
 * @param {string} spinnerId - El ID del elemento spinner en el DOM.
 */
export function showSpinner(spinnerId = 'spinner') {
    const spinner = document.getElementById(spinnerId);
    if (spinner) {
        spinner.style.display = 'block';
    }
}

/**
 * Oculta un elemento spinner.
 * @param {string} spinnerId - El ID del elemento spinner en el DOM.
 */
export function hideSpinner(spinnerId = 'spinner') {
    const spinner = document.getElementById(spinnerId);
    if (spinner) {
        spinner.style.display = 'none';
    }
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
    if (!modalOverlay || !modalOverlay.classList.contains('visible')) {
        return; // No hacer nada si ya está oculto.
    }

    modalOverlay.classList.remove('visible');
    document.body.style.overflow = '';

    // Función que se ejecutará cuando la transición de salida termine.
    const onTransitionEnd = (event) => {
        // Asegurarse de que el evento de transición es del propio overlay.
        if (event.target === modalOverlay) {
            modalOverlay.classList.add('hidden');
            // Limpiar el listener para que no se ejecute múltiples veces.
            modalOverlay.removeEventListener('transitionend', onTransitionEnd);
        }
    };

    modalOverlay.addEventListener('transitionend', onTransitionEnd);

    // Fallback por si el evento 'transitionend' no se dispara.
    setTimeout(() => {
        modalOverlay.classList.add('hidden');
        modalOverlay.removeEventListener('transitionend', onTransitionEnd);
    }, 200); // Ligeramente más largo que la duración de la transición (0.15s).
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
    const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });

    // --- MANEJO DE PDF ---
    if (fileType === 'application/pdf') {
        try {
            const pdf = await pdfjsLib.getDocument(base64).promise;
            let textoFinal = '';

            // Intento 1: Extracción de texto nativo
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                textoFinal += textContent.items.map(item => item.str).join(' ');
            }
            if (textoFinal.trim().length > 50) {
                return textoFinal.trim().replace(/\x00/g, '');
            }

            // Intento 2: OCR con Tesseract si el texto nativo falla
            console.warn("Texto nativo de PDF corto o ausente. Intentando OCR...");
            const worker = await Tesseract.createWorker('spa');
            let ocrText = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 2.0 });
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                await page.render({ canvasContext: context, viewport: viewport }).promise;
                const { data: { text } } = await worker.recognize(canvas.toDataURL());
                ocrText += text + '\n';
            }
            await worker.terminate();
            if (ocrText.trim()) return ocrText;

        } catch (error) {
            console.error("Error procesando PDF, intentando OCR de emergencia:", error);
            // Fallback final si todo lo demás falla
            return await ocrWithTesseract(base64);
        }
    }

    // --- MANEJO DE IMÁGENES ---
    if (fileType.startsWith('image/')) {
        try {
            return await ocrWithTesseract(base64);
        } catch (error) {
            console.error("Error en OCR de imagen:", error);
            throw new Error("No se pudo leer el texto de la imagen.");
        }
    }
    
    // --- MANEJO DE TEXTO PLANO ---
    if (fileType === 'text/plain') {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsText(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }

    throw new Error(`Tipo de archivo no soportado: ${fileType}. Por favor, sube un PDF o una imagen.`);
}

/**
 * Función auxiliar para ejecutar Tesseract OCR sobre una imagen en base64.
 * @param {string} base64Image - La imagen en formato base64.
 * @returns {Promise<string>} El texto reconocido.
 */
async function ocrWithTesseract(base64Image) {
    const worker = await Tesseract.createWorker('spa');
    const { data: { text } } = await worker.recognize(base64Image);
    await worker.terminate();
    return text || "Texto no legible por OCR";
}
