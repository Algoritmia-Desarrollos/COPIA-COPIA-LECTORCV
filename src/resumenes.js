// src/resumenes.js

import { supabase } from './supabaseClient.js';
import { toTitleCase } from './utils.js';

// --- SELECTORES DEL DOM ---
const panelTitle = document.getElementById('panel-title');
const processingStatus = document.getElementById('processing-status');
const resumenesListBody = document.getElementById('resumenes-list');
const detailsLinkBtn = document.getElementById('details-link-btn');
const selectAllCheckbox = document.getElementById('select-all-checkbox');
const uploadCvBtn = document.getElementById('upload-cv-btn');
const bulkActionsContainer = document.getElementById('bulk-actions-container');
const bulkActionsCount = document.getElementById('bulk-actions-count');
const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
const modalContainer = document.getElementById('modal-container');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalCloseBtn = document.getElementById('modal-close');
const modalCancelBtn = document.getElementById('modal-cancel');
const modalSaveNotesBtn = document.getElementById('modal-save-notes');

// --- ESTADO DE LA APLICACIÓN ---
let avisoActivo = null;
let postulacionesCache = [];

// --- INICIALIZACIÓN ---
window.addEventListener('DOMContentLoaded', async () => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

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
        if (detailsLinkBtn) {
            detailsLinkBtn.href = `detalles-aviso.html?id=${avisoId}`;
        }

        await cargarYProcesarPostulantes(avisoId);

    } catch (error) {
        console.error("Error al cargar datos iniciales:", error);
        panelTitle.textContent = 'Error de Carga';
    }
});

// --- LÓGICA DE CARGA Y PROCESAMIENTO ---
async function cargarYProcesarPostulantes(avisoId) {
    processingStatus.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Cargando postulantes...`;
    
    const { data, error } = await supabase
        .from('v2_postulaciones')
        .select(`*, v2_candidatos (id)`)
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
        // ... (el resto de la lógica de análisis en el cliente sigue aquí)
        for (const [index, postulacion] of postulacionesNuevas.entries()) {
            processingStatus.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Procesando ${index + 1} de ${postulacionesNuevas.length}...`;
            try {
                const textoCV = postulacion.texto_cv_especifico;
                if (!textoCV) throw new Error("El texto del CV está vacío.");

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
                await supabase.from('v2_postulaciones').update({ calificacion: -1, resumen: err.message }).eq('id', postulacion.id);
                actualizarFilaEnVista(postulacion.id, { calificacion: -1, resumen: err.message });
            }
        }
        processingStatus.textContent = "¡Análisis completado!";
    } else {
        processingStatus.textContent = "Todos los candidatos están analizados.";
    }
}

async function calificarCVConIA(textoCV, aviso) {
    const textoCVOptimizado = textoCV.substring(0, 12000);
    const contextoAviso = `Puesto: ${aviso.titulo}, Descripción: ${aviso.descripcion}, Condiciones Necesarias: ${aviso.condiciones_necesarias.join(', ')}, Condiciones Deseables: ${aviso.condiciones_deseables.join(', ')}`;

    const prompt = `
      Actúa como un Headhunter... (tu prompt completo va aquí)
      ... Devuelve un objeto JSON con 5 claves: "nombreCompleto", "email", "telefono", "calificacion" (número entero), y "justificacion" (string).`;
    
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
    } catch (e) { throw new Error("La IA devolvió una respuesta inesperada."); }
}

// --- RENDERIZADO Y UI ---
function renderizarTablaCompleta() {
    resumenesListBody.innerHTML = '';
    postulacionesCache.sort((a, b) => (b.calificacion ?? 101) - (a.calificacion ?? 101));

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
        renderizarTablaCompleta();
    }
}

