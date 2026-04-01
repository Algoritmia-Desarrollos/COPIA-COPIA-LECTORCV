// src/base-talentos.js

import { supabase } from './supabaseClient.js';
import { showModal, hideModal, formatRelativeDate } from './utils.js';

// --- SELECTORES DEL DOM ---
const folderList = document.getElementById('folder-list');
const folderTitle = document.getElementById('folder-title');
const talentosListBody = document.getElementById('talentos-list-body');
const filtroInput = document.getElementById('filtro-candidatos');
const selectAllCheckbox = document.getElementById('select-all-checkbox');
const sortSelect = document.getElementById('sort-select');
const avisoFilterSelect = document.getElementById('aviso-filter-select');
const statusFilterSelect = document.getElementById('status-filter-select');
const readFilterSelect = document.getElementById('read-filter-select');


// Acciones en Lote
const bulkActionsContainer = document.getElementById('bulk-actions-container');
const moveToFolderSelect = document.getElementById('move-to-folder-select');
const bulkMoveBtn = document.getElementById('bulk-move-btn');
const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
const selectionCount = document.getElementById('selection-count');

// Formulario de Carpetas
const showAddFolderFormBtn = document.getElementById('show-add-folder-form-btn');
const addFolderForm = document.getElementById('add-folder-form');
const addFolderBtn = document.getElementById('add-folder-btn');
const cancelAddFolderBtn = document.getElementById('cancel-add-folder-btn');
const newFolderNameInput = document.getElementById('new-folder-name');
const parentFolderSelect = document.getElementById('parent-folder-select');

// Modales
const editForm = document.getElementById('edit-form');
const editCandidateIdInput = document.getElementById('edit-candidate-id');
const editNombreInput = document.getElementById('edit-nombre');
const editEmailInput = document.getElementById('edit-email');
const editTelefonoInput = document.getElementById('edit-telefono');
const textModalTitle = document.getElementById('text-modal-title');
const textModalBody = document.getElementById('text-modal-body');

// Modal de Notas
const notesForm = document.getElementById('notes-form');
const notesCandidateIdInput = document.getElementById('notes-candidate-id');
const newNoteTextarea = document.getElementById('new-note-textarea');
const notesHistoryContainer = document.getElementById('notes-history-container');

// --- ESTADO GLOBAL ---
let carpetasCache = [];
let currentFolderId = 'all';
let totalCandidates = 0;
let currentSearchTerm = '';
let currentSort = { column: 'created_at', ascending: false };
let currentAvisoId = 'all';
let currentStatusFilter = 'all';
let currentReadFilter = 'all';
let allMatchingIds = [];
let isSelectAllMatchingActive = false;
const PAGE_SIZE = 100;
let currentOffset = 0;
let globalUserId = null;
let globalUserEmail = null;
const ADMIN_EMAILS = ['admin@gmail.com'];

// --- INICIALIZACIÓN ---
window.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        globalUserId = session.user.id;
        globalUserEmail = session.user.email;
    }

    await Promise.all([
        loadFolders(),
        loadAvisos()
    ]);
    const allCandidatesElement = folderList.querySelector("[data-folder-id='all']");
    if (allCandidatesElement) {
        handleFolderClick('all', 'Todos los Candidatos', allCandidatesElement);
    }

    const reloadCandidatesOnChange = () => {
        currentOffset = 0;
        talentosListBody.innerHTML = '';
        loadCandidates();
    };

    let searchTimeout;
    filtroInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearchTerm = filtroInput.value;
            reloadCandidatesOnChange();
        }, 500);
    });

    sortSelect.addEventListener('change', () => {
        const [column, order] = sortSelect.value.split('-');
        currentSort = { column, ascending: order === 'asc' };
        reloadCandidatesOnChange();
    });

    avisoFilterSelect.addEventListener('change', () => {
        currentAvisoId = avisoFilterSelect.value;
        reloadCandidatesOnChange();
    });

    statusFilterSelect.addEventListener('change', () => {
        currentStatusFilter = statusFilterSelect.value;
        reloadCandidatesOnChange();
    });

    readFilterSelect.addEventListener('change', () => {
        currentReadFilter = readFilterSelect.value;
        reloadCandidatesOnChange();
    });

    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => loadCandidates(true));
    }

    selectAllCheckbox.addEventListener('change', handleSelectAll);
    bulkMoveBtn.addEventListener('click', handleBulkMove);
    bulkDeleteBtn.addEventListener('click', handleBulkDelete);
    showAddFolderFormBtn.addEventListener('click', () => toggleAddFolderForm(true));
    cancelAddFolderBtn.addEventListener('click', () => toggleAddFolderForm(false));
    addFolderBtn.addEventListener('click', createNewFolder);
    editForm.addEventListener('submit', handleEditFormSubmit);
    notesForm.addEventListener('submit', handleNotesFormSubmit);

    document.getElementById('select-all-matching-btn').addEventListener('click', selectAllMatching);
    document.getElementById('export-csv-btn')?.addEventListener('click', exportarCSV);

    document.body.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-overlay');
        if (modal && (e.target.matches('.modal-close-btn') || e.target === modal)) {
            hideModal(modal.id);
        }
    });
});


// --- LÓGICA DE CARPETAS ---
async function loadFolders() {
    const { data: foldersData, error: foldersError } = await supabase.from('v2_carpetas').select('*').order('nombre');
    if (foldersError) { console.error("Error al cargar carpetas:", foldersError); return; }

    const { data: countsData, error: countsError } = await supabase.rpc('get_folder_counts');
    if (countsError) { 
        console.error("Error al obtener conteos:", countsError); 
        return;
    }

    const counts = countsData.reduce((acc, item) => {
        acc[item.folder_id === null ? 'none' : item.folder_id] = item.candidate_count;
        return acc;
    }, {});
    
    counts['all'] = countsData.reduce((sum, item) => sum + parseInt(item.candidate_count, 10), 0);
    
    carpetasCache = foldersData;
    renderFoldersUI(counts);
    populateFolderSelects();
}


