// src/base-talentos.js

import { supabase } from './supabaseClient.js';
import { showModal, hideModal } from './utils.js';

// --- SELECTORES DEL DOM ---
const folderList = document.getElementById('folder-list');
const folderTitle = document.getElementById('folder-title');
const talentosListBody = document.getElementById('talentos-list-body');
const filtroInput = document.getElementById('filtro-candidatos');
const selectAllCheckbox = document.getElementById('select-all-checkbox');
const sortSelect = document.getElementById('sort-select');
const avisoFilterSelect = document.getElementById('aviso-filter-select');


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
let isUnreadFilterActive = false;
let currentAvisoId = 'all';
let allMatchingIds = [];
let isSelectAllMatchingActive = false;

let currentPage = 1;
let allDataLoaded = false;

// --- INICIALIZACIÓN ---
window.addEventListener('DOMContentLoaded', async () => {
    await Promise.all([
        loadFolders(),
        loadAvisos()
    ]);
    const allCandidatesElement = folderList.querySelector("[data-folder-id='all']");
    if (allCandidatesElement) {
        handleFolderClick('all', 'Todos los Candidatos', allCandidatesElement);
    }


    let searchTimeout;
    filtroInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentPage = 1;
            currentSearchTerm = filtroInput.value;
            allDataLoaded = false;
            talentosListBody.innerHTML = '';
            loadCandidates();
        }, 500);
    });

    sortSelect.addEventListener('change', () => {
        const value = sortSelect.value;
        if (value === 'unread') {
            isUnreadFilterActive = true;
        } else {
            isUnreadFilterActive = false;
            const [column, order] = value.split('-');
            currentSort = { column, ascending: order === 'asc' };
        }
        currentPage = 1;
        allDataLoaded = false;
        talentosListBody.innerHTML = '';
        loadCandidates();
    });

    avisoFilterSelect.addEventListener('change', () => {
        currentAvisoId = avisoFilterSelect.value;
        currentPage = 1;
        allDataLoaded = false;
        talentosListBody.innerHTML = '';
        loadCandidates();
    });
    selectAllCheckbox.addEventListener('change', handleSelectAll);
    bulkMoveBtn.addEventListener('click', handleBulkMove);
    bulkDeleteBtn.addEventListener('click', handleBulkDelete);
    showAddFolderFormBtn.addEventListener('click', () => toggleAddFolderForm(true));
    cancelAddFolderBtn.addEventListener('click', () => toggleAddFolderForm(false));
    addFolderBtn.addEventListener('click', createNewFolder);
    editForm.addEventListener('submit', handleEditFormSubmit);
    notesForm.addEventListener('submit', handleNotesFormSubmit);

    document.getElementById('select-all-matching-btn').addEventListener('click', selectAllMatching);

    // Cerrar modales
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
        // Si la función RPC falla, volvemos al método lento como respaldo
        await loadFoldersLegacy();
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
    folderList.innerHTML = ''; // Limpiar la lista existente

    // --- Renderizar carpetas estáticas ---
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

    // --- Renderizar carpetas dinámicas jerárquicamente ---
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
    currentSearchTerm = '';
    filtroInput.value = '';
    folderTitle.textContent = name;
    folderList.querySelectorAll('.folder-item.active').forEach(el => el.classList.remove('active'));
    if (element) {
        element.classList.add('active');
    }
    
    currentPage = 1;
    allDataLoaded = false;
    talentosListBody.innerHTML = '';
    loadCandidates();
}


