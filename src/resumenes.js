// src/resumenes.js

import { supabase } from './supabaseClient.js';
import { llamarFuncion, descargarCvCandidato, traerTodas, enLotes } from './api.js';
import { showModal, hideModal, formatRelativeDate, escapeHtml, extractTextFromFile, fileToBase64, cargarExcelJS } from './utils.js';

// --- SELECTORES DEL DOM ---
const reanalizeBtn = document.getElementById('reanalize-btn');
const panelTitle = document.getElementById('panel-title');
const processingStatus = document.getElementById('processing-status');
const postulantesCountDisplay = document.getElementById('postulantes-count-display');
const resumenesListBody = document.getElementById('resumenes-list');
const detailsLinkBtn = document.getElementById('details-link-btn');
const selectAllCheckbox = document.getElementById('select-all-checkbox');
const uploadCvBtn = document.getElementById('upload-cv-btn');
const bulkActionsContainer = document.getElementById('bulk-actions-container');
const bulkActionsCount = document.getElementById('bulk-actions-count');
const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
const modalTitle = document.getElementById('modal-title');
const modalResumenContent = document.getElementById('modal-resumen-content');
const filtroInput = document.getElementById('filtro-candidatos');
const sortSelect = document.getElementById('sort-select');
const minScoreSelect = document.getElementById('min-score-select');
const pipelineFilterSelect = document.getElementById('pipeline-filter-select');
const exportCsvBtn = document.getElementById('export-csv-btn');

// --- ESTADO DE LA APLICACIÓN ---
let avisoActivo = null;
let postulacionesCache = [];
let analisisEnMarcha = false;
let analisisPendienteDeRepetir = false;

const ESTADOS_PIPELINE = [
    ['sin_revisar', 'Sin estado'],
    ['en_proceso', 'En proceso'],
    ['entrevistado', 'Entrevistado'],
    ['contactado', 'Contactado'],
    ['descartado', 'Descartado'],
    ['prohibido', 'Prohibido'],
    ['contratado', 'Contratado'],
];

const estadoDe = (postulacion) => postulacion.v2_candidatos?.estado || 'sin_revisar';
const buscarPostulacion = (id) => postulacionesCache.find(p => p.id === Number(id));

// --- INICIALIZACIÓN ---
window.addEventListener('DOMContentLoaded', async () => {
    reanalizeBtn?.addEventListener('click', reanalizarTodo);
    minScoreSelect?.addEventListener('change', applyFiltersAndSort);
    pipelineFilterSelect?.addEventListener('change', applyFiltersAndSort);
    exportCsvBtn?.addEventListener('click', exportarExcel);
    document.getElementById('compare-btn')?.addEventListener('click', abrirModalComparacion);

    const avisoId = parseInt(new URLSearchParams(window.location.search).get('avisoId'), 10);

    if (avisoId) {
        await cargarDatosDeAviso(avisoId);
    } else {
        panelTitle.textContent = 'Seleccione una búsqueda';
        resumenesListBody.innerHTML = `<tr><td colspan="7" style="text-align: center;">Seleccione una búsqueda para ver los candidatos.</td></tr>`;
        processingStatus.textContent = '';
    }

    document.body.addEventListener('click', (e) => {
        if (e.target.matches('.modal-close-btn')) {
            const modal = e.target.closest('.modal-overlay');
            if (modal) hideModal(modal.id);
        }
    });
});

async function reanalizarTodo() {
    if (!avisoActivo) return;

    // Primera confirmación
    if (!confirm("¿Estás seguro de que quieres re-analizar TODOS los candidatos de este aviso? Se borrarán las calificaciones y análisis actuales.")) {
        return;
    }

    // Segunda confirmación
    const confirmationText = prompt("Esta acción es irreversible. Escribe 'ANALIZAR' para confirmar.");
    if (confirmationText !== 'ANALIZAR') {
        alert("Confirmación incorrecta. La operación ha sido cancelada.");
        return;
    }

    reanalizeBtn.disabled = true;
    reanalizeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Reiniciando...';
    try {
        const { error } = await supabase
            .from('v2_postulaciones')
            .update({ calificacion: null, resumen: null, analisis_iniciado_at: null })
            .eq('aviso_id', avisoActivo.id);
        if (error) throw error;
        await cargarPostulantes(avisoActivo.id);
        analizarPostulantesPendientes();
    } catch (error) {
        console.error("Error durante el reanálisis:", error);
        alert("Ocurrió un error al intentar reiniciar los análisis.");
    } finally {
        reanalizeBtn.disabled = false;
        reanalizeBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Reanálisis';
    }
}

// --- FILTRADO Y BÚSQUEDA ---
let searchTimeout;
filtroInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(applyFiltersAndSort, 300);
});

sortSelect.addEventListener('change', applyFiltersAndSort);

