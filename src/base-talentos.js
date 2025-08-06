// src/base-talentos.js

import { supabase } from './supabaseClient.js';

// --- SELECTORES (Sin cambios) ---
const folderList = document.getElementById('folder-list');
const folderTitle = document.getElementById('folder-title');
const talentosListBody = document.getElementById('talentos-list-body');
const filtroInput = document.getElementById('filtro-candidatos');
const selectAllCheckbox = document.getElementById('select-all-checkbox');
const bulkActionsContainer = document.getElementById('bulk-actions-container');
const moveToFolderSelect = document.getElementById('move-to-folder-select');
const bulkMoveBtn = document.getElementById('bulk-move-btn');
const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
const showAddFolderFormBtn = document.getElementById('show-add-folder-form-btn');
const addFolderForm = document.getElementById('add-folder-form');
const addFolderBtn = document.getElementById('add-folder-btn');
const cancelAddFolderBtn = document.getElementById('cancel-add-folder-btn');
const newFolderNameInput = document.getElementById('new-folder-name');
const parentFolderSelect = document.getElementById('parent-folder-select');
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

// --- ESTADO GLOBAL (Sin cambios) ---
let candidatosCache = [];
let carpetasCache = [];
let currentFolderId = 'all';

// --- INICIALIZACIÓN (Sin cambios) ---
window.addEventListener('DOMContentLoaded', async () => {
    await loadFolders();
    handleFolderClick('all', 'Todos los Candidatos', folderList.querySelector("[data-folder-id='all']"));
    filtroInput.addEventListener('input', renderTable);
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


// --- LÓGICA DE CARPETAS (Sin cambios) ---
async function loadFolders() {
    const { data, error } = await supabase.from('v2_carpetas').select('*').order('nombre');
    if (error) { console.error("Error al cargar carpetas:", error); return; }
    carpetasCache = data;
    renderFoldersUI();
    populateFolderSelects();
}

function renderFoldersUI() {
    folderList.innerHTML = '';
    ['Todos los Candidatos', 'Sin Carpeta'].forEach(name => {
        const id = name === 'Todos los Candidatos' ? 'all' : 'none';
        const icon = id === 'all' ? 'fa-inbox' : 'fa-folder-open';
        const li = document.createElement('li');
        li.innerHTML = `<div class="folder-item" data-folder-id="${id}"><i class="fa-solid ${icon}"></i> <span class="folder-name">${name}</span></div>`;
        addDropTarget(li.querySelector('.folder-item'));
        folderList.appendChild(li);
    });

    const folderMap = new Map(carpetasCache.map(f => [f.id, { ...f, children: [] }]));
    const rootFolders = [];

    for (const folder of folderMap.values()) {
        if (folder.parent_id && folderMap.has(folder.parent_id)) {
            folderMap.get(folder.parent_id).children.push(folder);
        } else {
            rootFolders.push(folder);
        }
    }

    const createFolderElement = (folder, level = 0) => {
        const li = document.createElement('li');
        li.draggable = true;
        li.innerHTML = `
            <div class="folder-item" data-folder-id="${folder.id}" style="padding-left: ${1 + level * 1.5}rem;">
                <i class="fa-solid fa-folder"></i>
                <span class="folder-name">${folder.nombre}</span>
                <div class="folder-item-actions">
                    <button class="btn-icon" data-action="edit-folder" title="Editar Carpeta"><i class="fa-solid fa-pencil"></i></button>
                    <button class="btn-icon" data-action="delete-folder" title="Eliminar Carpeta"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `;
        addDropTarget(li.querySelector('.folder-item'));

        if (folder.children.length > 0) {
            const ul = document.createElement('ul');
            folder.children.forEach(child => ul.appendChild(createFolderElement(child, level + 1)));
            li.appendChild(ul);
        }
        return li;
    };

    rootFolders.forEach(folder => folderList.appendChild(createFolderElement(folder)));
    folderList.querySelectorAll('li').forEach(li => {
        li.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            e.dataTransfer.setData('text/plain', li.querySelector('.folder-item').dataset.folderId);
            e.dataTransfer.effectAllowed = 'move';
        });
    });
    folderList.querySelectorAll('.folder-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            const id = e.currentTarget.dataset.folderId;
            const name = e.currentTarget.querySelector('.folder-name').textContent;
            handleFolderClick(id, name, e.currentTarget);
        });

        const editBtn = item.querySelector('[data-action="edit-folder"]');
        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const folderId = item.dataset.folderId;
                handleEditFolder(folderId);
            });
        }

        const deleteBtn = item.querySelector('[data-action="delete-folder"]');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const folderId = item.dataset.folderId;
                handleDeleteFolder(folderId);
            });
        }
    });
}

function handleFolderClick(id, name, element) {
    currentFolderId = id;
    folderTitle.textContent = name;
    folderList.querySelectorAll('.folder-item.active').forEach(el => el.classList.remove('active'));
    element.classList.add('active');
    loadCandidates();
}

