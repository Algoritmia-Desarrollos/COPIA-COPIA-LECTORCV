// src/resumenes.js

import { supabase } from './supabaseClient.js';
import { toTitleCase } from './utils.js';

// --- SELECTORES DEL DOM ---
const panelTitle = document.getElementById('panel-title');
const processingStatus = document.getElementById('processing-status');
const resumenesListBody = document.getElementById('resumenes-list');
const detailsLinkBtn = document.getElementById('details-link-btn');
const modalContainer = document.getElementById('modal-container');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalCloseBtn = document.getElementById('modal-close');
const modalCancelBtn = document.getElementById('modal-cancel');
const modalSaveNotesBtn = document.getElementById('modal-save-notes');

// --- ESTADO DE LA APLICACIÓN ---
let avisoActivo = null;
let postulacionesCache = [];

// --- LÓGICA PRINCIPAL ---
window.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const avisoId = parseInt(urlParams.get('avisoId'), 10);

    if (!avisoId) {
        panelTitle.textContent = 'Error: Búsqueda no encontrada';
        return;
    }

    try {
        const { data, error } = await supabase.from('v2_avisos').select('*').eq('id', avisoId).single();
        if (error) throw error;
        
        avisoActivo = data;
        panelTitle.textContent = `Candidatos para: ${avisoActivo.titulo}`;
        detailsLinkBtn.href = `detalles-aviso.html?id=${avisoId}`;

        await cargarYProcesarCandidatos(avisoId);

    } catch (error) {
        console.error("Error al cargar datos iniciales:", error);
        panelTitle.textContent = 'Error de Carga';
    }
});

/**
 * Carga los postulantes y dispara el análisis EN EL CLIENTE para los nuevos CVs.
 */
async function cargarYProcesarCandidatos(avisoId) {
    processingStatus.classList.remove('hidden');
    processingStatus.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Cargando postulantes...`;

    const { data, error } = await supabase
        .from('v2_postulaciones')
        .select(`*, v2_candidatos (id, nombre_candidato, email, telefono)`)
        .eq('aviso_id', avisoId);

    if (error) {
        processingStatus.textContent = 'Error al cargar postulantes.';
        console.error("Error:", error);
        return;
    }

    postulacionesCache = data;
    renderizarTablaCompleta();
    
    const postulacionesNuevas = postulacionesCache.filter(p => p.calificacion === null);
    
    if (postulacionesNuevas.length > 0) {
        for (const [index, postulacion] of postulacionesNuevas.entries()) {
            processingStatus.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Procesando ${index + 1} de ${postulacionesNuevas.length}: <strong>${postulacion.nombre_candidato_snapshot || 'Nuevo CV'}</strong>`;
            
            try {
                const textoCV = postulacion.texto_cv_especifico;
                if (!textoCV || textoCV.trim().length < 50) {
                    throw new Error("El texto del CV está vacío o es muy corto.");
                }

                const iaData = await calificarCVConIA(textoCV, avisoActivo);

                const updatedPostulacion = {
                    calificacion: iaData.calificacion,
                    resumen: iaData.justificacion,
                    nombre_candidato_snapshot: toTitleCase(iaData.nombreCompleto),
                    email_snapshot: iaData.email,
                    telefono_snapshot: iaData.telefono,
                };

                await supabase.from('v2_postulaciones').update(updatedPostulacion).eq('id', postulacion.id);
                actualizarFilaEnVista(postulacion.id, updatedPostulacion);

            } catch (err) {
                console.error(`Falló el procesamiento para la postulación ${postulacion.id}:`, err);
                await supabase.from('v2_postulaciones').update({ calificacion: -1, resumen: err.message }).eq('id', postulacion.id);
                actualizarFilaEnVista(postulacion.id, { calificacion: -1, resumen: err.message });
            }
        }
        processingStatus.textContent = "¡Análisis completado!";
    } else {
        processingStatus.textContent = "Todos los candidatos están analizados.";
    }
}

/**
 * Llama a la IA para analizar el CV. Esta función ahora se ejecuta en el navegador.
 */
async function calificarCVConIA(textoCV, aviso) {
    const textoCVOptimizado = textoCV.substring(0, 12000);
    const contextoAviso = `Puesto: ${aviso.titulo}, Descripción: ${aviso.descripcion}, Condiciones Necesarias: ${aviso.condiciones_necesarias.join(', ')}, Condiciones Deseables: ${aviso.condiciones_deseables.join(', ')}`;

    const prompt = `
      Actúa como un Headhunter y Especialista Senior en Reclutamiento. Tu misión es analizar un CV contra una búsqueda laboral, culminando en una calificación y justificación profesional.
      **Contexto de la Búsqueda:**
      ${contextoAviso}
      **Texto del CV a Analizar:**
      """${textoCVOptimizado}"""
      ---
      **METODOLOGÍA DE EVALUACIÓN (SEGUIR ESTRICTAMENTE):**
      1.  **Extracción de Datos:** Extrae 'nombreCompleto', 'email', y 'telefono'. Si no están, usa null.
      2.  **Sistema de Calificación (0 a 100):**
          A. **Condiciones Indispensables (hasta 50 puntos):** Por CADA condición indispensable que CUMPLE, suma (50 / total de condiciones).
          B. **Condiciones Deseables (hasta 25 puntos):** Por CADA condición deseable que CUMPLE, suma (25 / total de condiciones).
          C. **Match General (hasta 25 puntos):** Evalúa la experiencia general y calidad del perfil en relación al puesto.
      3.  **Justificación:** Redacta un párrafo conciso justificando la nota.
      **Formato de Salida (JSON estricto):**
      Devuelve un objeto JSON con 5 claves: "nombreCompleto", "email", "telefono", "calificacion" (número entero), y "justificacion" (string).`;

    const { data, error } = await supabase.functions.invoke('openaiv2', { body: { query: prompt } });
    if (error) throw new Error("No se pudo conectar con la IA.");
    try {
        const content = JSON.parse(data.message);
        return {
            nombreCompleto: content.nombreCompleto || 'No especificado',
            email: content.email || 'No especificado',
            telefono: content.telefono || 'No especificado',
            calificacion: content.calificacion === undefined ? 0 : content.calificacion,
            justificacion: content.justificacion || "Sin justificación."
        };
    } catch (e) {
        throw new Error("La IA devolvió una respuesta inesperada.");
    }
}