function applyFiltersAndSort() {
    let data = [...postulacionesCache];
    const searchTerm = filtroInput.value.toLowerCase().trim();
    const sortValue = sortSelect.value;
    const minScore = parseInt(minScoreSelect?.value || '0', 10);
    const pipelineFilter = pipelineFilterSelect?.value || 'all';

    if (searchTerm) {
        data = data.filter(postulacion => {
            const candidato = postulacion.v2_candidatos;
            if (!candidato) return false;
            const nombre = (candidato.nombre_candidato || '').toLowerCase();
            const email = (candidato.email || '').toLowerCase();
            const telefono = (candidato.telefono || '').toLowerCase();
            return nombre.includes(searchTerm) || email.includes(searchTerm) || telefono.includes(searchTerm);
        });
    }

    if (minScore > 0) {
        data = data.filter(p => typeof p.calificacion === 'number' && p.calificacion >= minScore);
    }

    if (pipelineFilter !== 'all') {
        data = data.filter(p => estadoDe(p) === pipelineFilter);
    }

    const [sortColumn, sortOrder] = sortValue.split('-');
    const sortAscending = sortOrder === 'asc';

    data.sort((a, b) => {
        if (sortColumn === 'nombre_candidato') {
            const nameA = a.v2_candidatos?.nombre_candidato || '';
            const nameB = b.v2_candidatos?.nombre_candidato || '';
            return sortAscending ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
        }
        if (sortColumn === 'calificacion') {
            const scoreA = a.calificacion ?? -1;
            const scoreB = b.calificacion ?? -1;
            return sortAscending ? scoreA - scoreB : scoreB - scoreA;
        }
        const dateA = new Date(a.created_at || 0);
        const dateB = new Date(b.created_at || 0);
        return sortAscending ? dateA - dateB : dateB - dateA;
    });

    renderizarTabla(data);
}


function actualizarContador() {
    const maxCv = avisoActivo?.max_cv || 'Ilimitados';
    postulantesCountDisplay.innerHTML = `Total de postulantes: <strong>${postulacionesCache.length} / ${maxCv}</strong>`;
}

async function cargarDatosDeAviso(avisoId) {
    try {
        // El aviso y sus postulantes se piden a la vez.
        const [{ data, error }] = await Promise.all([
            supabase.from('v2_avisos').select('id, titulo, max_cv').eq('id', avisoId).single(),
            cargarPostulantes(avisoId),
        ]);
        if (error) throw error;

        avisoActivo = data;
        panelTitle.textContent = `Candidatos para: ${avisoActivo.titulo}`;
        if (detailsLinkBtn) {
            detailsLinkBtn.href = `detalles-aviso.html?id=${avisoId}`;
        }
        actualizarContador();
        analizarPostulantesPendientes();

    } catch (error) {
        console.error("Error al cargar datos iniciales:", error);
        panelTitle.textContent = 'Error de Carga';
    }
}