// --- LÓGICA DE CANDIDATOS ---
async function loadCandidates() {
    talentosListBody.innerHTML = `<tr><td colspan="5" style="text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando...</td></tr>`;

    let query = supabase
        .from('v2_candidatos')
        .select(`
            id, nombre_candidato, email, telefono, ubicacion, nombre_archivo_general, estado, read,
            v2_carpetas(nombre),
            v2_notas_historial(count)
        `, { count: 'exact' });

    // Aplicar filtro de carpeta
    if (currentFolderId === 'none') {
        query = query.is('carpeta_id', null);
    } else if (currentFolderId !== 'all') {
        query = query.eq('carpeta_id', currentFolderId);
    }

    if (currentAvisoId !== 'all') {
        query = query.select(`
            id, nombre_candidato, email, telefono, ubicacion, nombre_archivo_general, estado, read,
            v2_carpetas(nombre),
            v2_notas_historial(count),
            v2_postulaciones!inner(aviso_id)
        `).eq('v2_postulaciones.aviso_id', currentAvisoId);
    }

    // Aplicar filtro de búsqueda
    if (currentSearchTerm) {
        const searchTerm = `%${currentSearchTerm}%`;
        const orFilter = `nombre_candidato.ilike.${searchTerm},email.ilike.${searchTerm},telefono.ilike.${searchTerm}`;
        query = query.or(orFilter);
    }

    // Aplicar filtro especial para "No leídos"
    if (isUnreadFilterActive) {
        query = query.is('read', false);
    }

    // Aplicar orden
    query = query.order(currentSort.column, { ascending: currentSort.ascending });

    // Limitar los resultados a 500
    query = query.limit(500);

    const { data, error, count } = await query;

    if (error) {
        console.error("Error al cargar candidatos:", error);
        talentosListBody.innerHTML = `<tr><td colspan="5" style="text-align: center;">Error al cargar datos.</td></tr>`;
        return;
    }

    totalCandidates = count;
    renderTable(data);
    updateBulkActionsVisibility();
}


// --- RENDERIZADO Y UI ---
function renderTable(candidatos) {
    talentosListBody.innerHTML = '';

    if (!candidatos || candidatos.length === 0) {
        talentosListBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No se encontraron candidatos.</td></tr>';
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

        row.innerHTML = `
            <td><input type="checkbox" class="candidate-checkbox" data-id="${candidato.id}"></td>
            <td>
                <div class="candidate-name-container">
                    <span class="candidate-name ${estadoClass}">${candidato.nombre_candidato || 'No extraído'}</span>
                    ${tieneNotas ? '<i class="fa-solid fa-note-sticky has-notes-icon" title="Tiene notas"></i>' : ''}
                </div>
                <div class="candidate-filename">${candidato.nombre_archivo_general || 'No Identificado'}</div>
            </td>
            <td>${candidato.v2_carpetas?.nombre || '<em>Sin Carpeta</em>'}</td>
            <td>
                <div style="white-space: normal;">${candidato.email || ''}</div>
                <div class="text-light">${candidato.telefono || ''}</div>
            </td>
            <td class="actions-cell" style="text-align: center;">
                <button class="btn btn-secondary btn-sm" data-action="toggle-actions">
                    <i class="fa-solid fa-ellipsis-vertical"></i>
                </button>
            </td>
        `;
        addTableRowListeners(row);
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
            <td colspan="5">
                <div class="actions-container">
                    <button class="btn btn-secondary btn-sm" data-action="toggle-read">
                        <i class="fa-solid ${readButtonIcon}"></i> ${readButtonText}
                    </button>
                    <button class="btn btn-secondary btn-sm" data-action="view-text"><i class="fa-solid fa-file-lines"></i> Ver Texto CV</button>
                    <button class="btn btn-primary btn-sm" data-action="view-cv"><i class="fa-solid fa-download"></i> Ver CV Original</button>
                    <button class="btn btn-secondary btn-sm" data-action="edit"><i class="fa-solid fa-pencil"></i> Editar Contacto</button>
                    <button class="btn btn-secondary btn-sm" data-action="notes"><i class="fa-solid fa-note-sticky"></i> Ver/Editar Notas</button>
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
        default: return 'status-normal';
    }
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

    if (isUnreadFilterActive) {
        query = query.is('read', false);
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
    moveToFolderSelect.innerHTML = '<option value="" disabled selected>Mover a...</option><option value="none">Quitar de carpeta</option>';
    
    carpetasCache.forEach(f => {
        const opt = `<option value="${f.id}">${f.nombre}</option>`;
        parentFolderSelect.innerHTML += opt;
        moveToFolderSelect.innerHTML += opt;
    });

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