async function handleEditFolder(folderId) {
    const folder = carpetasCache.find(f => f.id == folderId);
    if (!folder) return;

    const newName = prompt('Nuevo nombre de la carpeta:', folder.nombre);
    if (newName && newName.trim() !== '') {
        const { error } = await supabase
            .from('v2_carpetas')
            .update({ nombre: newName.trim() })
            .eq('id', folderId);

        if (error) {
            alert('Error al actualizar la carpeta.');
            console.error('Error updating folder:', error);
        } else {
            alert('Carpeta actualizada con éxito.');
            await loadFolders();
        }
    }
}

async function handleDeleteFolder(folderId) {
    const folder = carpetasCache.find(f => f.id == folderId);
    if (!folder) return;

    if (confirm(`¿Eliminar la carpeta "${folder.nombre}"? Los candidatos dentro no serán eliminados.`)) {
        const { error } = await supabase
            .from('v2_carpetas')
            .delete()
            .eq('id', folderId);

        if (error) {
            alert('Error al eliminar la carpeta.');
            console.error('Error deleting folder:', error);
        } else {
            alert('Carpeta eliminada con éxito.');
            await loadFolders();
        }
    }
}


// --- LÓGICA DE CANDIDATOS (ACTUALIZADA) ---
async function loadCandidates() {
    talentosListBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Cargando...</td></tr>';
    
    // ===== CAMBIO: Seleccionamos explícitamente las columnas para no traer el base64 de todos =====
    let query = supabase.from('v2_candidatos').select(`
        id, nombre_candidato, email, telefono, nombre_archivo_general, carpeta_id,
        v2_carpetas (nombre)
    `);

    if (currentFolderId === 'none') {
        query = query.is('carpeta_id', null);
    } else if (currentFolderId !== 'all') {
        query = query.eq('carpeta_id', currentFolderId);
    }
    
    const { data, error } = await query.order('updated_at', { ascending: false });
    if (error) { console.error("Error al cargar candidatos:", error); return; }
    
    candidatosCache = data;
    renderTable();
}

// --- RENDERIZADO DE TABLA Y ACCIONES (Sin cambios) ---
function renderTable() {
    const filtro = filtroInput.value.toLowerCase();
    const candidatosFiltrados = candidatosCache.filter(c => 
        (c.nombre_candidato || '').toLowerCase().includes(filtro) ||
        (c.email || '').toLowerCase().includes(filtro)
    );

    talentosListBody.innerHTML = '';
    if (candidatosFiltrados.length === 0) {
        talentosListBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No se encontraron candidatos.</td></tr>';
        return;
    }

    candidatosFiltrados.forEach(candidato => {
        const row = document.createElement('tr');
        row.dataset.id = candidato.id;
        row.draggable = true;

        // Simplificamos la estructura para evitar problemas de layout
        row.innerHTML = `
            <td><input type="checkbox" class="candidate-checkbox" data-id="${candidato.id}"></td>
            <td>
                <div class="candidate-name">${candidato.nombre_candidato || 'No extraído'}</div>
                <div class="candidate-file">${candidato.nombre_archivo_general || ''}</div>
            </td>
            <td>${candidato.v2_carpetas?.nombre || '<em>Sin Carpeta</em>'}</td>
            <td>
                <div>${candidato.email || ''}</div>
                <div class="text-light">${candidato.telefono || ''}</div>
            </td>
            <td class="actions-group">
                <button class="btn btn-secondary btn-sm" data-action="view-text" title="Ver Texto del CV">Ver Texto</button>
                <button class="btn btn-primary btn-sm" data-action="view-cv" title="Ver CV Original (PDF)">Ver CV</button>
                <button class="btn btn-danger btn-sm" data-action="delete" title="Eliminar Candidato"><i class="fa-solid fa-trash"></i></button>
                <button class="btn btn-secondary btn-sm" data-action="edit" title="Editar Contacto"><i class="fa-solid fa-pencil"></i></button>
            </td>
        `;
        addTableRowListeners(row);
        talentosListBody.appendChild(row);
    });
}

function addTableRowListeners(row) {
    row.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        const checkbox = row.querySelector('.candidate-checkbox');
        checkbox.checked = !checkbox.checked;
        const changeEvent = new Event('change');
        checkbox.dispatchEvent(changeEvent);
    });

    row.querySelector('.candidate-checkbox').addEventListener('change', updateBulkActionsVisibility);

    row.addEventListener('dragstart', (e) => {
        const selectedIds = getSelectedIds();
        const draggedIds = selectedIds.length > 0 && selectedIds.includes(row.dataset.id) ? selectedIds : [row.dataset.id];
        e.dataTransfer.setData('application/json', JSON.stringify(draggedIds));
        draggedIds.forEach(id => document.querySelector(`tr[data-id='${id}']`).classList.add('dragging'));
    });

    row.addEventListener('dragend', () => {
        document.querySelectorAll('tr.dragging').forEach(r => r.classList.remove('dragging'));
    });

    // ===== CAMBIO: Pasamos el botón al listener para mostrar estado de carga =====
    const viewCvBtn = row.querySelector('[data-action="view-cv"]');
    viewCvBtn.addEventListener('click', () => openCvPdf(row.dataset.id, viewCvBtn));

    row.querySelector('[data-action="view-text"]').addEventListener('click', () => openTextModal(row.dataset.id));
    row.querySelector('[data-action="edit"]').addEventListener('click', () => openEditModal(row.dataset.id));
    row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteCandidate(row.dataset.id));
}