// --- LÓGICA DE CARGA Y ANÁLISIS ---
async function cargarPostulantes(avisoId) {
    processingStatus.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Cargando todos los postulantes...`;

    // El análisis completo (resumen) se trae recién al abrirlo: la lista carga mucho más rápido.
    let data;
    try {
        data = await traerTodas((opciones) => supabase
            .from('v2_postulaciones')
            .select(`
                id, calificacion, notas, nombre_archivo_especifico, created_at,
                v2_candidatos (id, nombre_candidato, email, telefono, read, estado)
            `, opciones)
            .eq('aviso_id', avisoId)
            .order('id'));
    } catch (error) {
        console.error("Error al cargar postulantes:", error);
        processingStatus.textContent = 'Error al cargar postulantes.';
        return;
    }

    postulacionesCache = data;
    actualizarContador();
    applyFiltersAndSort();
    renderStatsBar();
    processingStatus.innerHTML = '';
}

/** Ejecuta `tarea` sobre `items` con `limite` en paralelo. */
async function procesarEnParalelo(items, limite, tarea) {
    let siguiente = 0;
    const trabajador = async () => {
        while (siguiente < items.length) {
            const item = items[siguiente++];
            await tarea(item);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador));
}

const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Pide al servidor que analice las postulaciones sin calificación.
 * El análisis corre en el servidor, así que aunque se cierre la pestaña los
 * resultados quedan guardados. Las postulaciones con error se reintentan una vez.
 */
async function analizarPostulantesPendientes() {
    if (analisisEnMarcha) {
        analisisPendienteDeRepetir = true;
        return;
    }
    analisisEnMarcha = true;
    const reintentadas = new Set();
    let hechas = 0;

    try {
        for (let ronda = 0; ronda < 60; ronda++) {
            const pendientes = postulacionesCache.filter(p =>
                p.calificacion === null || (p.calificacion === -1 && !reintentadas.has(p.id)));
            if (pendientes.length === 0) break;

            let enCurso = 0;
            const total = hechas + pendientes.length;
            processingStatus.innerHTML = `<i class="fa-solid fa-sync fa-spin"></i> Analizando candidatos: ${hechas} de ${total}...`;

            await procesarEnParalelo(pendientes, 8, async (postulacion) => {
                try {
                    const r = await llamarFuncion('calificar', { postulacionId: postulacion.id });
                    if (r.estado === 'en_curso') {
                        enCurso++;
                        return;
                    }
                    reintentadas.add(postulacion.id);
                    actualizarFilaEnVista(postulacion.id, { calificacion: r.calificacion, resumen: r.resumen });
                } catch (error) {
                    // Un corte de red no es un error del CV: se vuelve a intentar en la próxima vuelta.
                    enCurso++;
                    console.warn(`No se pudo pedir el análisis de ${postulacion.id}:`, error.message);
                    return;
                }
                hechas++;
                processingStatus.innerHTML = `<i class="fa-solid fa-sync fa-spin"></i> Analizando candidatos: ${hechas} de ${total}...`;
            });

            // Otras postulaciones se están analizando en el servidor (por ejemplo, recién cargadas).
            if (enCurso > 0) await esperar(5000);
        }

        const quedan = postulacionesCache.filter(p => p.calificacion === null).length;
        processingStatus.textContent = quedan > 0
            ? `Quedan ${quedan} candidatos en análisis. Recarga la página en unos minutos.`
            : (hechas > 0 ? `¡Análisis completado! Se procesaron ${hechas} candidatos.` : '');
    } finally {
        analisisEnMarcha = false;
        if (analisisPendienteDeRepetir) {
            analisisPendienteDeRepetir = false;
            analizarPostulantesPendientes();
        }
    }
}

// --- RENDERIZADO Y UI ---
function renderizarTabla(postulaciones) {
    if (postulaciones.length === 0) {
        resumenesListBody.innerHTML = `<tr><td colspan="7" style="text-align: center;">No se encontraron candidatos que coincidan con la búsqueda.</td></tr>`;
        updateBulkActionsVisibility();
        return;
    }

    const filas = document.createDocumentFragment();
    postulaciones.forEach(postulacion => filas.appendChild(crearFila(postulacion)));
    resumenesListBody.replaceChildren(filas);
    updateBulkActionsVisibility();
}

function actualizarFilaEnVista(postulacionId, datosActualizados) {
    const index = postulacionesCache.findIndex(p => p.id === postulacionId);
    if (index > -1) {
        // Actualiza la caché de datos en memoria
        postulacionesCache[index] = { ...postulacionesCache[index], ...datosActualizados };

        const oldRow = resumenesListBody.querySelector(`tr[data-id='${postulacionId}']`);
        if (oldRow) {
            // Reemplaza la fila sin reordenar y conservando la selección
            const estabaMarcada = oldRow.querySelector('.postulacion-checkbox')?.checked;
            const newRow = crearFila(postulacionesCache[index]);
            if (estabaMarcada) newRow.querySelector('.postulacion-checkbox').checked = true;
            oldRow.replaceWith(newRow);
        }
    }
    renderStatsBar();
}

function crearFila(postulacion) {
    const row = document.createElement('tr');
    const candidato = postulacion.v2_candidatos;
    row.dataset.id = postulacion.id;

    let calificacionHTML = '<em>Analizando...</em>';
    if (postulacion.calificacion === -1) { calificacionHTML = `<strong style="color: var(--danger-color);">Error</strong>`; }
    else if (typeof postulacion.calificacion === 'number') { calificacionHTML = `<strong>${postulacion.calificacion} / 100</strong>`; }

    const nombre = candidato?.nombre_candidato || 'Analizando...';
    const email = candidato?.email || 'N/A';
    const telefono = candidato?.telefono || 'N/A';
    const tieneNota = postulacion.notas && postulacion.notas.trim() !== '';
    const isLeido = candidato?.read === true;
    const fechaPostulacion = formatRelativeDate(postulacion.created_at);
    const tieneAnalisis = typeof postulacion.calificacion === 'number';

    if (!isLeido) row.classList.add('unread');

    const telefonoWA = telefono.replace(/\D/g, '');
    const msgWA = encodeURIComponent(`Hola ${nombre}, te contactamos en relación a tu postulación.`);
    const waBtnHTML = telefonoWA ? `<a href="https://wa.me/${telefonoWA}?text=${msgWA}" target="wa_window" rel="noopener noreferrer" class="btn btn-secondary btn-sm" title="Enviar WhatsApp" style="display:inline-flex;align-items:center;"><i class="fa-brands fa-whatsapp" style="color:#25d366; font-size:1rem;"></i></a>` : '';

    // Fuente única: v2_candidatos.estado
    const estadoPipeline = estadoDe(postulacion);
    const pipelineClass = estadoPipeline !== 'sin_revisar' ? `ps-${estadoPipeline.replace('_', '-')}` : '';

    row.innerHTML = `
        <td><input type="checkbox" class="postulacion-checkbox" data-id="${postulacion.id}"></td>
        <td>
            <strong class="candidate-name">${escapeHtml(nombre)} ${tieneNota ? '<i class="fa-solid fa-note-sticky text-light" style="font-size:0.75rem;"></i>' : ''}</strong>
            <div class="candidate-filename">${escapeHtml(postulacion.nombre_archivo_especifico || 'No Identificado')}</div>
        </td>
        <td>
            <div style="white-space: normal; overflow: visible; font-size:0.8rem;">${escapeHtml(email)}</div>
            <div style="display:flex; align-items:center; gap:0.3rem; flex-wrap:wrap;">
                <span class="text-light" style="font-size:0.75rem;">${escapeHtml(telefono)}</span>
                ${waBtnHTML}
            </div>
        </td>
        <td style="font-size: 0.78rem; color: var(--text-light); white-space: nowrap;" title="${postulacion.created_at ? new Date(postulacion.created_at).toLocaleDateString('es-AR') : ''}">${fechaPostulacion}</td>
        <td>${calificacionHTML}</td>
        <td>
            <select class="pipeline-select ${pipelineClass}" data-action="set-pipeline">
                ${ESTADOS_PIPELINE.map(([valor, texto]) => `<option value="${valor}" ${estadoPipeline === valor ? 'selected' : ''}>${texto}</option>`).join('')}
            </select>
        </td>
        <td style="text-align:right;">
            <div class="actions-group" style="justify-content:flex-end;">
                <button class="btn btn-secondary btn-sm" data-action="ver-resumen" title="Ver análisis" ${!tieneAnalisis ? 'disabled' : ''}><i class="fa-solid fa-chart-bar"></i></button>
                <button class="btn btn-secondary btn-sm" data-action="ver-notas" title="${tieneNota ? 'Ver notas' : 'Agregar nota'}" style="${tieneNota ? 'color: var(--primary-color);' : 'opacity:0.45;'}"><i class="fa-solid fa-note-sticky"></i></button>
                <button class="btn btn-secondary btn-sm" data-action="toggle-leido" title="${isLeido ? 'Marcar no leído' : 'Marcar leído'}"><i class="fa-solid ${isLeido ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                <button class="btn btn-primary btn-sm" data-action="ver-cv" title="Descargar CV"><i class="fa-solid fa-download"></i></button>
            </div>
        </td>
    `;
    return row;
}

// --- EVENTOS DE LA TABLA (un solo listener para todas las filas) ---
resumenesListBody.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const postulacion = buscarPostulacion(row.dataset.id);
    if (!postulacion) return;

    const boton = e.target.closest('button[data-action]');
    if (boton) {
        switch (boton.dataset.action) {
            case 'ver-resumen':
                marcarComoLeido(postulacion, row);
                abrirModalResumen(postulacion);
                break;
            case 'ver-notas':
                toggleInlineNotas(postulacion, row);
                break;
            case 'toggle-leido':
                toggleLeido(postulacion, row);
                break;
            case 'ver-cv':
                descargarCV(postulacion.v2_candidatos, boton);
                break;
        }
        return;
    }

    if (e.target.closest('a, select, input')) return;
    const checkbox = row.querySelector('.postulacion-checkbox');
    checkbox.checked = !checkbox.checked;
    updateBulkActionsVisibility();
});

resumenesListBody.addEventListener('change', (e) => {
    if (e.target.matches('.postulacion-checkbox')) {
        updateBulkActionsVisibility();
        return;
    }
    if (e.target.matches('[data-action="set-pipeline"]')) {
        const row = e.target.closest('tr[data-id]');
        const postulacion = buscarPostulacion(row.dataset.id);
        const nuevoEstado = e.target.value;
        e.target.className = 'pipeline-select';
        if (nuevoEstado !== 'sin_revisar') e.target.classList.add(`ps-${nuevoEstado.replace('_', '-')}`);
        const candidato = postulacion?.v2_candidatos;
        updateEstadoPipeline(postulacion.id, nuevoEstado, candidato?.id);
        if (candidato) candidato.estado = nuevoEstado === 'sin_revisar' ? null : nuevoEstado;
        renderStatsBar();
    }
});

// --- ACCIONES Y FUNCIONALIDADES ---
async function descargarCV(candidato, button) {
    if (!candidato) return alert('Datos del candidato no disponibles.');
    const originalHTML = button.innerHTML;
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    button.disabled = true;
    try {
        await descargarCvCandidato(candidato.id);
    } catch (err) {
        alert(`Error al descargar el CV: ${err.message}`);
    } finally {
        button.innerHTML = originalHTML;
        button.disabled = false;
    }
}

uploadCvBtn.addEventListener('click', () => {
    if (!avisoActivo) return;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/pdf,image/jpeg,image/png,image/webp';
    fileInput.multiple = true;
    fileInput.onchange = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        uploadCvBtn.disabled = true;
        uploadCvBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Preparando subida...`;

        const existingFileNames = new Set(postulacionesCache.map(p => p.nombre_archivo_especifico));
        const newFiles = files.filter(file => !existingFileNames.has(file.name));
        const archivosOmitidos = files.length - newFiles.length;
        const errors = [];
        let procesados = 0;

        // El servidor guarda cada CV y lo analiza apenas llega.
        await procesarEnParalelo(newFiles, 6, async (file) => {
            try {
                const texto = await extractTextFromFile(file);
                const base64 = await fileToBase64(file);
                await llamarFuncion('guardar-cv', {
                    avisoId: avisoActivo.id,
                    texto,
                    archivo: { nombre: file.name, tipo: file.type, base64 },
                });
            } catch (error) {
                console.error(`Error procesando ${file.name}:`, error);
                errors.push(`${file.name}: ${error.message}`);
            }
            procesados++;
            uploadCvBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Subiendo ${procesados} de ${newFiles.length}`;
        });

        if (archivosOmitidos > 0) {
            alert(`${archivosOmitidos} archivo(s) fueron omitidos porque ya existían en esta búsqueda.`);
        }
        if (errors.length > 0) {
            alert(`Ocurrieron errores al procesar ${errors.length} archivos:\n- ${errors.join('\n- ')}`);
        }

        await cargarPostulantes(avisoActivo.id);
        analizarPostulantesPendientes();

        uploadCvBtn.disabled = false;
        uploadCvBtn.innerHTML = `<i class="fa-solid fa-upload"></i> Cargar CVs`;
    };
    fileInput.click();
});

function getSelectedPostulacionIds() {
    return Array.from(resumenesListBody.querySelectorAll('.postulacion-checkbox:checked')).map(cb => Number(cb.dataset.id));
}

function updateBulkActionsVisibility() {
    const selectedIds = getSelectedPostulacionIds();
    bulkActionsContainer.classList.toggle('hidden', selectedIds.length === 0);

    if (bulkActionsCount) {
        bulkActionsCount.textContent = `${selectedIds.length} seleccionados`;
    }

    const compareBtn = document.getElementById('compare-btn');
    if (compareBtn) {
        compareBtn.classList.toggle('hidden', selectedIds.length < 2 || selectedIds.length > 3);
    }
}

selectAllCheckbox.addEventListener('change', (e) => {
    resumenesListBody.querySelectorAll('.postulacion-checkbox').forEach(cb => cb.checked = e.target.checked);
    updateBulkActionsVisibility();
});

bulkDeleteBtn.addEventListener('click', async () => {
    const idsToDelete = getSelectedPostulacionIds();
    if (idsToDelete.length === 0) return;
    if (confirm(`¿Eliminar ${idsToDelete.length} postulación(es) de esta búsqueda?`)) {
        let error = null;
        for (const lote of enLotes(idsToDelete)) {
            ({ error } = await supabase.from('v2_postulaciones').delete().in('id', lote));
            if (error) break;
        }
        if (error) {
            alert('Error al eliminar las postulaciones.');
        } else {
            const borrar = new Set(idsToDelete);
            postulacionesCache = postulacionesCache.filter(p => !borrar.has(p.id));
            selectAllCheckbox.checked = false;
            actualizarContador();
            applyFiltersAndSort();
            renderStatsBar();
        }
    }
});

// --- MODAL RICO DE ANÁLISIS ---

/** Trae de la base los análisis que todavía no están en memoria. */
async function asegurarResumenes(postulaciones) {
    const faltan = postulaciones.filter(p => p.resumen === undefined).map(p => p.id);
    if (faltan.length === 0) return;
    const { data, error } = await supabase.from('v2_postulaciones').select('id, resumen').in('id', faltan);
    if (error) throw error;
    data.forEach(fila => {
        const p = buscarPostulacion(fila.id);
        if (p) p.resumen = fila.resumen;
    });
}

async function abrirModalResumen(postulacion) {
    const candidato = postulacion.v2_candidatos;
    const nombre = candidato?.nombre_candidato || 'N/A';
    modalTitle.textContent = nombre;
    modalResumenContent.innerHTML = '<p><i class="fa-solid fa-spinner fa-spin"></i> Cargando análisis...</p>';
    showModal('modal-container');

    try {
        await asegurarResumenes([postulacion]);
    } catch (error) {
        modalResumenContent.innerHTML = '<p style="color:var(--danger-color);">No se pudo cargar el análisis.</p>';
        return;
    }

    const email = candidato?.email || '';
    const telefono = candidato?.telefono || '';
    const score = postulacion.calificacion > 0 ? postulacion.calificacion : 0;
    const scoreColor = score >= 70 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
    const initials = nombre.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

    modalResumenContent.innerHTML = `
        <div class="modal-candidate-header">
            <div class="modal-avatar">${escapeHtml(initials)}</div>
            <div class="modal-contact-links">
                ${email ? `<a href="mailto:${escapeHtml(email)}" class="contact-link"><i class="fa-solid fa-envelope"></i> ${escapeHtml(email)}</a>` : ''}
                ${telefono ? `<a href="tel:${escapeHtml(telefono)}" class="contact-link"><i class="fa-solid fa-phone"></i> ${escapeHtml(telefono)}</a>` : ''}
            </div>
        </div>
        <div class="modal-score-section">
            <div class="score-label">Calificación: <strong style="color:${scoreColor}">${postulacion.calificacion === -1 ? 'Error' : `${score}/100`}</strong></div>
            <div class="score-bar-container">
                <div class="score-bar-fill" style="width:${score}%; background-color:${scoreColor};"></div>
            </div>
        </div>
        ${renderResumenEstructurado(postulacion.resumen)}
    `;
}

function renderResumenEstructurado(resumen) {
    if (!resumen) return '<p style="color:var(--text-light);">No hay análisis disponible.</p>';
    const lines = resumen.split('\n').map(l => l.trim()).filter(l => l);
    const sections = [];
    let current = null;
    lines.forEach(line => {
        if (line === '---' || line.startsWith('CONCLUSIÓN:')) return;
        if (/^[A-C]\)/.test(line)) {
            if (current) sections.push(current);
            current = { title: line, items: [] };
        } else if (current && /^(✅|🟠|❌)/u.test(line)) {
            current.items.push(line);
        }
    });
    if (current) sections.push(current);

    // Mensajes de error u otros textos sin el formato del análisis
    if (sections.length === 0) {
        return `<p style="white-space:pre-wrap; color:var(--text-main);">${escapeHtml(resumen)}</p>`;
    }

    return sections.map(sec => {
        const itemsHTML = sec.items.map(item => {
            const emoji = [...item][0];
            const badgeClass = emoji === '✅' ? 'badge-success' : emoji === '🟠' ? 'badge-warning' : 'badge-danger';
            const badgeText = emoji === '✅' ? 'Cumple' : emoji === '🟠' ? 'Parcial' : 'No Cumple';
            const text = [...item].slice(1).join('').trim();
            const colonIdx = text.indexOf(':');
            let label = text, justif = '';
            if (colonIdx > -1) {
                label = text.substring(0, colonIdx).trim();
                justif = text.substring(colonIdx + 1).trim()
                    .replace(/^(Cumple|Parcial|No Cumple|Cumplido|No Cumplido|Alta|Media|Baja|Sí|No|>3 años|1-3 años|<1 año)\.\s*/i, '');
            }
            return `<div class="analysis-item" style="margin-bottom: 0.35rem; line-height: 1.2;">
                <span class="badge ${badgeClass}" style="font-size: 0.65rem; padding: 0.15rem 0.3rem; margin-right: 0.3rem; vertical-align: middle;">${badgeText}</span>
                <strong style="font-size: 0.8rem; color: var(--text-dark); vertical-align: middle;">${escapeHtml(label)}</strong>
                ${justif ? `<span style="font-size: 0.75rem; color: var(--text-light); margin-left: 0.3rem;">- ${escapeHtml(justif)}</span>` : ''}
            </div>`;
        }).join('');
        return `<div class="analysis-section">
            <div class="analysis-section-title">${escapeHtml(sec.title)}</div>
            <div class="analysis-items">${itemsHTML}</div>
        </div>`;
    }).join('');
}

// --- NOTAS INLINE ---
function toggleInlineNotas(postulacion, row) {
    const existingRow = document.getElementById(`notas-row-${postulacion.id}`);
    if (existingRow) { existingRow.remove(); return; }
    document.querySelectorAll('.inline-notes-row').forEach(r => r.remove());

    const notasRow = document.createElement('tr');
    notasRow.id = `notas-row-${postulacion.id}`;
    notasRow.className = 'inline-notes-row';
    notasRow.innerHTML = `
        <td colspan="7">
            <div class="inline-notes-container">
                <textarea class="inline-notes-textarea form-control" placeholder="Escribe una nota sobre este candidato...">${escapeHtml(postulacion.notas || '')}</textarea>
                <div class="inline-notes-actions">
                    <button class="btn btn-primary btn-sm" data-accion-nota="guardar">Guardar</button>
                    <button class="btn btn-secondary btn-sm" data-accion-nota="cancelar">Cancelar</button>
                </div>
            </div>
        </td>
    `;
    row.insertAdjacentElement('afterend', notasRow);
    notasRow.querySelector('textarea').focus();
    notasRow.querySelector('[data-accion-nota="guardar"]').addEventListener('click', async () => {
        const nuevasNotas = notasRow.querySelector('textarea').value;
        const { error } = await supabase.from('v2_postulaciones').update({ notas: nuevasNotas }).eq('id', postulacion.id);
        if (error) {
            alert('No se pudo guardar la nota.');
            return;
        }
        actualizarFilaEnVista(postulacion.id, { notas: nuevasNotas });
        notasRow.remove();
    });
    notasRow.querySelector('[data-accion-nota="cancelar"]').addEventListener('click', () => notasRow.remove());
}

// --- STATS BAR ---
function renderStatsBar() {
    const container = document.getElementById('aviso-stats-bar');
    if (!container) return;
    if (!postulacionesCache.length) { container.innerHTML = ''; return; }

    const conScore = postulacionesCache.filter(p => typeof p.calificacion === 'number' && p.calificacion >= 0);
    const avgScore = conScore.length ? Math.round(conScore.reduce((s, p) => s + p.calificacion, 0) / conScore.length) : 0;
    const altos = conScore.filter(p => p.calificacion >= 70).length;
    const medios = conScore.filter(p => p.calificacion >= 40 && p.calificacion < 70).length;
    const bajos = conScore.filter(p => p.calificacion < 40).length;

    const estados = { sin_revisar: 0, en_proceso: 0, entrevistado: 0, contactado: 0, descartado: 0, prohibido: 0, contratado: 0 };
    postulacionesCache.forEach(p => {
        const e = estadoDe(p);
        if (e in estados) estados[e]++;
    });

    container.innerHTML = `
        <div class="stats-bar">
            <div class="stat-item"><span class="stat-value">${postulacionesCache.length}</span><span class="stat-label">Total</span></div>
            <div class="stat-item"><span class="stat-value">${avgScore}</span><span class="stat-label">Prom.</span></div>
            <div class="stat-item stat-success"><span class="stat-value">${altos}</span><span class="stat-label">≥70</span></div>
            <div class="stat-item stat-warning"><span class="stat-value">${medios}</span><span class="stat-label">40-69</span></div>
            <div class="stat-item stat-danger"><span class="stat-value">${bajos}</span><span class="stat-label">&lt;40</span></div>
            <div class="stat-divider"></div>
            <div class="stat-item"><span class="stat-value">${estados.en_proceso}</span><span class="stat-label">En proceso</span></div>
            <div class="stat-item"><span class="stat-value">${estados.entrevistado}</span><span class="stat-label">Entrevist.</span></div>
            <div class="stat-item"><span class="stat-value">${estados.contratado}</span><span class="stat-label">Contratado</span></div>
            <div class="stat-item"><span class="stat-value">${estados.descartado}</span><span class="stat-label">Descartado</span></div>
        </div>
    `;
}

// --- COMPARACIÓN DE CANDIDATOS ---
async function abrirModalComparacion() {
    const selectedIds = getSelectedPostulacionIds().slice(0, 3);
    const candidatos = postulacionesCache.filter(p => selectedIds.includes(p.id));
    if (candidatos.length < 2) return;

    const compareBody = document.getElementById('compare-modal-body');
    compareBody.innerHTML = '<p><i class="fa-solid fa-spinner fa-spin"></i> Cargando análisis...</p>';
    showModal('compare-modal-container');

    try {
        await asegurarResumenes(candidatos);
    } catch (error) {
        compareBody.innerHTML = '<p style="color:var(--danger-color);">No se pudieron cargar los análisis.</p>';
        return;
    }

    compareBody.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(${candidatos.length}, 1fr); gap: 1rem; align-items: start;">
            ${candidatos.map(p => {
                const c = p.v2_candidatos;
                const nombre = c?.nombre_candidato || 'N/A';
                const email = c?.email || '';
                const telefono = c?.telefono || '';
                const score = p.calificacion > 0 ? p.calificacion : 0;
                const scoreColor = score >= 70 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
                const initials = nombre.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
                return `
                    <div style="border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1rem;">
                        <div style="display:flex; align-items:center; gap:0.75rem; margin-bottom:0.75rem;">
                            <div class="modal-avatar" style="width:38px;height:38px;font-size:0.9rem;flex-shrink:0;">${escapeHtml(initials)}</div>
                            <div>
                                <div style="font-weight:600; font-size:0.9rem;">${escapeHtml(nombre)}</div>
                                ${email ? `<div style="font-size:0.75rem; color:var(--text-light);">${escapeHtml(email)}</div>` : ''}
                                ${telefono ? `<div style="font-size:0.75rem; color:var(--text-light);">${escapeHtml(telefono)}</div>` : ''}
                            </div>
                        </div>
                        <div class="score-bar-container" style="margin-bottom:0.5rem;">
                            <div class="score-bar-fill" style="width:${score}%; background-color:${scoreColor};"></div>
                        </div>
                        <div style="font-weight:700; color:${scoreColor}; margin-bottom:0.75rem;">${score}/100</div>
                        <div style="font-size:0.8rem;">${renderResumenEstructurado(p.resumen)}</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// --- ESTADO (fuente única: v2_candidatos.estado) ---
async function updateEstadoPipeline(postulacionId, estado, candidatoId) {
    if (!candidatoId) return;
    const valorDB = estado === 'sin_revisar' ? null : estado;
    const { error } = await supabase
        .from('v2_candidatos')
        .update({ estado: valorDB })
        .eq('id', candidatoId);
    if (error) {
        console.error('Error actualizando estado:', error);
        alert('No se pudo guardar el estado.');
    }
    // También se guarda en la postulación como historial
    supabase.from('v2_postulaciones').update({ estado_postulacion: estado }).eq('id', postulacionId).then(() => {});
}

// --- EXPORT XLSX (todos los candidatos del aviso) ---
async function exportarExcel() {
    if (!postulacionesCache.length) return;
    const aviso = avisoActivo?.titulo || 'candidatos';
    const originalHTML = exportCsvBtn.innerHTML;
    exportCsvBtn.disabled = true;
    exportCsvBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
        const ExcelJS = await cargarExcelJS();
        const wb = new ExcelJS.Workbook();
        wb.creator = 'Selecta CV';
        const ws = wb.addWorksheet('Candidatos', { views: [{ state: 'frozen', ySplit: 1 }] });

        ws.columns = [
            { header: 'Nombre Candidato',   key: 'nombre',    width: 32 },
            { header: 'Email',              key: 'email',     width: 36 },
            { header: 'Teléfono',           key: 'telefono',  width: 18 },
            { header: 'Calificación',       key: 'score',     width: 14 },
            { header: 'Estado Pipeline',    key: 'pipeline',  width: 18 },
            { header: 'Notas',              key: 'notas',     width: 40 },
            { header: 'Fecha Postulación',  key: 'fecha',     width: 18 },
            { header: 'Archivo CV',         key: 'archivo',   width: 36 },
        ];

        // Header row styling
        const headerRow = ws.getRow(1);
        headerRow.height = 28;
        headerRow.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
            cell.border = { bottom: { style: 'medium', color: { argb: 'FF3730A3' } } };
        });

        // Data rows
        postulacionesCache.forEach((p, i) => {
            const c = p.v2_candidatos;
            const score = p.calificacion;
            const estado = estadoDe(p);
            const row = ws.addRow({
                nombre:   c?.nombre_candidato || '',
                email:    c?.email || '',
                telefono: c?.telefono || '',
                score:    typeof score === 'number' && score >= 0 ? score : '',
                pipeline: estado,
                notas:    p.notas || '',
                fecha:    p.created_at ? new Date(p.created_at).toLocaleDateString('es-AR') : '',
                archivo:  p.nombre_archivo_especifico || '',
            });
            row.height = 20;

            const bgColor = i % 2 === 0 ? 'FFF5F5FF' : 'FFFFFFFF';
            row.eachCell({ includeEmpty: true }, cell => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
                cell.alignment = { vertical: 'middle' };
                cell.font = { size: 10, name: 'Calibri' };
                cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
            });

            // Color-code score cell
            const scoreCell = row.getCell('score');
            if (typeof score === 'number' && score >= 0) {
                const scoreColor = score >= 70 ? 'FF16A34A' : score >= 50 ? 'FFD97706' : 'FFDC2626';
                scoreCell.font = { bold: true, color: { argb: scoreColor }, size: 10 };
                scoreCell.alignment = { horizontal: 'center', vertical: 'middle' };
            }

            // Color-code pipeline cell
            const pColors = { en_proceso: 'FF1D4ED8', entrevistado: 'FF6D28D9', descartado: 'FFB91C1C', contratado: 'FF15803D' };
            if (pColors[estado]) row.getCell('pipeline').font = { bold: true, color: { argb: pColors[estado] }, size: 10 };
        });

        ws.autoFilter = { from: 'A1', to: 'H1' };

        const buffer = await wb.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${aviso.replace(/[^a-zA-Z0-9]/g, '_')}_candidatos.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Error al exportar:', error);
        alert('No se pudo exportar el archivo.');
    } finally {
        exportCsvBtn.disabled = false;
        exportCsvBtn.innerHTML = originalHTML;
    }
}

// --- LEÍDO / NO LEÍDO ---
async function marcarComoLeido(postulacion, row) {
    const candidato = postulacion.v2_candidatos;
    if (!candidato || candidato.read) return;
    await supabase.from('v2_candidatos').update({ read: true }).eq('id', candidato.id);
    candidato.read = true;
    row.classList.remove('unread');
    const btn = row.querySelector('[data-action="toggle-leido"]');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
}

async function toggleLeido(postulacion, row) {
    const candidato = postulacion.v2_candidatos;
    if (!candidato) return;
    const nuevoEstado = !candidato.read;
    await supabase.from('v2_candidatos').update({ read: nuevoEstado }).eq('id', candidato.id);
    candidato.read = nuevoEstado;
    row.classList.toggle('unread', !nuevoEstado);
    const btn = row.querySelector('[data-action="toggle-leido"]');
    if (btn) {
        btn.innerHTML = `<i class="fa-solid ${nuevoEstado ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
        btn.title = nuevoEstado ? 'Marcar no leído' : 'Marcar leído';
    }
}
