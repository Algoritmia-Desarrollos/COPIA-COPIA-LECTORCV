// src/resumenes.js

import { supabase } from './supabaseClient.js';

// --- SELECTORES DEL DOM ---
const panelTitle = document.getElementById('panel-title');
const processingStatus = document.getElementById('processing-status');
const resumenesListBody = document.getElementById('resumenes-list');
const selectAllCheckbox = document.getElementById('select-all-checkbox');
const bulkActionsContainer = document.getElementById('bulk-actions-container');
const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
const detailsLinkBtn = document.getElementById('details-link-btn');

// Modal
const modalContainer = document.getElementById('modal-container');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalCloseBtn = document.getElementById('modal-close');
const modalCancelBtn = document.getElementById('modal-cancel');
const modalSaveNotesBtn = document.getElementById('modal-save-notes');

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
        // Obtenemos los datos del aviso para mostrar el título
        const { data, error } = await supabase.from('v2_avisos').select('*').eq('id', avisoId).single();
        if (error) throw error;
        avisoActivo = data;
        panelTitle.textContent = `Candidatos para: ${avisoActivo.titulo}`;
        detailsLinkBtn.href = `detalles-aviso.html?id=${avisoId}`;

        // Cargamos los candidatos y comenzamos el proceso
        await cargarYProcesarPostulantes(avisoId);

        // Escuchar cambios en tiempo real en la tabla de postulaciones
        supabase.channel(`postulaciones_aviso_${avisoId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'v2_postulaciones', filter: `aviso_id=eq.${avisoId}` }, (payload) => {
                console.log('Cambio detectado en tiempo real:', payload.new);
                actualizarFilaEnVista(payload.new);
            })
            .subscribe();

    } catch (error) {
        console.error("Error al cargar datos iniciales:", error);
        panelTitle.textContent = 'Error de Carga';
        resumenesListBody.innerHTML = `<tr><td colspan="7">No se pudo cargar la información del aviso.</td></tr>`;
    }
});

async function cargarYProcesarPostulantes(avisoId) {
    processingStatus.classList.remove('hidden');
    
    // Obtenemos todas las postulaciones y la información del candidato asociado
    const { data, error } = await supabase
        .from('v2_postulaciones')
        .select(`*, v2_candidatos (*)`)
        .eq('aviso_id', avisoId);

    if (error) {
        console.error("Error al cargar postulantes:", error);
        resumenesListBody.innerHTML = `<tr><td colspan="7">Error al cargar la lista de postulantes.</td></tr>`;
        return;
    }

    postulacionesCache = data;

    if (postulacionesCache.length === 0) {
        processingStatus.textContent = "Aún no hay candidatos para esta búsqueda.";
        resumenesListBody.innerHTML = `<tr><td colspan="7" style="text-align: center;">Nadie se ha postulado todavía.</td></tr>`;
        return;
    }
    
    // Renderizamos la tabla con el estado actual
    renderizarTablaCompleta();
    
    // Filtramos las postulaciones que necesitan ser procesadas por la IA
    const postulacionesNuevas = postulacionesCache.filter(p => p.calificacion === null);
    
    if (postulacionesNuevas.length > 0) {
        processingStatus.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Analizando ${postulacionesNuevas.length} nuevo(s) CV(s)... Este proceso ocurre en segundo plano y puede tardar varios minutos. Los resultados aparecerán aquí automáticamente.`;
        
        // Disparamos la función de IA para cada postulante nuevo SIN ESPERAR la respuesta (fire and forget)
        for (const postulacion of postulacionesNuevas) {
            supabase.functions.invoke('process-cv', {
                body: { record: postulacion },
            }).catch(err => console.error(`Error invocando la función para postulante ${postulacion.id}:`, err));
        }
    } else {
        processingStatus.textContent = "Todos los candidatos han sido analizados.";
    }
}

function renderizarTablaCompleta() {
    resumenesListBody.innerHTML = '';
    // Ordenamos para mostrar los que están siendo analizados primero, luego por calificación
    postulacionesCache.sort((a, b) => {
        if (a.calificacion === null && b.calificacion !== null) return -1;
        if (a.calificacion !== null && b.calificacion === null) return 1;
        return (b.calificacion || 0) - (a.calificacion || 0);
    });

    postulacionesCache.forEach(postulacion => {
        resumenesListBody.appendChild(crearFila(postulacion));
    });
}

