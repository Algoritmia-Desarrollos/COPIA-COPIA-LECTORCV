// src/index.js

import { llamarFuncion } from './api.js';
import { iniciarFormularioCv } from './formulario-cv.js';
import { escapeHtml } from './utils.js';

// --- SELECTORES DEL DOM ---
const cvForm = document.getElementById('cv-form');
const formView = document.getElementById('form-view');
const avisoContainer = document.getElementById('aviso-titulo');

let avisoActivo = null;

// --- FUNCIÓN PARA MOSTRAR QUE LA BÚSQUEDA ESTÁ CERRADA ---
function mostrarBusquedaCerrada(motivo) {
    avisoContainer.textContent = `Esta búsqueda laboral se encuentra cerrada`;
    const mensajeContainer = document.querySelector('.public-page-wrapper .panel-container');
    if (mensajeContainer) {
        // Ocultamos el formulario y mostramos el mensaje de error.
        formView.classList.add('hidden');
        const errorView = document.createElement('div');
        errorView.style.textAlign = 'center';
        errorView.style.padding = '2rem';
        errorView.innerHTML = `
            <i class="fa-solid fa-circle-xmark" style="font-size: 4rem; color: var(--danger-color); margin-bottom: 1rem;"></i>
            <h2 style="color: var(--text-dark); font-size: 1.75rem;">No se admiten más postulaciones</h2>
            <p style="font-size: 1.125rem; color: var(--text-main);">${escapeHtml(motivo)}</p>
        `;
        mensajeContainer.appendChild(errorView);
    }
}

iniciarFormularioCv({ obtenerAvisoId: () => avisoActivo?.id ?? null, requiereAviso: true });

// --- INICIALIZACIÓN ---
async function cargarAviso() {
    const avisoId = parseInt(new URLSearchParams(window.location.search).get('avisoId'), 10);

    if (!avisoId) {
        avisoContainer.textContent = 'Link de postulación inválido.';
        cvForm.classList.add('hidden');
        return;
    }

    try {
        const aviso = await llamarFuncion('aviso-publico', { avisoId });
        if (!aviso.abierto) {
            mostrarBusquedaCerrada(aviso.motivo);
            return;
        }
        avisoActivo = aviso;
        avisoContainer.textContent = `Postúlate para: ${aviso.titulo}`;
    } catch (error) {
        console.error("Error al buscar el aviso:", error);
        mostrarBusquedaCerrada("No pudimos cargar la búsqueda. Intenta de nuevo en unos minutos.");
    }
}

cargarAviso();