function renderFoldersUI(counts = {}) {
    folderList.innerHTML = ''; 

    ['Todos los Candidatos', 'Sin Carpeta'].forEach(name => {
        const id = name === 'Todos los Candidatos' ? 'all' : 'none';
        const icon = id === 'all' ? 'fa-inbox' : 'fa-folder-open';
        const count = counts[id] || 0;
        const li = document.createElement('li');
        const folderItem = document.createElement('div');
        folderItem.className = 'folder-item';
        folderItem.dataset.folderId = id;
        folderItem.innerHTML = `<i class="fa-solid ${icon}"></i> <span class="folder-name">${name}</span> <span class="folder-count">(${count})</span>`;
        
        folderItem.addEventListener('click', (e) => handleFolderClick(id, name, e.currentTarget));
        
        if (id === 'none') {
            folderItem.addEventListener('dragover', handleDragOver);
            folderItem.addEventListener('dragleave', handleDragLeave);
            folderItem.addEventListener('drop', handleDrop);
        }

        li.appendChild(folderItem);
        folderList.appendChild(li);
    });

    const carpetasPorId = new Map(carpetasCache.map(c => [c.id, { ...c, children: [] }]));
    const carpetasRaiz = [];

    carpetasCache.forEach(c => {
        if (c.parent_id && carpetasPorId.has(c.parent_id)) {
            carpetasPorId.get(c.parent_id).children.push(carpetasPorId.get(c.id));
        } else {
            carpetasRaiz.push(carpetasPorId.get(c.id));
        }
    });

    const createFolderTree = (carpetas, container, isSublevel = false) => {
        const ul = document.createElement('ul');
        ul.className = 'folder-subtree';
        if (isSublevel) {
            ul.classList.add('is-subfolder-container');
        }

        carpetas.forEach(folder => {
            const li = document.createElement('li');
            const hasChildren = folder.children.length > 0;
            const count = counts[folder.id] || 0;
            li.innerHTML = `
                <div class="folder-item ${isSublevel ? 'is-subfolder' : ''}" data-folder-id="${folder.id}" draggable="true">
                    <span class="folder-toggle">${hasChildren ? '<i class="fa-solid fa-chevron-right"></i>' : ''}</span>
                    <i class="fa-solid fa-folder"></i> 
                    <span class="folder-name">${folder.nombre}</span>
                    <span class="folder-count">(${count})</span>
                    <div class="folder-item-actions">
                        <button class="btn-icon" data-action="edit-folder"><i class="fa-solid fa-pencil"></i></button>
                        <button class="btn-icon" data-action="delete-folder"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </div>
            `;
            if (hasChildren) {
                createFolderTree(folder.children, li, true);
                li.querySelector('.folder-toggle').addEventListener('click', (e) => {
                    e.stopPropagation();
                    li.classList.toggle('open');
                    const icon = li.querySelector('.folder-item > .fa-solid.fa-folder, .folder-item > .fa-solid.fa-folder-open');
                    if (icon) {
                        icon.classList.toggle('fa-folder', !li.classList.contains('open'));
                        icon.classList.toggle('fa-folder-open', li.classList.contains('open'));
                    }
                });
            }
            li.querySelector('[data-action="edit-folder"]').addEventListener('click', (e) => {
                e.stopPropagation();
                editFolder(folder.id, folder.nombre);
            });
            li.querySelector('[data-action="delete-folder"]').addEventListener('click', (e) => {
                e.stopPropagation();
                deleteFolder(folder.id);
            });
            ul.appendChild(li);
        });
        container.appendChild(ul);
    };

    createFolderTree(carpetasRaiz, folderList, false);
    addDragAndDropListeners();
}

function addDragAndDropListeners() {
    folderList.querySelectorAll('.folder-item[draggable="true"]').forEach(item => {
        item.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.folderId;
            const name = e.currentTarget.querySelector('.folder-name').textContent;
            handleFolderClick(id, name, e.currentTarget);
        });

        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragend', handleDragEnd);
    });
}

let draggedItemId = null;

function handleDragStart(e) {
    e.stopPropagation();
    const target = e.currentTarget;
    
    if (target.matches('.folder-item')) {
        draggedItemId = target.dataset.folderId;
        e.dataTransfer.setData('text/plain', `folder:${draggedItemId}`);
    } else if (target.matches('tr[data-id]')) {
        const candidateId = target.dataset.id;
        const selectedIds = getSelectedIds();
        
        const idsToDrag = selectedIds.includes(candidateId) ? selectedIds : [candidateId];
        
        draggedItemId = idsToDrag;
        e.dataTransfer.setData('text/plain', `candidate:${idsToDrag.join(',')}`);
    }
    
    e.dataTransfer.effectAllowed = 'move';
    target.classList.add('dragging');
}


function handleDragOver(e) {
    e.preventDefault();
    const targetItem = e.currentTarget;
    if (targetItem.dataset.folderId !== draggedItemId) {
        targetItem.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

async function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const targetItem = e.currentTarget;
    targetItem.classList.remove('drag-over');

    const targetFolderId = targetItem.dataset.folderId;
    const data = e.dataTransfer.getData('text/plain');

    if (!data || !targetFolderId) return;

    const [type, ids] = data.split(':');
    
    if (type === 'folder') {
        const draggedFolderId = ids;
        if (draggedFolderId && targetFolderId !== draggedFolderId) {
            const newParentId = targetFolderId === 'all' || targetFolderId === 'none' ? null : parseInt(targetFolderId, 10);
            const { error } = await supabase.from('v2_carpetas').update({ parent_id: newParentId }).eq('id', draggedFolderId);
            if (error) {
                alert('Error al mover la carpeta.');
            } else {
                await loadFolders();
            }
        }
    } else if (type === 'candidate') {
        const candidateIds = ids.split(',');
        const newFolderId = targetFolderId === 'none' || targetFolderId === 'all' ? null : parseInt(targetFolderId, 10);
        
        if (candidateIds.length > 0) {
            const { error } = await supabase.from('v2_candidatos').update({ carpeta_id: newFolderId }).in('id', candidateIds);
            if (error) {
                alert(`Error al mover ${candidateIds.length > 1 ? 'los candidatos' : 'el candidato'}.`);
            } else {
                await Promise.all([loadCandidates(), loadFolders()]);
                updateBulkActionsVisibility();
            }
        }
    }

    draggedItemId = null;
}


function handleDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
}

