// src/formulario-cv.js
// Formulario público de carga de CV (postulación a un aviso o base de talentos).

import { llamarFuncion } from './api.js';
import { extractTextFromFile, fileToBase64, escapeHtml, cargarPdfJs } from './utils.js';

const TIPOS_VALIDOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * @param {object} opciones
 * @param {() => number|null} [opciones.obtenerAvisoId] - aviso al que se postula (null = base de talentos)
 * @param {boolean} [opciones.requiereAviso] - no enviar hasta que el aviso esté cargado
 */
export function iniciarFormularioCv({ obtenerAvisoId = () => null, requiereAviso = false } = {}) {
    const fileInput = document.getElementById('file-input');
    const cvForm = document.getElementById('cv-form');
    const submitBtn = document.getElementById('submit-btn');
    const fileLabelText = document.getElementById('file-label-text');
    const formView = document.getElementById('form-view');
    const successView = document.getElementById('success-view');
    const dropZone = document.getElementById('drop-zone');
    const textoBotonOriginal = submitBtn.innerHTML;

    let selectedFile = null;

    function handleFile(file) {
        if (file && TIPOS_VALIDOS.includes(file.type) && file.size <= MAX_BYTES) {
            selectedFile = file;
            dropZone.classList.add('file-selected');
            const iconClass = file.type === 'application/pdf' ? 'fa-solid fa-file-pdf' : 'fa-solid fa-file-image';
            fileLabelText.innerHTML = `
              <i class="${iconClass}" style="color: var(--success-color); font-size: 2rem; margin-bottom: 0.5rem;"></i>
              <span class="file-name">${escapeHtml(file.name)}</span>
              <span class="upload-hint" style="margin-top: 0.5rem;">¡Listo para enviar!</span>
            `;
            submitBtn.disabled = false;
            dropZone.classList.remove('drag-over');
            // Adelantamos la descarga del lector de PDF para que el envío sea más rápido.
            if (file.type === 'application/pdf') cargarPdfJs().catch(() => {});
        } else {
            selectedFile = null;
            submitBtn.disabled = true;
            dropZone.classList.remove('file-selected');
            fileLabelText.innerHTML = `
              <i class="fa-solid fa-cloud-arrow-up upload-icon"></i>
              <span class="upload-text">Arrastra y suelta tu CV aquí o haz clic para seleccionar</span>
              <span class="upload-hint">PDF o imagen (JPG, PNG), máx: 5MB</span>
            `;
            if (file) {
                alert("Por favor, selecciona un archivo PDF o de imagen (JPG, PNG) de menos de 5MB.");
            }
        }
    }

    fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); });

    cvForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const avisoId = obtenerAvisoId();
        if (!selectedFile || (requiereAviso && !avisoId)) return;

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Leyendo tu CV...';

        try {
            // Si no se puede leer el texto igual guardamos el CV: el equipo lo revisa a mano.
            const texto = await extractTextFromFile(selectedFile).catch((error) => {
                console.warn('No se pudo extraer el texto del CV:', error);
                return '';
            });

            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';
            const base64 = await fileToBase64(selectedFile);
            await llamarFuncion('guardar-cv', {
                avisoId,
                texto,
                archivo: { nombre: selectedFile.name, tipo: selectedFile.type, base64 },
            });

            formView.classList.add('hidden');
            successView.classList.remove('hidden');
        } catch (error) {
            console.error("Error en el proceso de carga:", error);
            alert(`No se pudo enviar tu CV: ${error.message}`);
            submitBtn.disabled = false;
            submitBtn.innerHTML = textoBotonOriginal;
        }
    });
}