function crearFila(postulacion) {
    const row = document.createElement('tr');
    row.dataset.id = postulacion.id;
    row.dataset.candidateId = postulacion.v2_candidatos?.id;

    let calificacionHTML = '<em>Analizando...</em>';
    if(postulacion.calificacion === -1) { calificacionHTML = `<strong style="color: var(--danger-color);">Error</strong>`; }
    else if (typeof postulacion.calificacion === 'number') { calificacionHTML = `<strong>${postulacion.calificacion} / 100</strong>`; }
    
    const nombre = postulacion.nombre_candidato_snapshot || 'Analizando...';
    const email = postulacion.email_snapshot || '';
    const telefono = postulacion.telefono_snapshot || '';

    row.innerHTML = `
        <td><input type="checkbox" class="postulacion-checkbox" data-id="${postulacion.id}"></td>
        <td><strong>${nombre}</strong></td>
        <td><span class="text-light">${postulacion.nombre_archivo_especifico || 'N/A'}</span></td>
        <td>
            <div style="white-space: normal;">${email}</div>
            <div class="text-light">${telefono}</div>
        </td>
        <td>${calificacionHTML}</td>
        <td>
            <button class="btn btn-secondary btn-sm" data-action="ver-resumen" ${!postulacion.resumen ? 'disabled' : ''}>Análisis</button>
        </td>
        <td>
            <div class="actions-group">
                <button class="btn btn-secondary btn-sm" data-action="ver-notas" title="Notas"><i class="fa-solid fa-note-sticky"></i></button>
                <button class="btn btn-primary btn-sm" data-action="ver-cv" title="Descargar CV General"><i class="fa-solid fa-download"></i></button>
            </div>
        </td>
    `;
    
    row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const checkbox = row.querySelector('.postulacion-checkbox');
        checkbox.checked = !checkbox.checked;
        updateBulkActionsVisibility();
    });
    row.querySelector('.postulacion-checkbox').addEventListener('change', updateBulkActionsVisibility);
    row.querySelector('[data-action="ver-resumen"]').addEventListener('click', () => abrirModalResumen(postulacion));
    row.querySelector('[data-action="ver-notas"]').addEventListener('click', () => abrirModalNotas(postulacion));
    
    const downloadBtn = row.querySelector('[data-action="ver-cv"]');
    downloadBtn.addEventListener('click', () => descargarCV(row.dataset.candidateId, downloadBtn));

    return row;
}

// --- ACCIONES Y FUNCIONALIDADES ---
async function descargarCV(candidateId, button) {
    if (!candidateId) return alert('Este candidato no está en la base de datos general.');
    const originalHTML = button.innerHTML;
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    button.disabled = true;

    try {
        const { data, error } = await supabase.from('v2_candidatos').select('base64_general, nombre_archivo_general').eq('id', candidateId).single();
        if (error || !data) throw new Error('No se encontró el CV.');
        const link = document.createElement('a');
        link.href = data.base64_general;
        link.download = data.nombre_archivo_general || 'cv.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (err) {
        alert('Error al descargar el CV.');
    } finally {
        button.innerHTML = originalHTML;
        button.disabled = false;
    }
}

