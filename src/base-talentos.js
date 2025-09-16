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

// src/base-talentos.js

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

// 👇 AÑADE ESTAS DOS LÍNEAS 👇
let currentPage = 1;
let allDataLoaded = false;
// --- INICIALIZACIÓN ---
window.addEventListener('DOMContentLoaded', async () => {
    await Promise.all([
        loadFolders(),
        loadAvisos()
    ]);
    handleFolderClick('all', 'Todos los Candidatos', folderList.querySelector("[data-folder-id='all']"));

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
    document.getElementById('notes-modal-close').addEventListener('click', () => hideModal('notes-modal-container'));
});


// --- LÓGICA DE CARPETAS ---
// src/base-talentos.js

async function loadFolders() {
    const { data, error } = await supabase.from('v2_carpetas').select('*, v2_candidatos(id)').order('nombre');
    if (error) { console.error("Error al cargar carpetas:", error); return; }
    
    // --- CÓDIGO MODIFICADO ---
    // 1. Obtenemos el conteo total real sin límite de filas.
    const { count: totalCount, error: countError } = await supabase
        .from('v2_candidatos')
        .select('*', { count: 'exact', head: true }); // head:true hace que no devuelva filas, solo el conteo

    if(countError) { console.error("Error al contar candidatos:", countError); return; }

    // 2. Obtenemos los candidatos para los contadores de carpetas específicas (esto ya lo hacías bien).
    const { data: allCandidates, error: candidatesError } = await supabase.from('v2_candidatos').select('id, carpeta_id');
    if(candidatesError) { console.error("Error al cargar candidatos para contadores:", candidatesError); return; }

    const counts = allCandidates.reduce((acc, candidato) => {
        const folderId = candidato.carpeta_id === null ? 'none' : candidato.carpeta_id;
        acc[folderId] = (acc[folderId] || 0) + 1;
        return acc;
    }, {});
    
    // 3. Usamos el conteo total real que obtuvimos.
    counts['all'] = totalCount;
    // --- FIN DEL CÓDIGO MODIFICADO ---

    carpetasCache = data;
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
        
        // Hacer que "Sin Carpeta" sea un destino para soltar
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
    e.stopPropagation(); // Evitar que el evento se propague a elementos padres
    const target = e.currentTarget;
    
    if (target.closest('.folder-item')) {
        draggedItemId = target.dataset.folderId;
        e.dataTransfer.setData('text/plain', `folder:${draggedItemId}`);
    } else if (target.closest('tr[data-id]')) {
        const candidateId = target.closest('tr[data-id]').dataset.id;
        const selectedIds = getSelectedIds();
        
        // Si el elemento arrastrado no está seleccionado, arrastrar solo ese.
        // Si está seleccionado, arrastrar todos los seleccionados.
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
        // Lógica para mover carpeta a carpeta
        const draggedFolderId = ids;
        if (draggedFolderId && targetFolderId !== draggedFolderId) {
            const { error } = await supabase.from('v2_carpetas').update({ parent_id: targetFolderId }).eq('id', draggedFolderId);
            if (error) {
                alert('Error al mover la carpeta.');
            } else {
                const draggedFolder = carpetasCache.find(c => c.id == draggedFolderId);
                if (draggedFolder) draggedFolder.parent_id = parseInt(targetFolderId, 10);
                renderFoldersUI();
                populateFolderSelects();
            }
        }
    } else if (type === 'candidate') {
        // Lógica para mover candidato(s) a carpeta
        const candidateIds = ids.split(',');
        const newFolderId = targetFolderId === 'none' ? null : parseInt(targetFolderId, 10);
        
        if (candidateIds.length > 0) {
            const { error } = await supabase.from('v2_candidatos').update({ carpeta_id: newFolderId }).in('id', candidateIds);
            if (error) {
                alert(`Error al mover ${candidateIds.length > 1 ? 'los candidatos' : 'el candidato'}.`);
            } else {
                alert(`${candidateIds.length > 1 ? 'Candidatos movidos' : 'Candidato movido'} con éxito.`);
                loadCandidates(); // Recargar para reflejar el cambio
                loadFolders();
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
        // Primero, desasociar todos los candidatos de esta carpeta
        const { error: updateError } = await supabase
            .from('v2_candidatos')
            .update({ carpeta_id: null })
            .eq('carpeta_id', id);

        if (updateError) {
            alert("Error al quitar candidatos de la carpeta.");
            return;
        }

        // Luego, eliminar la carpeta
        const { error: deleteError } = await supabase
            .from('v2_carpetas')
            .delete()
            .eq('id', id);

        if (deleteError) {
            alert("Error al eliminar la carpeta.");
        } else {
            await loadFolders();
            // Si la carpeta eliminada era la actual, volver a "Todos"
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
    element.classList.add('active');
    loadCandidates();
}

// --- LÓGICA DE CANDIDATOS ---
async function loadCandidates() {
    talentosListBody.innerHTML = `<tr><td colspan="5" style="text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando...</td></tr>`;

    // Construir la consulta base pidiendo el conteo total
    let query = supabase
        .from('v2_candidatos')
        .select(`
            id,
            nombre_candidato,
            email,
            telefono,
            ubicacion,
            nombre_archivo_general,
            estado,
            read,
            v2_carpetas(nombre),
            v2_notas_historial(count)
        `, { count: 'exact' });

    // Aplicar filtro de carpeta
    if (currentFolderId === 'none') {
        query = query.is('carpeta_id', null);
    } else if (currentFolderId !== 'all') {
        query = query.eq('carpeta_id', currentFolderId);
    }

    // Aplicar filtro de aviso si no es 'all'
    if (currentAvisoId !== 'all') {
        const { data: postulaciones, error: postError } = await supabase
            .from('v2_postulaciones')
            .select('candidato_id')
            .eq('aviso_id', currentAvisoId);

        if (postError) {
            console.error("Error al obtener postulaciones para el filtro:", postError);
            talentosListBody.innerHTML = `<tr><td colspan="5" style="text-align: center;">Error al filtrar por aviso.</td></tr>`;
            return;
        }

        const candidateIds = postulaciones.map(p => p.candidato_id).filter(id => id !== null);

        if (candidateIds.length > 0) {
            query = query.in('id', candidateIds);
        } else {
            // Si no hay candidatos para ese aviso, mostrar tabla vacía y salir.
            totalCandidates = 0;
            renderTable([]);
            setupPagination();
            return;
        }
    }

    // Aplicar filtro de búsqueda
    if (currentSearchTerm) {
        const searchTerm = `%${currentSearchTerm}%`;
        const orFilter = `nombre_candidato.ilike.${searchTerm},email.ilike.${searchTerm},telefono.ilike.${searchTerm}`;
        query = query.or(orFilter);
    }

    // Aplicar filtro especial para "No leídos"
    if (isUnreadFilterActive) {
        query = query.like('nombre_candidato', 'Candidato No Identificado%');
    }

    // Aplicar orden después de los filtros
    query = query.order(currentSort.column, { ascending: currentSort.ascending });

    // Ejecutar la consulta una sola vez
    const { data, error, count } = await query;

    if (error) {
        console.error("Error al cargar candidatos:", error);
        talentosListBody.innerHTML = `<tr><td colspan="5" style="text-align: center;">Error al cargar datos.</td></tr>`;
        return;
    }

    totalCandidates = count;
    renderTable(data);
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
        row.dataset.estado = candidato.estado; // Para aplicar estilos

        // Añadimos la clase 'read' si el candidato ha sido leído
        if (candidato.read) {
            row.classList.add('read');
        }

        const estadoClass = getEstadoClass(candidato.estado);

        row.innerHTML = `
            <td><input type="checkbox" class="candidate-checkbox" data-id="${candidato.id}"></td>
            <td>
                <div class="candidate-name-container">
                    <span class="candidate-name ${estadoClass}">${candidato.nombre_candidato || 'No extraído'}</span>
                    ${candidato.v2_notas_historial && candidato.v2_notas_historial.length > 0 && candidato.v2_notas_historial[0].count > 0 ? '<i class="fa-solid fa-note-sticky has-notes-icon" title="Tiene notas"></i>' : ''}
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
        if (e.target.closest('button') || e.target.closest('a')) return;
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
    const isRead = row.classList.contains('read'); // Verificamos si la fila tiene la clase 'read'
    
    // Cierra cualquier otra fila de acciones abierta
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

        // Creamos el botón dinámicamente según el estado 'read'
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
                        <button class="btn btn-sm ${candidateStatus === 'normal' ? 'active' : ''}" data-action="set-status" data-status="normal">Normal</button>
                        <button class="btn btn-sm ${candidateStatus === 'prohibido' ? 'active' : ''}" data-action="set-status" data-status="prohibido">Prohibido</button>
                        <button class="btn btn-sm ${!candidateStatus ? 'active' : ''}" data-action="set-status" data-status="">Limpiar</button>
                    </div>
                </div>
            </td>
        `;
        row.insertAdjacentElement('afterend', actionRow);

        // Event listener para el nuevo botón de lectura
        actionRow.querySelector('[data-action="toggle-read"]').addEventListener('click', (e) => {
            e.stopPropagation();
            updateCandidateReadStatus(row.dataset.id, !isRead);
        });


        async function updateCandidateReadStatus(id, newReadState) {
    const { error } = await supabase
        .from('v2_candidatos')
        .update({ read: newReadState })
        .eq('id', id);

    if (error) {
        alert('Error al actualizar el estado de lectura.');
    } else {
        // Actualiza la UI directamente para una respuesta más rápida
        const row = talentosListBody.querySelector(`tr[data-id='${id}']`);
        if (row) {
            row.classList.toggle('read', newReadState);
            // Cierra la fila de acciones para que se regenere con el texto correcto la próxima vez que se abra
            const actionRow = document.getElementById(`actions-${id}`);
            if (actionRow) {
                actionRow.remove();
            }
        }
    }
}


        // Event listeners para los demás botones de acción
        actionRow.querySelector('[data-action="view-cv"]')?.addEventListener('click', (e) => { e.stopPropagation(); openCvPdf(row.dataset.id, e.currentTarget); });
        actionRow.querySelector('[data-action="view-text"]')?.addEventListener('click', (e) => { e.stopPropagation(); openTextModal(row.dataset.id); });
        actionRow.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => { e.stopPropagation(); openEditModal(row.dataset.id); });
        actionRow.querySelector('[data-action="notes"]')?.addEventListener('click', (e) => { e.stopPropagation(); openNotesModal(row.dataset.id); });
        actionRow.querySelectorAll('[data-action="set-status"]').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const status = e.currentTarget.dataset.status;
                updateCandidateStatus(row.dataset.id, status);
                toggleActionRow(row); // Cierra y vuelve a abrir para reflejar cambios si es necesario
            });
        });
    }
}


