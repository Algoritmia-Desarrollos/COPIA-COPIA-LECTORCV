// src/base-talentos.js

import { supabase } from './supabaseClient.js';

// --- SELECTORES DEL DOM ---
const folderList = document.getElementById('folder-list');
const folderTitle = document.getElementById('folder-title');
const talentosListBody = document.getElementById('talentos-list-body');
const filtroInput = document.getElementById('filtro-candidatos');
const selectAllCheckbox = document.getElementById('select-all-checkbox');

// Paginación
const tablePagination = document.getElementById('table-pagination');
const tablePageIndicator = document.getElementById('table-page-indicator');
const tablePrevPageBtn = document.getElementById('table-prev-page-btn');
const tableNextPageBtn = document.getElementById('table-next-page-btn');

// Acciones en Lote
const bulkActionsContainer = document.getElementById('bulk-actions-container');
const moveToFolderSelect = document.getElementById('move-to-folder-select');
const bulkMoveBtn = document.getElementById('bulk-move-btn');
const bulkDeleteBtn = document.getElementById('bulk-delete-btn');

// Formulario de Carpetas
const showAddFolderFormBtn = document.getElementById('show-add-folder-form-btn');
const addFolderForm = document.getElementById('add-folder-form');
const addFolderBtn = document.getElementById('add-folder-btn');
const cancelAddFolderBtn = document.getElementById('cancel-add-folder-btn');
const newFolderNameInput = document.getElementById('new-folder-name');
const parentFolderSelect = document.getElementById('parent-folder-select');

// Modales
const editModalContainer = document.getElementById('edit-modal-container');
const editModalCloseBtn = document.getElementById('edit-modal-close');
const editForm = document.getElementById('edit-form');
const editCandidateIdInput = document.getElementById('edit-candidate-id');
const editNombreInput = document.getElementById('edit-nombre');
const editEmailInput = document.getElementById('edit-email');
const editTelefonoInput = document.getElementById('edit-telefono');
const textModalContainer = document.getElementById('text-modal-container');
const textModalTitle = document.getElementById('text-modal-title');
const textModalBody = document.getElementById('text-modal-body');
const textModalCloseBtn = document.getElementById('text-modal-close');

// --- ESTADO GLOBAL ---
let carpetasCache = [];
let currentFolderId = 'all';
let currentPage = 1;
const rowsPerPage = 50;
let totalCandidates = 0;
let currentSearchTerm = '';

// --- INICIALIZACIÓN ---
window.addEventListener('DOMContentLoaded', async () => {
    await loadFolders();
    handleFolderClick('all', 'Todos los Candidatos', folderList.querySelector("[data-folder-id='all']"));

    let searchTimeout;
    filtroInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentPage = 1;
            currentSearchTerm = filtroInput.value;
            loadCandidates();
        }, 500);
    });

    tablePrevPageBtn.addEventListener('click', () => changePage(-1));
    tableNextPageBtn.addEventListener('click', () => changePage(1));
    selectAllCheckbox.addEventListener('change', handleSelectAll);
    bulkMoveBtn.addEventListener('click', handleBulkMove);
    bulkDeleteBtn.addEventListener('click', handleBulkDelete);
    showAddFolderFormBtn.addEventListener('click', () => toggleAddFolderForm(true));
    cancelAddFolderBtn.addEventListener('click', () => toggleAddFolderForm(false));
    addFolderBtn.addEventListener('click', createNewFolder);
    editModalCloseBtn.addEventListener('click', closeEditModal);
    editModalContainer.addEventListener('click', (e) => e.target === editModalContainer && closeEditModal());
    editForm.addEventListener('submit', handleEditFormSubmit);
    textModalCloseBtn.addEventListener('click', closeTextModal);
    textModalContainer.addEventListener('click', (e) => e.target === textModalContainer && closeTextModal());
});


// --- LÓGICA DE CARPETAS ---
async function loadFolders() {
    const { data, error } = await supabase.from('v2_carpetas').select('*').order('nombre');
    if (error) { console.error("Error al cargar carpetas:", error); return; }
    carpetasCache = data;
    renderFoldersUI();
    populateFolderSelects();
}