async function editFolder(id, currentName) {
    const newName = prompt("Editar nombre de la carpeta:", currentName);
    if (newName && newName.trim() !== "" && newName !== currentName) {
        const { error } = await supabase
            .from('v2_carpetas')
            .update({ nombre: newName.trim() })
            .eq('id', id);

        if (error) {
            alert("Error al actualizar la carpeta.");
        } else {
            await loadFolders();
        }
    }
}

async function deleteFolder(id) {
    if (confirm("¿Estás seguro de que quieres eliminar esta carpeta? Los candidatos dentro no serán eliminados, pero quedarán sin carpeta.")) {
        const { error: updateError } = await supabase
            .from('v2_candidatos')
            .update({ carpeta_id: null })
            .eq('carpeta_id', id);

        if (updateError) {
            alert("Error al quitar candidatos de la carpeta.");
            return;
        }

        const { error: deleteError } = await supabase
            .from('v2_carpetas')
            .delete()
            .eq('id', id);

        if (deleteError) {
            alert("Error al eliminar la carpeta.");
        } else {
            await loadFolders();
            if (currentFolderId == id) {
                handleFolderClick('all', 'Todos los Candidatos', folderList.querySelector("[data-folder-id='all']"));
            }
        }
    }
}

function handleFolderClick(id, name, element) {
    currentFolderId = id;
    filtroInput.value = '';
    currentSearchTerm = '';
    folderTitle.textContent = name;
    folderList.querySelectorAll('.folder-item.active').forEach(el => el.classList.remove('active'));
    if (element) {
        element.classList.add('active');
    }
    
    talentosListBody.innerHTML = '';
    loadCandidates();
}


// --- LÓGICA DE CANDIDATOS ---
async function loadCandidates(append = false) {
    if (!append) {
        currentOffset = 0;
        talentosListBody.innerHTML = `<tr><td colspan="6" style="text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando...</td></tr>`;
    } else {
        const loadMoreBtn = document.getElementById('load-more-btn');
        if (loadMoreBtn) { loadMoreBtn.disabled = true; loadMoreBtn.textContent = 'Cargando...'; }
    }

    let query = supabase
        .from('v2_candidatos')
        .select(`
            id, nombre_candidato, email, telefono, ubicacion, nombre_archivo_general, estado, read, created_at,
            v2_carpetas(nombre),
            v2_notas_historial(count),
            v2_postulaciones(id, estado_postulacion, v2_avisos(titulo, user_id))
        `, { count: 'exact' });

    // Aplicar filtros
    if (currentFolderId === 'none') {
        query = query.is('carpeta_id', null);
    } else if (currentFolderId !== 'all') {
        query = query.eq('carpeta_id', currentFolderId);
    }

    if (currentAvisoId !== 'all') {
        query = query.select(`
            id, nombre_candidato, email, telefono, ubicacion, nombre_archivo_general, estado, read, created_at,
            v2_carpetas(nombre),
            v2_notas_historial(count),
            v2_postulaciones!inner(id, aviso_id, estado_postulacion, v2_avisos(titulo))
        `).eq('v2_postulaciones.aviso_id', currentAvisoId);
    }

    if (currentSearchTerm) {
        const searchTerm = `%${currentSearchTerm}%`;
        query = query.or(`nombre_candidato.ilike.${searchTerm},email.ilike.${searchTerm},telefono.ilike.${searchTerm}`);
    }

    if (currentStatusFilter !== 'all') {
        if (currentStatusFilter === 'sin_estado') {
            query = query.is('estado', null);
        } else {
            query = query.eq('estado', currentStatusFilter);
        }
    }

    if (currentReadFilter !== 'all') {
        const isRead = currentReadFilter === 'leido';
        query = query.eq('read', isRead);
    }

    // Aplicar orden
    query = query.order(currentSort.column, { ascending: currentSort.ascending });

    query = query.range(currentOffset, currentOffset + PAGE_SIZE - 1);

    const { data, error, count } = await query;

    if (error) {
        console.error("Error al cargar candidatos:", error);
        if (!append) talentosListBody.innerHTML = `<tr><td colspan="6" style="text-align: center;">Error al cargar datos.</td></tr>`;
        return;
    }

    totalCandidates = count;
    currentOffset += (data?.length || 0);
    renderTable(data, append);
    updateLoadMoreBtn(count);
    updateBulkActionsVisibility();
}


// --- RENDERIZADO Y UI ---
function updateLoadMoreBtn(totalCount) {
    const btn = document.getElementById('load-more-btn');
    const counter = document.getElementById('candidates-counter');
    if (counter) counter.textContent = `Mostrando ${Math.min(currentOffset, totalCount)} de ${totalCount}`;
    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Cargar más';
        btn.classList.toggle('hidden', currentOffset >= totalCount);
    }
}

