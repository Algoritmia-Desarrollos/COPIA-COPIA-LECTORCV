// src/utils.js

/**
 * Convierte un string a "Title Case", estandarizando los nombres.
 * Ejemplo: "jUan PÉREZ" -> "Juan Pérez"
 * @param {string} str El string del nombre a formatear.
 * @returns {string|null} El nombre formateado o null si la entrada es inválida.
 */
// src/utils.js
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

    // Asigna listeners para cerrar el modal.
    const closeButton = modalOverlay.querySelector('.modal-close-btn');
    if (closeButton) {
        closeButton.onclick = () => hideModal(modalId);
    }
    
    modalOverlay.onclick = (event) => {
        // Cierra el modal solo si se hace clic en el fondo (el overlay mismo).
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
    }, 350); // Ligeramente más largo que la duración de la transición (0.3s).
}