function getEstadoClass(estado) {
    switch (estado) {
        case 'bueno': return 'status-bueno';
        case 'prohibido': return 'status-prohibido';
        case 'normal': return 'status-normal';
        default: return '';
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
    const selectedCount = isSelectAllMatchingActive ? allMatchingIds.length : getSelectedIds().length;
    bulkActionsContainer.classList.toggle('hidden', selectedCount === 0);
    
    // Ajuste: Mostrar el texto sin paréntesis
    if (selectionCount) {
        selectionCount.textContent = `${selectedCount} seleccionados`;
    }

    const selectAllContainer = document.getElementById('select-all-matching-container');
    const selectAllPageMessage = document.getElementById('select-all-page-message');

    if (selectAllCheckbox.checked && totalCandidates > 0 /* Reemplaza 'rowsPerPage' si no existe */) {
        selectAllContainer.classList.remove('hidden');
        if (isSelectAllMatchingActive) {
            selectAllPageMessage.textContent = `Todos los ${allMatchingIds.length} candidatos que coinciden están seleccionados.`;
            document.getElementById('select-all-matching-btn').classList.add('hidden');
        } else {
            selectAllPageMessage.textContent = `Se han seleccionado los ${getSelectedIds().length} candidatos de esta página.`;
            document.getElementById('select-all-matching-btn').classList.remove('hidden');
        }
    } else {
        selectAllContainer.classList.add('hidden');
    }
}

function handleSelectAll() {
    isSelectAllMatchingActive = false; // Resetear al cambiar la selección de página
    talentosListBody.querySelectorAll('.candidate-checkbox').forEach(cb => cb.checked = selectAllCheckbox.checked);
    updateBulkActionsVisibility();
}

async function selectAllMatching() {
    // Construir la misma consulta que `loadCandidates` pero solo para obtener IDs
    let query = supabase.from('v2_candidatos').select('id', { count: 'exact' });

    // Re-aplicar todos los filtros activos
    if (currentFolderId === 'none') query = query.is('carpeta_id', null);
    else if (currentFolderId !== 'all') query = query.eq('carpeta_id', currentFolderId);

    if (currentAvisoId !== 'all') {
        const { data: postulaciones, error: postError } = await supabase.from('v2_postulaciones').select('candidato_id').eq('aviso_id', currentAvisoId);
        if (postError) { console.error("Error en filtro de aviso:", postError); return; }
        const candidateIds = postulaciones.map(p => p.candidato_id).filter(id => id !== null);
        if (candidateIds.length > 0) query = query.in('id', candidateIds);
        else query = query.eq('id', -1);
    }

    if (currentSearchTerm) {
        const searchTerm = `%${currentSearchTerm}%`;
        query = query.or(`nombre_candidato.ilike.${searchTerm},email.ilike.${searchTerm},telefono.ilike.${searchTerm}`);
    }

    if (isUnreadFilterActive) {
        query = query.like('nombre_candidato', 'Candidato No Identificado%');
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
    if (error) { alert("Error al mover."); } else { alert("Movidos con éxito."); loadCandidates(); loadFolders();}
}
async function handleBulkDelete() {
    const ids = getSelectedIds();
    if (ids.length === 0) return;
    if (confirm(`¿Eliminar ${ids.length} candidato(s) de forma PERMANENTE?`)) {
        const { error } = await supabase.from('v2_candidatos').delete().in('id', ids);
        if (error) { alert("Error al eliminar."); } else { alert("Eliminados con éxito."); loadCandidates(); }
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
    parentFolderSelect.innerHTML = '<option value="">Raíz</option>';
    moveToFolderSelect.innerHTML = '<option value="" disabled selected>Mover a...</option><option value="none">Quitar de carpeta</option>';
    carpetasCache.forEach(f => {
        const opt = `<option value="${f.id}">${f.nombre}</option>`;
        parentFolderSelect.innerHTML += opt;
        moveToFolderSelect.innerHTML += opt;
    });
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
    // 1. Mostrar el modal inmediatamente con contenido vacío
    textModalTitle.textContent = '';
    textModalBody.textContent = '';
    showModal('text-modal-container');

    // 2. Obtener los datos de forma asíncrona
    const { data, error } = await supabase
        .from('v2_candidatos')
        .select('nombre_candidato, texto_cv_general')
        .eq('id', id)
        .single();

    // 3. Actualizar el contenido del modal cuando los datos estén listos
    if (error || !data) {
        textModalTitle.textContent = 'Error';
        textModalBody.textContent = 'No se pudo cargar el texto del CV.';
        console.error('Error fetching text modal data:', error);
        return;
    }
    
    textModalTitle.textContent = `Texto de: ${data.nombre_candidato}`;
    textModalBody.textContent = data.texto_cv_general || 'No hay texto extraído.';
}

async function openEditModal(id) {
    // 1. Mostrar el modal inmediatamente con el formulario vacío
    editCandidateIdInput.value = id;
    editNombreInput.value = '';
    editEmailInput.value = '';
    editTelefonoInput.value = '';
    showModal('edit-modal-container');

    // 2. Obtener los datos de forma asíncrona
    const { data, error } = await supabase
        .from('v2_candidatos')
        .select('nombre_candidato, email, telefono')
        .eq('id', id)
        .single();

    // 3. Rellenar el formulario cuando los datos estén listos
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

    if (error) {
        console.error("Error al cargar avisos:", error);
        return;
    }

    avisoFilterSelect.innerHTML = '<option value="all">Todos los Avisos</option>';
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
            <div class="note-history-item" style="border-bottom: 1px solid #eee; padding-bottom: 0.5rem; margin-bottom: 0.5rem;">
                <p style="white-space: pre-wrap; margin: 0;">${nota.nota}</p>
                <small style="color: #888;">${new Date(nota.created_at).toLocaleString()}</small>
            </div>
        `).join('');
    }
}

async function handleNotesFormSubmit(e) {
    e.preventDefault();
    const id = notesCandidateIdInput.value;
    const newNote = newNoteTextarea.value.trim();

    if (!newNote) {
        alert('La nota no puede estar vacía.');
        return;
    }

    const { error } = await supabase
        .from('v2_notas_historial')
        .insert({ candidato_id: id, nota: newNote });

    if (error) {
        alert("Error al guardar la nota.");
    } else {
        newNoteTextarea.value = '';
        openNotesModal(id); // Recargar el historial
        
        // Asegurarse de que el ícono de nota esté visible en la tabla
        const row = talentosListBody.querySelector(`tr[data-id='${id}']`);
        if (row && !row.querySelector('.has-notes-icon')) {
            const nameContainer = row.querySelector('.candidate-name-container');
            nameContainer.insertAdjacentHTML('beforeend', '<i class="fa-solid fa-note-sticky has-notes-icon" title="Tiene notas"></i>');
        }
    }
}

async function updateCandidateStatus(id, estado) {
    const { error } = await supabase
        .from('v2_candidatos')
        .update({ estado: estado })
        .eq('id', id);

    if (error) {
        alert('Error al actualizar el estado.');
    } else {
        // Actualizar la UI directamente para una respuesta más rápida
        const row = talentosListBody.querySelector(`tr[data-id='${id}']`);
        if (row) {
            row.dataset.estado = estado;
            const nameSpan = row.querySelector('.candidate-name');
            nameSpan.className = `candidate-name ${getEstadoClass(estado)}`;
        }
    }
}