function renderFoldersUI() {
    folderList.innerHTML = ''; // Limpiar la lista existente

    // --- Renderizar carpetas estáticas ---
    ['Todos los Candidatos', 'Sin Carpeta'].forEach(name => {
        const id = name === 'Todos los Candidatos' ? 'all' : 'none';
        const icon = id === 'all' ? 'fa-inbox' : 'fa-folder-open';
        const li = document.createElement('li');
        li.innerHTML = `<div class="folder-item" data-folder-id="${id}"><i class="fa-solid ${icon}"></i> <span class="folder-name">${name}</span></div>`;
        li.querySelector('.folder-item').addEventListener('click', (e) => handleFolderClick(id, name, e.currentTarget));
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
            li.innerHTML = `
                <div class="folder-item ${isSublevel ? 'is-subfolder' : ''}" data-folder-id="${folder.id}" draggable="true">
                    <span class="folder-toggle">${hasChildren ? '<i class="fa-solid fa-chevron-right"></i>' : ''}</span>
                    <i class="fa-solid fa-folder"></i> 
                    <span class="folder-name">${folder.nombre}</span>
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
    currentPage = 1;
    currentSearchTerm = '';
    filtroInput.value = '';
    folderTitle.textContent = name;
    folderList.querySelectorAll('.folder-item.active').forEach(el => el.classList.remove('active'));
    element.classList.add('active');
    loadCandidates();
}

// --- LÓGICA DE CANDIDATOS CON PAGINACIÓN Y BÚSQUEDA CORREGIDA ---
async function loadCandidates() {
    talentosListBody.innerHTML = `<tr><td colspan="5" style="text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando...</td></tr>`;

    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage - 1;

    // Construir la consulta base pidiendo el conteo total
    let query = supabase
        .from('v2_candidatos')
        .select(`
            id, 
            nombre_candidato, 
            email, 
            telefono, 
            nombre_archivo_general, 
            v2_carpetas(nombre)
        `, { count: 'exact' });

    // Aplicar filtro de carpeta
    if (currentFolderId === 'none') {
        query = query.is('carpeta_id', null);
    } else if (currentFolderId !== 'all') {
        query = query.eq('carpeta_id', currentFolderId);
    }

    // Aplicar filtro de búsqueda
    if (currentSearchTerm) {
        const searchTerm = `%${currentSearchTerm}%`;
        const orFilter = `nombre_candidato.ilike.${searchTerm},email.ilike.${searchTerm},telefono.ilike.${searchTerm}`;
        query = query.or(orFilter);
    }

    // Aplicar paginación y orden después de los filtros
    query = query.range(startIndex, endIndex).order('updated_at', { ascending: false });

    // Ejecutar la consulta una sola vez
    const { data, error, count } = await query;

    if (error) {
        console.error("Error al cargar candidatos:", error);
        talentosListBody.innerHTML = `<tr><td colspan="5" style="text-align: center;">Error al cargar datos.</td></tr>`;
        return;
    }

    totalCandidates = count;
    renderTable(data);
    setupPagination();
}

function changePage(direction) {
    const totalPages = Math.ceil(totalCandidates / rowsPerPage);
    const newPage = currentPage + direction;
    if (newPage > 0 && newPage <= totalPages) {
        currentPage = newPage;
        loadCandidates();
    }
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
        
        row.innerHTML = `
            <td><input type="checkbox" class="candidate-checkbox" data-id="${candidato.id}"></td>
            <td>
                <div class="candidate-name">${candidato.nombre_candidato || 'No extraído'}</div>
                <div class="candidate-filename">${candidato.nombre_archivo_general || 'No Identificado'}</div>
            </td>
            <td>${candidato.v2_carpetas?.nombre || '<em>Sin Carpeta</em>'}</td>
            <td>
                <div style="white-space: normal;">${candidato.email || ''}</div>
                <div class="text-light">${candidato.telefono || ''}</div>
            </td>
            <td class="actions-group" style="text-align: right;">
                <button class="btn btn-secondary btn-sm" data-action="view-text" title="Ver Texto del CV"><i class="fa-solid fa-file-lines"></i></button>
                <button class="btn btn-primary btn-sm" data-action="view-cv" title="Ver CV Original"><i class="fa-solid fa-download"></i></button>
                <button class="btn btn-secondary btn-sm" data-action="edit" title="Editar Contacto"><i class="fa-solid fa-pencil"></i></button>
            </td>
        `;
        addTableRowListeners(row);
        talentosListBody.appendChild(row);
    });
}

