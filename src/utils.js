// src/utils.js

/**
 * Convierte un string a "Title Case", estandarizando los nombres.
 * Ejemplo: "jUan PÉREZ" -> "Juan Pérez"
 * @param {string} str El string del nombre a formatear.
 * @returns {string|null} El nombre formateado o null si la entrada es inválida.
 */
export function toTitleCase(str) {
  if (!str || typeof str !== 'string') return null;
  // Reemplaza múltiples espacios con uno solo, convierte a minúsculas y luego capitaliza cada palabra.
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

