// src/base-talentos.js

import { supabase } from './supabaseClient.js';

// --- SELECTORES DE ELEMENTOS DEL DOM ---
const folderList = document.getElementById('folder-list');
const folderTitle = document.getElementById('folder-title');
const talentosListBody = document.getElementById('talentos-list-body');
const filtroInput = document.getElementById('filtro-candidatos');
const selectAllCheckbox = document.getElementById('select-all-checkbox');
const bulkActionsContainer = document.getElementById('bulk-actions-container');
const moveToFolderSelect = document.getElementById('move-to-folder-select');
const bulkMoveBtn = document.getElementById('bulk-move-btn');
const bulkDeleteBtn = document.getElementById('bulk-delete-btn');

// Formulario para añadir carpetas
const showAddFolderFormBtn = document.getElementById('show-add-folder-form-btn');
const addFolderForm = document.getElementById('add-folder-form');
const addFolderBtn = document.getElementById('add-folder-btn');
const cancelAddFolderBtn = document.getElementById('cancel-add-folder-btn');
const newFolderNameInput = document.getElementById('new-folder-name');
const parentFolderSelect = document.getElementById('parent-folder-select');

// --- ESTADO GLOBAL DE LA APLICACIÓN ---
let candidatosCache = [];
let carpetasCache = [];
let currentFolderId = null; // null para 'Todos', 'none' para 'Sin Carpeta'

// --- INICIALIZACIÓN ---
window.addEventListener('DOMContentLoaded', async () => {
    await loadFolders();
    // Por defecto, carga todos los candidatos al iniciar
    handleFolderClick(null, 'Todos los Candidatos', folderList.querySelector(`[data-folder-id='null']`));

    // Listeners para el formulario de crear carpeta
    showAddFolderFormBtn.addEventListener('click', () => toggleAddFolderForm(true));
    cancelAddFolderBtn.addEventListener('click', () => toggleAddFolderForm(false));
    addFolderBtn.addEventListener('click', createNewFolder);
    filtroInput.addEventListener('input', renderTable);
    selectAllCheckbox.addEventListener('change', handleSelectAll);
    bulkMoveBtn.addEventListener('click', handleBulkMove);
    bulkDeleteBtn.addEventListener('click', handleBulkDelete);
});


// --- LÓGICA DE CARGA DE CARPETAS ---
async function loadFolders() {
    const { data, error } = await supabase.from('v2_carpetas').select('*').order('nombre');
    if (error) {
        console.error("Error al cargar carpetas:", error);
        folderList.innerHTML = '<li>Error al cargar carpetas.</li>';
        return;
    }
    carpetasCache = data;
    renderFoldersUI();
    populateFolderSelects();
}

function renderFoldersUI() {
    folderList.innerHTML = '';
    
    // Añadir carpetas virtuales
    ['Todos los Candidatos', 'Sin Carpeta'].forEach(name => {
        const id = name === 'Todos los Candidatos' ? 'all' : 'none';
        const icon = id === 'all' ? 'fa-inbox' : 'fa-folder-open';
        const li = document.createElement('li');
        li.innerHTML = `<div class="folder-item" data-folder-id="${id}"><i class="fa-solid ${icon}"></i> <span class="folder-name">${name}</span></div>`;
        folderList.appendChild(li);
    });

    // Construir árbol de carpetas reales
    const buildTree = (parentId = null) => {
        const children = carpetasCache.filter(f => f.parent_id === parentId);
        if (children.length === 0) return null;

        const ul = document.createElement('ul');
        ul.className = 'folder-item-container';
        children.forEach(folder => {
            const li = document.createElement('li');
            li.innerHTML = `<div class="folder-item" data-folder-id="${folder.id}"><i class="fa-solid fa-folder"></i> <span class="folder-name">${folder.nombre}</span></div>`;
            const childrenUl = buildTree(folder.id);
            if (childrenUl) li.appendChild(childrenUl);
            ul.appendChild(li);
        });
        return ul;
    };
    
    const tree = buildTree();
    if (tree) folderList.appendChild(tree);

    // Añadir listeners a todos los items de carpeta
    folderList.querySelectorAll('.folder-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.folderId;
            const name = e.currentTarget.querySelector('.folder-name').textContent;
            handleFolderClick(id, name, e.currentTarget);
        });
    });
}

function handleFolderClick(id, name, element) {
    currentFolderId = (id === 'all') ? null : id;
    folderTitle.textContent = name;

    // Resaltar carpeta activa
    folderList.querySelectorAll('.folder-item.active').forEach(el => el.classList.remove('active'));
    element.classList.add('active');

    loadCandidates();
}

// --- LÓGICA DE CARGA DE CANDIDATOS ---
async function loadCandidates() {
    talentosListBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Cargando...</td></tr>';
    
    let query = supabase.from('v2_candidatos').select(`*, v2_carpetas(nombre)`);

    if (currentFolderId && currentFolderId !== 'none') {
        // Si se selecciona una carpeta específica
        query = query.eq('carpeta_id', currentFolderId);
    } else if (currentFolderId === 'none') {
        // Si se selecciona 'Sin Carpeta'
        query = query.is('carpeta_id', null);
    }
    // Si currentFolderId es null, trae todos (sin filtro de carpeta).

    const { data, error } = await query.order('updated_at', { ascending: false });

    if (error) {
        console.error("Error al cargar candidatos:", error);
        talentosListBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Error al cargar candidatos.</td></tr>';
        return;
    }
    candidatosCache = data;
    renderTable();
}