function renderTable(candidatos, append = false) {
    if (!append) talentosListBody.innerHTML = '';

    if (!candidatos || candidatos.length === 0) {
        if (!append) talentosListBody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No se encontraron candidatos para los filtros seleccionados.</td></tr>';
        return;
    }

    candidatos.forEach(candidato => {
        const row = document.createElement('tr');
        row.dataset.id = candidato.id;
        row.dataset.estado = candidato.estado || 'normal';

        if (candidato.read) {
            row.classList.add('read');
        }

        const estadoClass = getEstadoClass(candidato.estado);
        const tieneNotas = candidato.v2_notas_historial && candidato.v2_notas_historial.length > 0 && candidato.v2_notas_historial[0].count > 0;
        const estadoActual = candidato.estado || '';
        const telWA = (candidato.telefono || '').replace(/\D/g, '');
        const waBtnBT = telWA ? `<a href="https://wa.me/${telWA}" target="wa_window" rel="noopener noreferrer" class="btn btn-secondary btn-sm" title="WhatsApp" style="display:inline-flex;align-items:center;" onclick="event.stopPropagation()"><i class="fa-brands fa-whatsapp" style="color:#25d366;font-size:1rem;"></i></a>` : '';

        // Avisos en que participó + estado pipeline por aviso
        // Solo mostrar avisos como pills (sin select, el estado va en la columna acciones)
        
        const isAdmin = ADMIN_EMAILS.includes(globalUserEmail);
        let postulaciones = (candidato.v2_postulaciones || []).filter(p => p.v2_avisos?.titulo);
        
        if (!isAdmin) {
            // Si NO es admin de todo el sistema, ocultar los avisos en los que no es el creador
            postulaciones = postulaciones.filter(p => p.v2_avisos.user_id === globalUserId);
        }

        const avisosHTML = postulaciones.length
            ? `<div class="candidate-avisos">${postulaciones.map(p =>
                `<span class="aviso-pill" title="${p.v2_avisos.titulo}">${p.v2_avisos.titulo}</span>`
              ).join('')}</div>`
            : '';

        row.innerHTML = `
            <td><input type="checkbox" class="candidate-checkbox" data-id="${candidato.id}"></td>
            <td>
                <div class="candidate-name-container">
                    <span class="candidate-name ${estadoClass}">${candidato.nombre_candidato || 'No extraído'}</span>
                    ${tieneNotas ? '<i class="fa-solid fa-note-sticky has-notes-icon" title="Tiene notas"></i>' : ''}
                </div>
                <div class="candidate-filename">${candidato.nombre_archivo_general || 'No Identificado'}</div>
                ${avisosHTML}
            </td>
            <td>${candidato.v2_carpetas?.nombre || '<em>Sin Carpeta</em>'}</td>
            <td>
                <div style="white-space: normal; overflow: hidden; text-overflow: ellipsis;">${candidato.email || ''}</div>
                <div style="display:flex; align-items:center; gap:0.3rem; flex-wrap:nowrap;">
                    <span class="text-light" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${candidato.telefono || ''}</span>
                    ${waBtnBT}
                </div>
            </td>
            <td style="font-size: 0.8rem; color: var(--text-light); white-space: nowrap;" title="${candidato.created_at ? new Date(candidato.created_at).toLocaleDateString('es-AR') : ''}">
                ${formatRelativeDate(candidato.created_at)}
            </td>
            <td class="actions-cell" style="text-align: right; white-space: nowrap;">
                ${(() => {
                    const ep = estadoActual || 'sin_revisar';
                    const cls = { en_proceso:'ps-en-proceso', entrevistado:'ps-entrevistado', contactado:'ps-contactado', descartado:'ps-descartado', prohibido:'ps-prohibido', contratado:'ps-contratado' }[ep] || '';
                    return `<select class="pipeline-select ${cls}" data-action="set-global-estado" style="max-width:130px;">
                        <option value="sin_revisar"  ${ep==='sin_revisar'  ?'selected':''}>Sin estado</option>
                        <option value="en_proceso"   ${ep==='en_proceso'   ?'selected':''}>En proceso</option>
                        <option value="entrevistado" ${ep==='entrevistado' ?'selected':''}>Entrevistado</option>
                        <option value="contactado"   ${ep==='contactado'   ?'selected':''}>Contactado</option>
                        <option value="descartado"   ${ep==='descartado'   ?'selected':''}>Descartado</option>
                        <option value="prohibido"    ${ep==='prohibido'    ?'selected':''}>Prohibido</option>
                        <option value="contratado"   ${ep==='contratado'   ?'selected':''}>Contratado</option>
                    </select>`;
                })()}
                <button class="btn btn-secondary btn-sm" data-action="toggle-actions" title="Más acciones" style="margin-left:0.4rem;">
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
            </td>
        `;
        addTableRowListeners(row);
        // Select de estado global del candidato
        const globalEstadoSel = row.querySelector('[data-action="set-global-estado"]');
        if (globalEstadoSel) {
            globalEstadoSel.addEventListener('change', async (e) => {
                e.stopPropagation();
                const nuevoEstado = globalEstadoSel.value;
                const cls = { en_proceso:'ps-en-proceso', entrevistado:'ps-entrevistado', contactado:'ps-contactado', descartado:'ps-descartado', prohibido:'ps-prohibido', contratado:'ps-contratado' };
                globalEstadoSel.className = `pipeline-select ${cls[nuevoEstado] || ''}`.trim();
                row.dataset.estado = nuevoEstado;
                const valorDB = nuevoEstado === 'sin_revisar' ? null : nuevoEstado;
                await supabase.from('v2_candidatos').update({ estado: valorDB }).eq('id', candidato.id);
            });
        }
        // Pipeline selects por aviso
        row.querySelectorAll('.pipeline-select[data-postulacion-id]').forEach(sel => {
            sel.addEventListener('change', async (e) => {
                e.stopPropagation();
                const nuevoEstado = sel.value;
                const postulacionId = sel.dataset.postulacionId;
                const candidatoIdSel = sel.dataset.candidatoId;
                const cls = { en_proceso: 'ps-en-proceso', entrevistado: 'ps-entrevistado', descartado: 'ps-descartado', contratado: 'ps-contratado' };
                sel.className = `pipeline-select ${cls[nuevoEstado] || ''}`.trim();
                await supabase.from('v2_postulaciones').update({ estado_postulacion: nuevoEstado }).eq('id', postulacionId);
                // Sincronizar con v2_candidatos
                const estadoMap = { contratado: 'contratado', en_proceso: 'contactado', entrevistado: 'contactado' };
                if (estadoMap[nuevoEstado] && candidatoIdSel) {
                    await supabase.from('v2_candidatos').update({ estado: estadoMap[nuevoEstado] }).eq('id', candidatoIdSel);
                }
            });
        });
        talentosListBody.appendChild(row);
    });
}