function setupPagination() {
    const totalPages = Math.ceil(totalCandidates / rowsPerPage);
    tablePagination.classList.toggle('hidden', totalPages <= 1);
    tablePageIndicator.textContent = `Página ${currentPage} de ${totalPages}`;
    tablePrevPageBtn.disabled = currentPage === 1;
    tableNextPageBtn.disabled = currentPage >= totalPages;
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
    row.querySelector('[data-action="view-cv"]')?.addEventListener('click', (e) => { e.stopPropagation(); openCvPdf(row.dataset.id, e.currentTarget); });
    row.querySelector('[data-action="view-text"]')?.addEventListener('click', (e) => { e.stopPropagation(); openTextModal(row.dataset.id); });
    row.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => { e.stopPropagation(); openEditModal(row.dataset.id); });
}

// --- ACCIONES EN LOTE Y MODALES ---
function getSelectedIds() { return Array.from(talentosListBody.querySelectorAll('.candidate-checkbox:checked')).map(cb => cb.dataset.id); }
function updateBulkActionsVisibility() { bulkActionsContainer.classList.toggle('hidden', getSelectedIds().length === 0); }
function handleSelectAll() {
    talentosListBody.querySelectorAll('.candidate-checkbox').forEach(cb => cb.checked = selectAllCheckbox.checked);
    updateBulkActionsVisibility();
}
async function handleBulkMove() {
    const ids = getSelectedIds();
    const targetFolderId = moveToFolderSelect.value === 'none' ? null : parseInt(moveToFolderSelect.value, 10);
    if (ids.length === 0 || moveToFolderSelect.value === "") return;
    const { error } = await supabase.from('v2_candidatos').update({ carpeta_id: targetFolderId }).in('id', ids);
    if (error) { alert("Error al mover."); } else { alert("Movidos con éxito."); loadCandidates(); }
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
    const { data, error } = await supabase.from('v2_candidatos').select('nombre_candidato, texto_cv_general').eq('id', id).single();
    if (error || !data) { alert('No se pudo cargar el texto del CV.'); return; }
    textModalTitle.textContent = `Texto de: ${data.nombre_candidato}`;
    textModalBody.textContent = data.texto_cv_general || 'No hay texto extraído.';
    textModalContainer.classList.remove('hidden');
}
function closeTextModal() { textModalContainer.classList.add('hidden'); }
async function openEditModal(id) {
    const { data, error } = await supabase.from('v2_candidatos').select('id, nombre_candidato, email, telefono').eq('id', id).single();
    if (error || !data) { alert('No se pudo cargar el candidato.'); return; }
    editCandidateIdInput.value = data.id;
    editNombreInput.value = data.nombre_candidato || '';
    editEmailInput.value = data.email || '';
    editTelefonoInput.value = data.telefono || '';
    editModalContainer.classList.remove('hidden');
}
function closeEditModal() { editModalContainer.classList.add('hidden'); }
async function handleEditFormSubmit(e) {
    e.preventDefault();
    const id = editCandidateIdInput.value;
    const updatedData = {
        nombre_candidato: editNombreInput.value,
        email: editEmailInput.value,
        telefono: editTelefonoInput.value,
    };
    const { error } = await supabase.from('v2_candidatos').update(updatedData).eq('id', id);
    if (error) { alert("Error al actualizar."); } else { closeEditModal(); loadCandidates(); }
}