uploadCvBtn.addEventListener('click', () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/pdf';
    fileInput.multiple = true; // Permitir carga masiva
    fileInput.onchange = async (e) => {
        const files = e.target.files;
        if (files.length === 0) return;
        uploadCvBtn.disabled = true;
        uploadCvBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Subiendo ${files.length} CVs...`;
        
        for (const file of files) {
            try {
                const base64 = await fileToBase64(file);
                const textoCV = await extraerTextoDePDF(file);
                const iaData = await extraerDatosConIA(textoCV);
                await procesarCandidatoYPostulacion(iaData, base64, textoCV, file.name, avisoActivo.id);
            } catch (error) {
                alert(`Error al subir el CV ${file.name}: ${error.message}`);
            }
        }
        await cargarYProcesarPostulantes(avisoActivo.id);
        uploadCvBtn.disabled = false;
        uploadCvBtn.innerHTML = `<i class="fa-solid fa-upload"></i> Cargar CVs`;
    };
    fileInput.click();
});

function getSelectedPostulacionIds() {
    return Array.from(resumenesListBody.querySelectorAll('.postulacion-checkbox:checked')).map(cb => cb.dataset.id);
}

function updateBulkActionsVisibility() {
    const selectedIds = getSelectedPostulacionIds();
    bulkActionsContainer.classList.toggle('hidden', selectedIds.length === 0);
    bulkActionsContainer.classList.toggle('visible', selectedIds.length > 0);
    bulkActionsCount.textContent = `${selectedIds.length} seleccionados`;
}

selectAllCheckbox.addEventListener('change', (e) => {
    resumenesListBody.querySelectorAll('.postulacion-checkbox').forEach(cb => cb.checked = e.target.checked);
    updateBulkActionsVisibility();
});

bulkDeleteBtn.addEventListener('click', async () => {
    const idsToDelete = getSelectedPostulacionIds();
    if (idsToDelete.length === 0) return;
    if (confirm(`¿Eliminar ${idsToDelete.length} postulación(es) de esta búsqueda?`)) {
        const { error } = await supabase.from('v2_postulaciones').delete().in('id', idsToDelete);
        if (error) {
            alert('Error al eliminar las postulaciones.');
        } else {
            postulacionesCache = postulacionesCache.filter(p => !idsToDelete.includes(p.id.toString()));
            renderizarTablaCompleta();
            updateBulkActionsVisibility();
        }
    }
});

// --- MODALES ---
function abrirModalResumen(postulacion) { /* ... */ }
function abrirModalNotas(postulacion) { /* ... */ }
function abrirModal() { modalContainer.classList.remove('hidden'); }
function cerrarModal() { modalContainer.classList.add('hidden'); }
modalCloseBtn.addEventListener('click', cerrarModal);
modalCancelBtn.addEventListener('click', cerrarModal);
modalContainer.addEventListener('click', (e) => { if (e.target === modalContainer) cerrarModal(); });

// --- FUNCIONES AUXILIARES DE PROCESAMIENTO ---
async function procesarCandidatoYPostulacion(iaData, base64, textoCV, nombreArchivo, avisoId) {
    let nombreFormateado = toTitleCase(iaData.nombreCompleto) || `Candidato No Identificado ${Date.now()}`;
    const { data: candidato, error: upsertError } = await supabase.from('v2_candidatos').upsert({
        nombre_candidato: nombreFormateado,
        email: iaData.email || 'no-extraido@dominio.com',
        telefono: iaData.telefono,
        base64_general: base64,
        texto_cv_general: textoCV,
        nombre_archivo_general: nombreArchivo,
        updated_at: new Date()
    }, { onConflict: 'nombre_candidato' }).select('id').single();
    if (upsertError) throw new Error(`Error al procesar candidato: ${upsertError.message}`);
    const { error: postulaError } = await supabase.from('v2_postulaciones').insert({
        candidato_id: candidato.id,
        aviso_id: avisoId,
        base64_cv_especifico: base64,
        texto_cv_especifico: textoCV,
        nombre_archivo_especifico: nombreArchivo
    });
    if (postulaError && postulaError.code !== '23505') { throw new Error(`Error: ${postulaError.message}`); }
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}
async function extraerTextoDePDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
    let textoFinal = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        textoFinal += textContent.items.map(item => item.str).join(' ');
    }
    if (textoFinal.trim().length > 50) return textoFinal.trim().replace(/\x00/g, '');
    try {
        const worker = await Tesseract.createWorker('spa');
        const { data: { text } } = await worker.recognize(file);
        await worker.terminate();
        return text || "Texto no legible";
    } catch (error) {
        return "Contenido no legible.";
    }
}
async function extraerDatosConIA(texto) {
    const prompt = `Actúa como RRHH. Extrae nombre, email y teléfono. Texto: """${texto.substring(0,4000)}""" Responde solo JSON con claves "nombreCompleto", "email", "telefono". Si no encuentras, usa null.`;
    try {
        const { data, error } = await supabase.functions.invoke('openaiv2', { body: { query: prompt } });
        if (error) throw error;
        return JSON.parse(data.message);
    } catch (e) {
        return { nombreCompleto: null, email: null, telefono: null };
    }
}