function actualizarFilaEnVista(postulacionActualizada) {
    const filaExistente = document.querySelector(`tr[data-id='${postulacionActualizada.id}']`);
    if (filaExistente) {
        // Actualizamos la caché local para mantener la consistencia
        const index = postulacionesCache.findIndex(p => p.id === postulacionActualizada.id);
        if (index > -1) {
            postulacionesCache[index] = { ...postulacionesCache[index], ...postulacionActualizada };
        }
        // Re-renderizamos la tabla para re-ordenar por calificación
        renderizarTablaCompleta();
    }
}


function crearFila(postulacion) {
    const candidato = postulacion.v2_candidatos;
    if (!candidato) return document.createElement('tr'); // Devuelve fila vacía si no hay datos

    const row = document.createElement('tr');
    row.dataset.id = postulacion.id;

    let calificacionHTML = '<em>Analizando...</em>';
    if (typeof postulacion.calificacion === 'number') {
        let color = postulacion.calificacion >= 75 ? '#16a34a' : (postulacion.calificacion >= 50 ? '#ca8a04' : '#dc2626');
        calificacionHTML = `<strong style="color: ${color};">${postulacion.calificacion} / 100</strong>`;
    }
    
    row.innerHTML = `
        <td><input type="checkbox" class="postulacion-checkbox" data-id="${postulacion.id}"></td>
        <td><strong>${candidato.nombre_candidato || 'No extraído'}</strong></td>
        <td>${candidato.email}</td>
        <td>${candidato.telefono || 'No extraído'}</td>
        <td>${calificacionHTML}</td>
        <td>
            <button class="btn btn-secondary btn-sm" data-action="ver-resumen" ${!postulacion.resumen ? 'disabled' : ''}>Análisis IA</button>
        </td>
        <td>
            <div class="actions-group">
                <button class="btn btn-secondary btn-sm" data-action="ver-notas" title="Ver/Añadir Notas"><i class="fa-solid fa-note-sticky"></i></button>
                <button class="btn btn-primary btn-sm" data-action="ver-cv" title="Ver CV Original"><i class="fa-solid fa-file-pdf"></i></button>
            </div>
        </td>
    `;
    
    // Listeners para los botones de acción de la fila
    row.querySelector('[data-action="ver-resumen"]').addEventListener('click', () => abrirModalResumen(postulacion));
    row.querySelector('[data-action="ver-notas"]').addEventListener('click', () => abrirModalNotas(postulacion));
    row.querySelector('[data-action="ver-cv"]').addEventListener('click', () => window.open(postulacion.base64_cv_especifico, '_blank'));

    return row;
}

// --- LÓGICA DEL MODAL ---
function abrirModalResumen(postulacion) {
    modalTitle.textContent = `Análisis de ${postulacion.v2_candidatos.nombre_candidato}`;
    modalBody.textContent = postulacion.resumen || 'No hay análisis disponible.';
    modalSaveNotesBtn.classList.add('hidden');
    modalContainer.classList.remove('hidden');
}

function abrirModalNotas(postulacion) {
    modalTitle.textContent = `Notas sobre ${postulacion.v2_candidatos.nombre_candidato}`;
    modalBody.innerHTML = `<textarea id="notas-textarea" class="form-control" style="min-height: 150px;" placeholder="Escribe tus notas aquí...">${postulacion.notas || ''}</textarea>`;
    modalSaveNotesBtn.classList.remove('hidden');
    
    // Guardar notas
    modalSaveNotesBtn.onclick = async () => {
        const nuevasNotas = document.getElementById('notas-textarea').value;
        modalSaveNotesBtn.disabled = true;
        const { error } = await supabase.from('v2_postulaciones').update({ notas: nuevasNotas }).eq('id', postulacion.id);
        if (error) {
            alert('Error al guardar las notas.');
        } else {
            postulacion.notas = nuevasNotas; // Actualizar caché local
            cerrarModal();
        }
        modalSaveNotesBtn.disabled = false;
    };
    
    modalContainer.classList.remove('hidden');
}

function cerrarModal() {
    modalContainer.classList.add('hidden');
}

modalCloseBtn.addEventListener('click', cerrarModal);
modalCancelBtn.addEventListener('click', cerrarModal);
modalContainer.addEventListener('click', (e) => {
    if (e.target === modalContainer) cerrarModal();
});