function renderizarTablaCompleta() {
    resumenesListBody.innerHTML = '';
    postulacionesCache.sort((a, b) => (b.calificacion ?? 101) - (a.calificacion ?? 101)); // Pone los null al principio

    if (postulacionesCache.length === 0) {
        resumenesListBody.innerHTML = `<tr><td colspan="7" style="text-align: center;">Nadie se ha postulado todavía.</td></tr>`;
        return;
    }

    postulacionesCache.forEach(postulacion => {
        resumenesListBody.appendChild(crearFila(postulacion));
    });
}

function actualizarFilaEnVista(postulacionId, datosActualizados) {
    const index = postulacionesCache.findIndex(p => p.id === postulacionId);
    if (index > -1) {
        postulacionesCache[index] = { ...postulacionesCache[index], ...datosActualizados };
        renderizarTablaCompleta(); // Re-renderizar para reordenar y mostrar los datos nuevos
    }
}

function crearFila(postulacion) {
    const row = document.createElement('tr');
    row.dataset.id = postulacion.id;

    let calificacionHTML = '<em>Analizando...</em>';
    if(postulacion.calificacion === -1) {
        calificacionHTML = `<strong style="color: var(--danger-color);">Error</strong>`;
    } else if (typeof postulacion.calificacion === 'number') {
        let color = postulacion.calificacion >= 75 ? '#16a34a' : (postulacion.calificacion >= 50 ? '#ca8a04' : '#dc2626');
        calificacionHTML = `<strong style="color: ${color};">${postulacion.calificacion} / 100</strong>`;
    }
    
    const nombre = postulacion.nombre_candidato_snapshot || 'Analizando...';
    const email = postulacion.email_snapshot || 'Analizando...';
    const telefono = postulacion.telefono_snapshot || 'Analizando...';

    row.innerHTML = `
        <td><input type="checkbox" class="postulacion-checkbox" data-id="${postulacion.id}"></td>
        <td><strong>${nombre}</strong></td>
        <td>${email}</td>
        <td>${telefono}</td>
        <td>${calificacionHTML}</td>
        <td>
            <button class="btn btn-secondary btn-sm" data-action="ver-resumen" ${!postulacion.resumen ? 'disabled' : ''}>Análisis</button>
        </td>
        <td>
            <div class="actions-group">
                <button class="btn btn-secondary btn-sm" data-action="ver-notas" title="Notas"><i class="fa-solid fa-note-sticky"></i></button>
                <button class="btn btn-primary btn-sm" data-action="ver-cv" title="Ver CV"><i class="fa-solid fa-file-pdf"></i></button>
            </div>
        </td>
    `;
    
    row.querySelector('[data-action="ver-resumen"]').addEventListener('click', () => abrirModalResumen(postulacion));
    row.querySelector('[data-action="ver-notas"]').addEventListener('click', () => abrirModalNotas(postulacion));
    row.querySelector('[data-action="ver-cv"]').addEventListener('click', () => window.open(postulacion.base64_cv_especifico, '_blank'));

    return row;
}

// --- MODALES Y ACCIONES ---
function abrirModalResumen(postulacion) {
    modalTitle.textContent = `Análisis de ${postulacion.nombre_candidato_snapshot}`;
    modalBody.innerHTML = `<h4>Calificación: ${postulacion.calificacion}/100</h4><p>${postulacion.resumen || 'No hay análisis.'}</p>`;
    modalSaveNotesBtn.classList.add('hidden');
    abrirModal();
}

function abrirModalNotas(postulacion) {
    modalTitle.textContent = `Notas sobre ${postulacion.nombre_candidato_snapshot}`;
    modalBody.innerHTML = `<textarea id="notas-textarea" class="form-control" style="min-height: 150px;" placeholder="Escribe tus notas...">${postulacion.notas || ''}</textarea>`;
    modalSaveNotesBtn.classList.remove('hidden');
    modalSaveNotesBtn.onclick = async () => {
        const nuevasNotas = document.getElementById('notas-textarea').value;
        await supabase.from('v2_postulaciones').update({ notas: nuevasNotas }).eq('id', postulacion.id);
        postulacionesCache.find(p => p.id === postulacion.id).notas = nuevasNotas;
        cerrarModal();
    };
    abrirModal();
}

function abrirModal() { modalContainer.classList.remove('hidden'); }
function cerrarModal() { modalContainer.classList.add('hidden'); }

modalCloseBtn.addEventListener('click', cerrarModal);
modalCancelBtn.addEventListener('click', cerrarModal);
modalContainer.addEventListener('click', (e) => { if (e.target === modalContainer) cerrarModal(); });