function addTableRowListeners(row) {
    row.draggable = true;
    row.addEventListener('dragstart', handleDragStart);
    row.addEventListener('dragend', handleDragEnd);

    row.addEventListener('click', (e) => {
        if (e.target.closest('button, a, input')) return;
        const checkbox = row.querySelector('.candidate-checkbox');
        if (checkbox) {
            checkbox.checked = !checkbox.checked;
            updateBulkActionsVisibility();
        }
    });

    row.querySelector('.candidate-checkbox')?.addEventListener('change', updateBulkActionsVisibility);
    row.querySelector('[data-action="toggle-actions"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleActionRow(row);
    });
    // quick-status buttons eliminados — reemplazados por pipeline-select global
}

function toggleActionRow(row) {
    const existingActionRow = document.getElementById(`actions-${row.dataset.id}`);
    const candidateStatus = row.dataset.estado;
    const isRead = row.classList.contains('read');
    
    document.querySelectorAll('.actions-row').forEach(r => {
        if (r.id !== `actions-${row.dataset.id}`) {
            r.remove();
        }
    });

    if (existingActionRow) {
        existingActionRow.remove();
    } else {
        const actionRow = document.createElement('tr');
        actionRow.id = `actions-${row.dataset.id}`;
        actionRow.className = 'actions-row';

        const readButtonText = isRead ? 'Marcar como no leído' : 'Marcar como leído';
        const readButtonIcon = isRead ? 'fa-eye-slash' : 'fa-eye';

        actionRow.innerHTML = `
            <td colspan="6">
                <div class="actions-container">
                    <button class="btn btn-secondary btn-sm" data-action="toggle-read">
                        <i class="fa-solid ${readButtonIcon}"></i> ${readButtonText}
                    </button>
                    <button class="btn btn-secondary btn-sm" data-action="view-text"><i class="fa-solid fa-file-lines"></i> Ver Texto CV</button>
                    <button class="btn btn-primary btn-sm" data-action="view-cv"><i class="fa-solid fa-download"></i> Ver CV Original</button>
                    <button class="btn btn-secondary btn-sm" data-action="edit"><i class="fa-solid fa-pencil"></i> Editar Contacto</button>
                    <button class="btn btn-secondary btn-sm" data-action="notes"><i class="fa-solid fa-note-sticky"></i> Ver/Editar Notas</button>
                    <button class="btn btn-secondary btn-sm" data-action="view-history"><i class="fa-solid fa-clock-rotate-left"></i> Historial</button>
                    <div class="status-buttons">
                        <button class="btn btn-sm ${candidateStatus === 'bueno' ? 'active' : ''}" data-action="set-status" data-status="bueno">Buen candidato</button>
                        <button class="btn btn-sm ${candidateStatus === 'normal' || !candidateStatus ? 'active' : ''}" data-action="set-status" data-status="normal">Normal</button>
                        <button class="btn btn-sm ${candidateStatus === 'prohibido' ? 'active' : ''}" data-action="set-status" data-status="prohibido">Prohibido</button>
                        <button class="btn btn-sm" data-action="set-status" data-status="">Limpiar</button>
                    </div>
                </div>
            </td>
        `;
        row.insertAdjacentElement('afterend', actionRow);

        actionRow.querySelector('[data-action="toggle-read"]').addEventListener('click', (e) => {
            e.stopPropagation();
            updateCandidateReadStatus(row.dataset.id, !isRead);
        });

        actionRow.querySelector('[data-action="view-cv"]')?.addEventListener('click', (e) => { e.stopPropagation(); openCvPdf(row.dataset.id, e.currentTarget); });
        actionRow.querySelector('[data-action="view-text"]')?.addEventListener('click', (e) => { e.stopPropagation(); openTextModal(row.dataset.id); });
        actionRow.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => { e.stopPropagation(); openEditModal(row.dataset.id); });
        actionRow.querySelector('[data-action="notes"]')?.addEventListener('click', (e) => { e.stopPropagation(); openNotesModal(row.dataset.id); });
        actionRow.querySelector('[data-action="view-history"]')?.addEventListener('click', (e) => { e.stopPropagation(); openHistorialModal(row.dataset.id, row.querySelector('.candidate-name')?.textContent?.trim() || 'Candidato'); });
        actionRow.querySelectorAll('[data-action="set-status"]').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const status = e.currentTarget.dataset.status;
                updateCandidateStatus(row.dataset.id, status);
            });
        });
    }
}

async function updateCandidateReadStatus(id, newReadState) {
    const { error } = await supabase
        .from('v2_candidatos')
        .update({ read: newReadState })
        .eq('id', id);

    if (error) {
        alert('Error al actualizar el estado de lectura.');
    } else {
        const row = talentosListBody.querySelector(`tr[data-id='${id}']`);
        if (row) {
            row.classList.toggle('read', newReadState);
            const actionRow = document.getElementById(`actions-${id}`);
            if (actionRow) actionRow.remove();
        }
    }
}

function getEstadoClass(estado) {
    switch (estado) {
        case 'bueno': return 'status-bueno';
        case 'prohibido': return 'status-prohibido';
        default: return 'status-normal'; // contactado, contratado, normal, null → sin color especial
    }
}

