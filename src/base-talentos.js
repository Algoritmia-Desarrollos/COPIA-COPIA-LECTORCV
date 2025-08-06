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

// --- ESTADO GLOBAL CON PAGINACIÓN ---
let carpetasCache = [];
let currentFolderId = 'all';
let currentPage = 1;
const rowsPerPage = 50; // Puedes ajustar este número para cargar más o menos candidatos por página
let totalCandidates = 0;
let currentSearchTerm = '';

// --- INICIALIZACIÓN ---
window.addEventListener('DOMContentLoaded', async () => {
    await loadFolders();
    handleFolderClick('all', 'Todos los Candidatos', folderList.querySelector("[data-folder-id='all']"));

    // Listener de búsqueda con "debounce" para no sobrecargar la BD
    let searchTimeout;
    filtroInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentPage = 1;
            currentSearchTerm = filtroInput.value;
            loadCandidates();
        }, 500); // Espera 500ms después de que el usuario deja de teclear
    });

    // Listeners de paginación
    tablePrevPageBtn.addEventListener('click', () => changePage(-1));
    tableNextPageBtn.addEventListener('click', () => changePage(1));

    // Otros Listeners
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
    folderList.innerHTML = '';
    ['Todos los Candidatos', 'Sin Carpeta'].forEach(name => {
        const id = name === 'Todos los Candidatos' ? 'all' : 'none';
        const icon = id === 'all' ? 'fa-inbox' : 'fa-folder-open';
        const li = document.createElement('li');
        li.innerHTML = `<div class="folder-item" data-folder-id="${id}"><i class="fa-solid ${icon}"></i> <span class="folder-name">${name}</span></div>`;
        folderList.appendChild(li);
    });
    carpetasCache.forEach(folder => {
        const li = document.createElement('li');
        li.innerHTML = `<div class="folder-item" data-folder-id="${folder.id}"><i class="fa-solid fa-folder"></i> <span class="folder-name">${folder.nombre}</span></div>`;
        folderList.appendChild(li);
    });
    folderList.querySelectorAll('.folder-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.folderId;
            const name = e.currentTarget.querySelector('.folder-name').textContent;
            handleFolderClick(id, name, e.currentTarget);
        });
    });
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

// --- LÓGICA DE CANDIDATOS CON PAGINACIÓN ---
async function loadCandidates() {
    talentosListBody.innerHTML = `<tr><td colspan="5" style="text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando...</td></tr>`;
    
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage - 1;

    let query = supabase.from('v2_candidatos');
    let countQuery = supabase.from('v2_candidatos');

    if (currentFolderId === 'none') {
        query = query.is('carpeta_id', null);
        countQuery = countQuery.is('carpeta_id', null);
    } else if (currentFolderId !== 'all') {
        query = query.eq('carpeta_id', currentFolderId);
        countQuery = countQuery.eq('carpeta_id', currentFolderId);
    }

    if (currentSearchTerm) {
        const searchTerm = `%${currentSearchTerm}%`;
        query = query.or(`nombre_candidato.ilike.${searchTerm},email.ilike.${searchTerm},telefono.ilike.${searchTerm}`);
        countQuery = countQuery.or(`nombre_candidato.ilike.${searchTerm},email.ilike.${searchTerm},telefono.ilike.${searchTerm}`);
    }

    const [{ data, error }, { count, error: countError }] = await Promise.all([
        query.select(`id, nombre_candidato, email, telefono, nombre_archivo_general, v2_carpetas(nombre)`).range(startIndex, endIndex).order('updated_at', { ascending: false }),
        countQuery.select('*', { count: 'exact', head: true })
    ]);

    if (error || countError) {
        console.error("Error al cargar candidatos:", error || countError);
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
            <td class="candidate-name-cell">
                <span class="candidate-name">${candidato.nombre_candidato || 'No extraído'}</span>
                <span class="candidate-filename">${candidato.nombre_archivo_general || 'No Identificado'}</span>
            </td>
            <td>${candidato.v2_carpetas?.nombre || '<em>Sin Carpeta</em>'}</td>
            <td><div style="white-space: normal;">${candidato.email || ''}</div><div class="text-light">${candidato.telefono || ''}</div></td>
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
    row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const checkbox = row.querySelector('.candidate-checkbox');
        checkbox.checked = !checkbox.checked;
        updateBulkActionsVisibility();
    });
    row.querySelector('.candidate-checkbox').addEventListener('change', updateBulkActionsVisibility);
    const viewCvBtn = row.querySelector('[data-action="view-cv"]');
    viewCvBtn.addEventListener('click', (e) => { e.stopPropagation(); openCvPdf(row.dataset.id, viewCvBtn); });
    row.querySelector('[data-action="view-text"]').addEventListener('click', (e) => { e.stopPropagation(); openTextModal(row.dataset.id); });
    row.querySelector('[data-action="edit"]').addEventListener('click', (e) => { e.stopPropagation(); openEditModal(row.dataset.id); });
}

// --- ACCIONES EN LOTE Y FORMULARIOS ---
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

// --- MODALES ---
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