// --- ACCIONES EN LOTE Y FORMULARIOS (Sin cambios) ---
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
    await moveCandidates(ids, targetFolderId);
}
async function handleBulkDelete() {
    const ids = getSelectedIds();
    if (ids.length === 0) return;
    if (confirm(`¿Eliminar ${ids.length} candidato(s) de forma PERMANENTE? Se conservará el historial de sus postulaciones.`)) {
        const { error } = await supabase.from('v2_candidatos').delete().in('id', ids);
        if (error) alert("Error al eliminar."); else { alert("Eliminados con éxito."); loadCandidates(); }
    }
}
function toggleAddFolderForm(show) { addFolderForm.classList.toggle('hidden', !show); showAddFolderFormBtn.classList.toggle('hidden', show); }
async function createNewFolder() {
    const name = newFolderNameInput.value.trim(); if (!name) return;
    const parentId = parentFolderSelect.value ? parseInt(parentFolderSelect.value, 10) : null;
    const { error } = await supabase.from('v2_carpetas').insert({ nombre: name, parent_id: parentId });
    if (error) alert("Error al crear la carpeta."); else { toggleAddFolderForm(false); await loadFolders(); }
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

// --- LÓGICA DE DRAG & DROP (Sin cambios) ---
function addDropTarget(element) {
    element.addEventListener('dragover', (e) => { e.preventDefault(); element.classList.add('drag-over'); });
    element.addEventListener('dragleave', () => element.classList.remove('drag-over'));
    element.addEventListener('drop', async (e) => {
        e.preventDefault();
        element.classList.remove('drag-over');
        const draggedId = e.dataTransfer.getData('text/plain');
        const targetFolderId = element.dataset.folderId === 'none' ? null : parseInt(element.dataset.folderId, 10);

        if (draggedId.includes('[')) {
            const ids = JSON.parse(draggedId);
            await moveCandidates(ids, targetFolderId);
        } else {
            await moveFolder(parseInt(draggedId, 10), targetFolderId);
        }
    });
}
async function moveCandidates(ids, folderId) {
    const { error } = await supabase.from('v2_candidatos').update({ carpeta_id: folderId }).in('id', ids);
    if (error) alert("Error al mover."); else { alert("Movidos con éxito."); loadCandidates(); }
}

async function moveFolder(folderId, parentId) {
    const { error } = await supabase
        .from('v2_carpetas')
        .update({ parent_id: parentId })
        .eq('id', folderId);

    if (error) {
        alert('Error al mover la carpeta.');
        console.error('Error moving folder:', error);
    } else {
        alert('Carpeta movida con éxito.');
        await loadFolders();
    }
}

// --- MODALES (ACTUALIZADO) ---

// ===== CAMBIO: La función ahora es async y consulta a Supabase =====
async function openCvPdf(id, buttonElement) {
    const originalText = buttonElement.innerHTML;
    buttonElement.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    buttonElement.disabled = true;

    try {
        const { data, error } = await supabase
            .from('v2_candidatos')
            .select('base64_general, nombre_archivo_general')
            .eq('id', id)
            .single();

        if (error) throw error;

        if (data && data.base64_general) {
            const base64Data = data.base64_general.split(',')[1];
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'application/pdf' });
            
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = data.nombre_archivo_general || 'cv.pdf';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } else {
            alert('No se encontró el archivo CV para este candidato.');
        }
    } catch (error) {
        console.error('Error al obtener el CV:', error);
        alert('No se pudo cargar el CV.');
    } finally {
        buttonElement.innerHTML = originalText;
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

function openEditModal(id) {
    const c = candidatosCache.find(c => c.id == id);
    if (!c) return;
    editCandidateIdInput.value = c.id;
    editNombreInput.value = c.nombre_candidato || '';
    editEmailInput.value = c.email || '';
    editTelefonoInput.value = c.telefono || '';
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
    if (error) alert("Error al actualizar."); else { closeEditModal(); loadCandidates(); }
}

async function deleteCandidate(id) {
    if (confirm('¿Eliminar este candidato de forma PERMANENTE? Se conservará el historial de sus postulaciones.')) {
        const { error } = await supabase.from('v2_candidatos').delete().eq('id', id);
        if (error) {
            alert('Error al eliminar el candidato.');
            console.error('Error deleting candidate:', error);
        } else {
            alert('Candidato eliminado con éxito.');
            loadCandidates();
        }
    }
}