async function openHistorialModal(candidateId, nombre) {
    const historialTitle = document.getElementById('historial-modal-title');
    const historialBody = document.getElementById('historial-modal-body');
    if (!historialBody) return;

    if (historialTitle) historialTitle.textContent = `Historial — ${nombre}`;
    historialBody.innerHTML = '<p style="padding:1rem;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando historial...</p>';
    showModal('historial-modal-container');

    const { data: { session } } = await supabase.auth.getSession();
    const isAdmin = session && ADMIN_EMAILS.includes(session.user.email);

    const { data, error } = await supabase
        .from('v2_postulaciones')
        .select('calificacion, estado_postulacion, created_at, v2_avisos(titulo, user_id)')
        .eq('candidato_id', candidateId)
        .order('created_at', { ascending: false });

    // Filtrar los datos en la memoria si no es admin, para que no vea avisos de otros tableros
    const filteredData = (!isAdmin) 
        ? (data || []).filter(p => p.v2_avisos?.user_id === session?.user?.id) 
        : data;

    if (error || !filteredData?.length) {
        historialBody.innerHTML = '<p style="padding:1rem; color:var(--text-light);">No se encontraron postulaciones accesibles para este candidato.</p>';
        return;
    }

    const scoreColor = (s) => s >= 70 ? '#16a34a' : s >= 40 ? '#d97706' : '#dc2626';
    historialBody.innerHTML = `
        <table class="data-table" style="width:100%;">
            <thead>
                <tr>
                    <th>Búsqueda</th>
                    <th style="text-align:center;">Calificación</th>
                    <th>Estado</th>
                    <th>Fecha</th>
                </tr>
            </thead>
            <tbody>
                ${filteredData.map(p => {
                    const s = p.calificacion;
                    const sc = typeof s === 'number' && s >= 0 ? s : null;
                    return `
                        <tr>
                            <td>${p.v2_avisos?.titulo || '<em>N/A</em>'}</td>
                            <td style="text-align:center; font-weight:700; color:${sc !== null ? scoreColor(sc) : 'var(--text-light)'};">${sc !== null ? sc + '/100' : '—'}</td>
                            <td style="font-size:0.8rem;">${p.estado_postulacion || 'sin_revisar'}</td>
                            <td style="font-size:0.78rem; color:var(--text-light); white-space:nowrap;">${p.created_at ? new Date(p.created_at).toLocaleDateString('es-AR') : '—'}</td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

// --- ACCIONES EN LOTE Y MODALES ---
function getSelectedIds() {
    if (isSelectAllMatchingActive) {
        return allMatchingIds;
    }
    return Array.from(talentosListBody.querySelectorAll('.candidate-checkbox:checked')).map(cb => cb.dataset.id);
}

function updateBulkActionsVisibility() {
    const selectedCount = getSelectedIds().length;
    bulkActionsContainer.classList.toggle('hidden', selectedCount === 0);
    
    if (selectionCount) {
        selectionCount.textContent = `${selectedCount} seleccionados`;
    }

    const selectAllContainer = document.getElementById('select-all-matching-container');
    const selectAllPageMessage = document.getElementById('select-all-page-message');
    const selectAllMatchingBtn = document.getElementById('select-all-matching-btn');

    const isPageFullySelected = talentosListBody.querySelectorAll('.candidate-checkbox:checked').length === talentosListBody.querySelectorAll('.candidate-checkbox').length && talentosListBody.querySelectorAll('.candidate-checkbox').length > 0;

    if (selectAllCheckbox.checked && totalCandidates > talentosListBody.children.length) {
        selectAllContainer.classList.remove('hidden');
        if (isSelectAllMatchingActive) {
            selectAllPageMessage.textContent = `Todos los ${allMatchingIds.length} candidatos que coinciden están seleccionados.`;
            selectAllMatchingBtn.classList.add('hidden');
        } else {
            const displayedCount = talentosListBody.querySelectorAll('.candidate-checkbox').length;
            selectAllPageMessage.textContent = `Se han seleccionado los ${displayedCount} candidatos de esta página.`;
            selectAllMatchingBtn.classList.remove('hidden');
        }
    } else {
        selectAllContainer.classList.add('hidden');
        isSelectAllMatchingActive = false;
    }
}

function handleSelectAll(e) {
    isSelectAllMatchingActive = false;
    talentosListBody.querySelectorAll('.candidate-checkbox').forEach(cb => cb.checked = e.target.checked);
    updateBulkActionsVisibility();
}

async function selectAllMatching() {
    let query = supabase.from('v2_candidatos').select('id');

    if (currentFolderId === 'none') query = query.is('carpeta_id', null);
    else if (currentFolderId !== 'all') query = query.eq('carpeta_id', currentFolderId);

    if (currentAvisoId !== 'all') {
        query = query.select('id, v2_postulaciones!inner(aviso_id)').eq('v2_postulaciones.aviso_id', currentAvisoId);
    }

    if (currentSearchTerm) {
        const searchTerm = `%${currentSearchTerm}%`;
        query = query.or(`nombre_candidato.ilike.${searchTerm},email.ilike.${searchTerm},telefono.ilike.${searchTerm}`);
    }
    
    if (currentStatusFilter !== 'all') {
        if (currentStatusFilter === 'sin_estado') {
            query = query.is('estado', null);
        } else {
            query = query.eq('estado', currentStatusFilter);
        }
    }

    if (currentReadFilter !== 'all') {
        const isRead = currentReadFilter === 'leido';
        query = query.eq('read', isRead);
    }

    const { data, error } = await query;

    if (error) {
        alert("Error al seleccionar todos los candidatos.");
        return;
    }

    allMatchingIds = data.map(c => c.id.toString());
    isSelectAllMatchingActive = true;
    updateBulkActionsVisibility();
}

async function handleBulkMove() {
    const ids = getSelectedIds();
    const targetFolderId = moveToFolderSelect.value === 'none' ? null : parseInt(moveToFolderSelect.value, 10);
    if (ids.length === 0 || moveToFolderSelect.value === "") return;

    const { error } = await supabase.from('v2_candidatos').update({ carpeta_id: targetFolderId }).in('id', ids);
    if (error) { 
        alert("Error al mover."); 
    } else { 
        alert("Movidos con éxito."); 
        isSelectAllMatchingActive = false;
        selectAllCheckbox.checked = false;
        await Promise.all([loadCandidates(), loadFolders()]);
    }
}

async function handleBulkDelete() {
    const ids = getSelectedIds();
    if (ids.length === 0) return;
    if (confirm(`¿Eliminar ${ids.length} candidato(s) de forma PERMANENTE?`)) {
        const { error } = await supabase.from('v2_candidatos').delete().in('id', ids);
        if (error) { 
            alert("Error al eliminar."); 
        } else { 
            alert("Eliminados con éxito."); 
            isSelectAllMatchingActive = false;
            selectAllCheckbox.checked = false;
            await Promise.all([loadCandidates(), loadFolders()]);
        }
    }
}

function toggleAddFolderForm(show) { addFolderForm.classList.toggle('hidden', !show); showAddFolderFormBtn.classList.toggle('hidden', show); }

async function createNewFolder() {
    const name = newFolderNameInput.value.trim(); if (!name) return;
    const parentId = parentFolderSelect.value ? parseInt(parentFolderSelect.value, 10) : null;
    const { error } = await supabase.from('v2_carpetas').insert({ nombre: name, parent_id: parentId });
    if (error) { alert("Error al crear la carpeta."); } else { toggleAddFolderForm(false); await loadFolders(); }
}

function populateFolderSelects() {
    const currentParentValue = parentFolderSelect.value;
    const currentMoveToValue = moveToFolderSelect.value;

    parentFolderSelect.innerHTML = '<option value="">Raíz</option>';
    moveToFolderSelect.innerHTML = '<option value="" disabled selected>Mover a...</option><option value="none">— Sin carpeta</option>';

    // Build hierarchy tree
    const byId = new Map(carpetasCache.map(f => [f.id, { ...f, children: [] }]));
    const roots = [];
    carpetasCache.forEach(f => {
        if (f.parent_id && byId.has(f.parent_id)) byId.get(f.parent_id).children.push(byId.get(f.id));
        else roots.push(byId.get(f.id));
    });

    const addOptions = (folders, depth = 0) => {
        const prefix = depth === 0 ? '' : ('　'.repeat(depth - 1) + '└ ');
        folders.forEach(f => {
            const label = prefix + f.nombre;
            const opt = `<option value="${f.id}">${label}</option>`;
            parentFolderSelect.innerHTML += opt;
            moveToFolderSelect.innerHTML += opt;
            if (f.children.length) addOptions(f.children, depth + 1);
        });
    };
    addOptions(roots);

    parentFolderSelect.value = currentParentValue;
    moveToFolderSelect.value = currentMoveToValue;
}

async function openCvPdf(id, buttonElement) {
    const originalHTML = buttonElement.innerHTML;
    buttonElement.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    buttonElement.disabled = true;
    try {
        const { data, error } = await supabase.from('v2_candidatos').select('base64_general, nombre_archivo_general').eq('id', id).single();
        if (error || !data) throw error;
        const link = document.createElement('a');
        link.href = data.base64_general;
        link.download = data.nombre_archivo_general || 'cv.pdf';
        link.click();
    } catch (error) {
        alert('No se pudo cargar el CV.');
    } finally {
        buttonElement.innerHTML = originalHTML;
        buttonElement.disabled = false;
    }
}

async function openTextModal(id) {
    textModalTitle.textContent = 'Cargando...';
    textModalBody.textContent = '';
    showModal('text-modal-container');

    const { data, error } = await supabase
        .from('v2_candidatos')
        .select('nombre_candidato, texto_cv_general')
        .eq('id', id)
        .single();

    if (error || !data) {
        textModalTitle.textContent = 'Error';
        textModalBody.textContent = 'No se pudo cargar el texto del CV.';
        return;
    }
    
    textModalTitle.textContent = `Texto de: ${data.nombre_candidato}`;
    textModalBody.textContent = data.texto_cv_general || 'No hay texto extraído.';
}

async function openEditModal(id) {
    editCandidateIdInput.value = id;
    editForm.reset();
    showModal('edit-modal-container');

    const { data, error } = await supabase
        .from('v2_candidatos')
        .select('nombre_candidato, email, telefono')
        .eq('id', id)
        .single();

    if (error || !data) {
        alert('No se pudo cargar la información del candidato.');
        hideModal('edit-modal-container');
        return;
    }

    editNombreInput.value = data.nombre_candidato || '';
    editEmailInput.value = data.email || '';
    editTelefonoInput.value = data.telefono || '';
}

async function loadAvisos() {
    const { data, error } = await supabase
        .from('v2_avisos')
        .select('id, titulo')
        .order('created_at', { ascending: false });

    if (error) { console.error("Error al cargar avisos:", error); return; }

    avisoFilterSelect.innerHTML = '<option value="all">Filtrar por Aviso</option>';
    data.forEach(aviso => {
        const option = document.createElement('option');
        option.value = aviso.id;
        option.textContent = aviso.titulo;
        avisoFilterSelect.appendChild(option);
    });
}

async function handleEditFormSubmit(e) {
    e.preventDefault();
    const id = editCandidateIdInput.value;
    const updatedData = {
        nombre_candidato: editNombreInput.value,
        email: editEmailInput.value,
        telefono: editTelefonoInput.value,
    };
    const { error } = await supabase.from('v2_candidatos').update(updatedData).eq('id', id);
    if (error) { alert("Error al actualizar."); } else { hideModal('edit-modal-container'); loadCandidates(); }
}

async function openNotesModal(id) {
    notesCandidateIdInput.value = id;
    newNoteTextarea.value = '';
    notesHistoryContainer.innerHTML = '<p>Cargando historial...</p>';
    showModal('notes-modal-container');

    const { data, error } = await supabase
        .from('v2_notas_historial')
        .select('nota, created_at')
        .eq('candidato_id', id)
        .order('created_at', { ascending: false });

    if (error) {
        notesHistoryContainer.innerHTML = '<p style="color: red;">Error al cargar el historial.</p>';
        return;
    }

    if (data.length === 0) {
        notesHistoryContainer.innerHTML = '<p>No hay notas anteriores.</p>';
    } else {
        notesHistoryContainer.innerHTML = data.map(nota => `
            <div class="note-history-item">
                <p>${nota.nota}</p>
                <small>${new Date(nota.created_at).toLocaleString()}</small>
            </div>
        `).join('');
    }
}


async function handleNotesFormSubmit(e) {
    e.preventDefault();
    const id = notesCandidateIdInput.value;
    const newNote = newNoteTextarea.value.trim();

    if (!newNote) return;

    const { error } = await supabase
        .from('v2_notas_historial')
        .insert({ candidato_id: id, nota: newNote });

    if (error) {
        alert("Error al guardar la nota.");
    } else {
        await openNotesModal(id); // Recargar
        const row = talentosListBody.querySelector(`tr[data-id='${id}']`);
        if (row && !row.querySelector('.has-notes-icon')) {
            row.querySelector('.candidate-name-container').insertAdjacentHTML('beforeend', '<i class="fa-solid fa-note-sticky has-notes-icon" title="Tiene notas"></i>');
        }
    }
}

async function exportarCSV() {
    const btn = document.getElementById('export-csv-btn');
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
        // Fetch ALL matching candidates from DB (no pagination)
        let query = supabase
            .from('v2_candidatos')
            .select('nombre_candidato, email, telefono, estado, created_at, v2_carpetas(nombre)')
            .order(currentSort.column, { ascending: currentSort.ascending });

        if (currentFolderId === 'none') query = query.is('carpeta_id', null);
        else if (currentFolderId !== 'all') query = query.eq('carpeta_id', currentFolderId);

        if (currentAvisoId !== 'all') {
            query = query.select('nombre_candidato, email, telefono, estado, created_at, v2_carpetas(nombre), v2_postulaciones!inner(aviso_id)')
                .eq('v2_postulaciones.aviso_id', currentAvisoId);
        }
        if (currentSearchTerm) {
            const t = `%${currentSearchTerm}%`;
            query = query.or(`nombre_candidato.ilike.${t},email.ilike.${t},telefono.ilike.${t}`);
        }
        if (currentStatusFilter !== 'all') {
            currentStatusFilter === 'sin_estado' ? query = query.is('estado', null) : query = query.eq('estado', currentStatusFilter);
        }
        if (currentReadFilter !== 'all') query = query.eq('read', currentReadFilter === 'leido');

        const { data, error } = await query;
        if (error) throw error;

        const wb = new ExcelJS.Workbook();
        wb.creator = 'Selecta CV';
        const ws = wb.addWorksheet('Base de Talentos', { views: [{ state: 'frozen', ySplit: 1 }] });

        ws.columns = [
            { header: 'Nombre Candidato', key: 'nombre',   width: 32 },
            { header: 'Email',            key: 'email',    width: 36 },
            { header: 'Teléfono',         key: 'telefono', width: 18 },
            { header: 'Carpeta',          key: 'carpeta',  width: 22 },
            { header: 'Estado',           key: 'estado',   width: 16 },
            { header: 'Fecha de Carga',   key: 'fecha',    width: 18 },
        ];

        // Header styling
        const headerRow = ws.getRow(1);
        headerRow.height = 28;
        headerRow.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = { bottom: { style: 'medium', color: { argb: 'FF3730A3' } } };
        });

        // Data rows
        data.forEach((c, i) => {
            const row = ws.addRow({
                nombre:   c.nombre_candidato || '',
                email:    c.email || '',
                telefono: c.telefono || '',
                carpeta:  c.v2_carpetas?.nombre || 'Sin Carpeta',
                estado:   c.estado || '',
                fecha:    c.created_at ? new Date(c.created_at).toLocaleDateString('es-AR') : '',
            });
            row.height = 20;
            const bgColor = i % 2 === 0 ? 'FFF5F5FF' : 'FFFFFFFF';
            row.eachCell({ includeEmpty: true }, cell => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
                cell.alignment = { vertical: 'middle' };
                cell.font = { size: 10, name: 'Calibri' };
                cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
            });
            // Color-code estado
            const estadoCell = row.getCell('estado');
            const eColors = { bueno: 'FF15803D', prohibido: 'FFB91C1C', normal: 'FF374151' };
            const ec = eColors[c.estado];
            if (ec) estadoCell.font = { bold: true, color: { argb: ec }, size: 10 };
        });

        ws.autoFilter = { from: 'A1', to: 'F1' };

        const buffer = await wb.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `base_talentos_${new Date().toLocaleDateString('es-AR').replace(/\//g, '-')}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Error al exportar:', err);
        alert('No se pudo exportar el archivo.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

async function updateCandidateStatus(id, estado) {
    const { error } = await supabase
        .from('v2_candidatos')
        .update({ estado: estado || null }) // Enviar null para limpiar
        .eq('id', id);

    if (error) {
        alert('Error al actualizar el estado.');
    } else {
        const row = talentosListBody.querySelector(`tr[data-id='${id}']`);
        if (row) {
            row.dataset.estado = estado || 'normal';
            const nameSpan = row.querySelector('.candidate-name');
            nameSpan.className = `candidate-name ${getEstadoClass(estado)}`;
            
            const actionRow = document.getElementById(`actions-${id}`);
            if(actionRow) actionRow.remove();
        }
    }
}