// --- RENDERIZADO DE LA TABLA ---
function renderTable() {
    const filtro = filtroInput.value.toLowerCase();
    const candidatosFiltrados = candidatosCache.filter(c => 
        (c.nombre_candidato || '').toLowerCase().includes(filtro) ||
        (c.email || '').toLowerCase().includes(filtro) ||
        (c.telefono || '').toLowerCase().includes(filtro)
    );

    talentosListBody.innerHTML = '';
    if (candidatosFiltrados.length === 0) {
        talentosListBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No se encontraron candidatos.</td></tr>';
        return;
    }

    candidatosFiltrados.forEach(candidato => {
        const row = document.createElement('tr');
        row.dataset.id = candidato.id;
        row.innerHTML = `
            <td><input type="checkbox" class="candidate-checkbox" data-id="${candidato.id}"></td>
            <td><strong>${candidato.nombre_candidato || 'No extraído'}</strong><br><span class="text-light">${candidato.nombre_archivo_general || ''}</span></td>
            <td>${candidato.email || ''}<br><span class="text-light">${candidato.telefono || ''}</span></td>
            <td>${candidato.v2_carpetas?.nombre || '<em>Sin Carpeta</em>'}</td>
            <td class="actions-group">
                <button class="btn btn-secondary btn-sm" data-action="view-cv" title="Ver CV"><i class="fa-solid fa-file-pdf"></i></button>
            </td>
        `;
        talentosListBody.appendChild(row);
    });

    // Añadir listeners para botones de acción y checkboxes
    talentosListBody.querySelectorAll('.candidate-checkbox').forEach(cb => cb.addEventListener('change', updateBulkActionsVisibility));
    talentosListBody.querySelectorAll('[data-action="view-cv"]').forEach(btn => btn.addEventListener('click', (e) => {
        const id = e.currentTarget.closest('tr').dataset.id;
        const candidato = candidatosCache.find(c => c.id == id);
        if (candidato?.base64_general) window.open(candidato.base64_general, '_blank');
        else alert('No hay un CV disponible para este candidato.');
    }));
}


// --- GESTIÓN DE CARPETAS (Formulario) ---
function toggleAddFolderForm(show) {
    if (show) {
        addFolderForm.classList.remove('hidden');
        showAddFolderFormBtn.classList.add('hidden');
    } else {
        addFolderForm.classList.add('hidden');
        showAddFolderFormBtn.classList.remove('hidden');
        newFolderNameInput.value = '';
    }
}

async function createNewFolder() {
    const name = newFolderNameInput.value.trim();
    if (!name) return alert("El nombre de la carpeta no puede estar vacío.");
    
    const parentId = parentFolderSelect.value ? parseInt(parentFolderSelect.value, 10) : null;

    const { error } = await supabase.from('v2_carpetas').insert({ nombre: name, parent_id: parentId });
    if (error) {
        alert("Error al crear la carpeta.");
        console.error(error);
    } else {
        toggleAddFolderForm(false);
        await loadFolders(); // Recargar la lista de carpetas
    }
}

function populateFolderSelects() {
    parentFolderSelect.innerHTML = '<option value="">Raíz (sin carpeta padre)</option>';
    moveToFolderSelect.innerHTML = '<option value="" disabled selected>Mover a...</option><option value="none">Quitar de carpeta</option>';
    
    carpetasCache.forEach(folder => {
        const optionHTML = `<option value="${folder.id}">${folder.nombre}</option>`;
        parentFolderSelect.innerHTML += optionHTML;
        moveToFolderSelect.innerHTML += optionHTML;
    });
}

// --- ACCIONES EN LOTE ---
function getSelectedIds() {
    return Array.from(talentosListBody.querySelectorAll('.candidate-checkbox:checked')).map(cb => cb.dataset.id);
}

function updateBulkActionsVisibility() {
    bulkActionsContainer.classList.toggle('hidden', getSelectedIds().length === 0);
}

function handleSelectAll() {
    const isChecked = selectAllCheckbox.checked;
    talentosListBody.querySelectorAll('.candidate-checkbox').forEach(cb => cb.checked = isChecked);
    updateBulkActionsVisibility();
}

async function handleBulkMove() {
    const ids = getSelectedIds();
    const targetFolderId = moveToFolderSelect.value === 'none' ? null : parseInt(moveToFolderSelect.value, 10);

    if (ids.length === 0 || moveToFolderSelect.value === "") return;

    const { error } = await supabase.from('v2_candidatos').update({ carpeta_id: targetFolderId }).in('id', ids);
    if (error) {
        alert("Error al mover los candidatos.");
    } else {
        alert(`${ids.length} candidato(s) movido(s) exitosamente.`);
        loadCandidates(); // Recargar la vista actual
    }
}

async function handleBulkDelete() {
    const ids = getSelectedIds();
    if (ids.length === 0) return;

    if (confirm(`¿Estás seguro de que quieres eliminar ${ids.length} candidato(s) de forma PERMANENTE? Esta acción no se puede deshacer y borrará también todas sus postulaciones.`)) {
        const { error } = await supabase.from('v2_candidatos').delete().in('id', ids);
        if (error) {
            alert("Error al eliminar los candidatos.");
        } else {
            alert(`${ids.length} candidato(s) eliminado(s) exitosamente.`);
            loadCandidates();
        }
    }
}