// src/detalles-aviso.js

import { supabase } from './supabaseClient.js';
import { showModal, hideModal } from './utils.js';

// --- SELECTORES DEL DOM ---
const avisoTitulo = document.getElementById('aviso-titulo');
const avisoDescripcion = document.getElementById('aviso-descripcion');
const necesariasList = document.getElementById('necesarias-list');
const deseablesList = document.getElementById('deseables-list');
const avisoIdSpan = document.getElementById('aviso-id');
const avisoMaxCvSpan = document.getElementById('aviso-max-cv');
const avisoValidoHastaSpan = document.getElementById('aviso-valido-hasta');
const linkPostulanteInput = document.getElementById('link-postulante');
const copiarLinkBtn = document.getElementById('copiar-link-btn');
const abrirLinkBtn = document.getElementById('abrir-link-btn');
const qrCanvas = document.getElementById('qr-canvas');
const deleteAvisoBtn = document.getElementById('delete-aviso-btn');
const verPostuladosBtn = document.getElementById('ver-postulados-btn');
const editAvisoBtn = document.getElementById('edit-aviso-btn');
const postulantesHeader = document.getElementById('postulantes-header');

// --- SELECTORES DE MODALES ---
const addFromDbBtn = document.getElementById('add-from-db-btn');
const addFromAvisoBtn = document.getElementById('add-from-aviso-btn');
const modalAddFromDb = document.getElementById('modal-add-from-db');
const modalAddFromAviso = document.getElementById('modal-add-from-aviso');
const dbModalContent = document.getElementById('db-modal-content');
const avisoModalContent = document.getElementById('aviso-modal-content');
const confirmAddFromDbBtn = document.getElementById('confirm-add-from-db');
const confirmAddFromAvisoBtn = document.getElementById('confirm-add-from-aviso');
const modalEditAviso = document.getElementById('modal-edit-aviso');
const confirmEditAvisoBtn = document.getElementById('confirm-edit-aviso-btn');

let avisoActivo = null;
let currentAvisoId = null;

// --- LÓGICA PRINCIPAL AL CARGAR LA PÁGINA ---
window.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const avisoId = params.get('id');
    currentAvisoId = avisoId;

    if (!avisoId) {
        window.location.href = 'lista-avisos.html';
        return;
    }

    await loadAvisoDetails(avisoId);

    // Listener para los checkboxes "Seleccionar Todos" en los modales
    document.body.addEventListener('change', (e) => {
        if (e.target.classList.contains('select-all-modal-cb')) {
            const isChecked = e.target.checked;
            const header = e.target.closest('.carpeta-header');
            if (header) {
                const list = header.nextElementSibling;
                if (list && list.tagName === 'UL') {
                    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                        cb.checked = isChecked;
                    });
                }
            }
        }
    });
});

async function loadAvisoDetails(id) {
    const { data, error } = await supabase
        .from('v2_avisos')
        .select('*, v2_postulaciones(count)')
        .eq('id', id)
        .single();

    if (error) {
        console.error('Error cargando los detalles del aviso:', error);
        document.body.innerHTML = `<div class="panel-container" style="text-align: center; margin: 2rem auto; max-width: 600px;"><h1>Error</h1><p>No se pudo cargar el aviso. Es posible que haya sido eliminado.</p><a href="lista-avisos.html" class="btn btn-primary">Volver a la lista</a></div>`;
        return;
    }

    avisoActivo = data;
    populateUI(avisoActivo);

    const postulantesCount = avisoActivo.v2_postulaciones[0]?.count || 0;
    const maxCv = avisoActivo.max_cv || 'Ilimitados';
    postulantesHeader.textContent = `Candidatos Postulados (${postulantesCount} / ${maxCv})`;
}

function populateUI(aviso) {
    avisoTitulo.textContent = aviso.titulo;
    avisoDescripcion.textContent = aviso.descripcion;
    renderCondiciones(necesariasList, aviso.condiciones_necesarias, 'No se especificaron condiciones necesarias.');
    renderCondiciones(deseablesList, aviso.condiciones_deseables, 'No se especificaron condiciones deseables.');
    avisoIdSpan.textContent = aviso.id;
    avisoMaxCvSpan.textContent = aviso.max_cv || 'Ilimitados';
    avisoValidoHastaSpan.textContent = new Date(aviso.valido_hasta).toLocaleDateString('es-AR', { timeZone: 'UTC' });
    const publicLink = `${window.location.origin}/index.html?avisoId=${aviso.id}`;
    linkPostulanteInput.value = publicLink;
    abrirLinkBtn.href = publicLink;
    new QRious({ element: qrCanvas, value: publicLink, size: 150, padding: 10 });
}

function renderCondiciones(listElement, condiciones, emptyMessage) {
    listElement.innerHTML = '';
    if (condiciones && condiciones.length > 0) {
        condiciones.forEach(condicion => {
            const li = document.createElement('li');
            li.textContent = condicion;
            listElement.appendChild(li);
        });
    } else {
        const li = document.createElement('li');
        li.textContent = emptyMessage;
        li.style.color = 'var(--text-light)';
        listElement.appendChild(li);
    }
}

// --- MANEJO DE EVENTOS DE BOTONES ---
copiarLinkBtn.addEventListener('click', () => {
    linkPostulanteInput.select();
    document.execCommand('copy');
    copiarLinkBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
    setTimeout(() => {
        copiarLinkBtn.innerHTML = '<i class="fa-solid fa-copy"></i>';
    }, 2000);
});

deleteAvisoBtn.addEventListener('click', async () => {
    if (!avisoActivo) return;
    if (confirm(`¿Estás seguro de que quieres eliminar el aviso "${avisoActivo.titulo}"?`)) {
        deleteAvisoBtn.disabled = true;
        const { error } = await supabase.from('v2_avisos').delete().eq('id', avisoActivo.id);
        if (error) {
            alert('Error al eliminar el aviso.');
            deleteAvisoBtn.disabled = false;
        } else {
            alert('Aviso eliminado correctamente.');
            window.location.href = 'lista-avisos.html';
        }
    }
});

verPostuladosBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (currentAvisoId) {
        window.location.href = `resumenes.html?avisoId=${currentAvisoId}`;
    }
});

// --- LÓGICA DE MODALES PARA AÑADIR CANDIDATOS ---
addFromDbBtn.addEventListener('click', async () => {
    showModal('modal-add-from-db');
    dbModalContent.innerHTML = '<p>Cargando carpetas...</p>';
    const { data: carpetas, error } = await supabase.from('v2_carpetas').select('id, nombre');
    if (error) {
        dbModalContent.innerHTML = '<p class="text-danger">Error al cargar las carpetas.</p>';
        return;
    }
    let html = `<select id="db-folder-select" class="form-control"><option value="">Selecciona una carpeta...</option>${carpetas.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')}</select><div id="candidates-from-folder-container" style="margin-top: 1rem;"></div>`;
    dbModalContent.innerHTML = html;

    document.getElementById('db-folder-select').addEventListener('change', async (e) => {
        const folderId = e.target.value;
        const container = document.getElementById('candidates-from-folder-container');
        if (!folderId) { container.innerHTML = ''; return; }
        container.innerHTML = '<p>Cargando candidatos...</p>';
        const { data: candidatos, error: candError } = await supabase.from('v2_candidatos').select('id, nombre_candidato').eq('carpeta_id', folderId);
        if (candError) { container.innerHTML = '<p class="text-danger">Error al cargar candidatos.</p>'; return; }
        if (candidatos.length === 0) { container.innerHTML = '<p>No hay candidatos en esta carpeta.</p>'; return; }
        let candHtml = `
            <div class="carpeta-header">
                <h4>Candidatos</h4>
                <label class="select-all-folder-label">
                    <input type="checkbox" class="select-all-modal-cb"> Seleccionar Todos
                </label>
            </div>
            <ul class="candidate-list-modal">
                ${candidatos.map(c => `<li><label><input type="checkbox" class="candidato-checkbox-db" value="${c.id}"> ${c.nombre_candidato}</label></li>`).join('')}
            </ul>`;
        container.innerHTML = candHtml;
    });
});

addFromAvisoBtn.addEventListener('click', async () => {
    showModal('modal-add-from-aviso');
    avisoModalContent.innerHTML = '<p>Cargando otros avisos...</p>';
    const { data: avisos, error } = await supabase.from('v2_avisos').select('id, titulo').neq('id', currentAvisoId);
    if (error) {
        avisoModalContent.innerHTML = '<p class="text-danger">Error al cargar los avisos.</p>';
        return;
    }
    let html = `<select id="aviso-select" class="form-control"><option value="">Selecciona un aviso...</option>${avisos.map(a => `<option value="${a.id}">${a.titulo}</option>`).join('')}</select><div id="candidatos-from-aviso-container" style="margin-top: 1rem;"></div>`;
    avisoModalContent.innerHTML = html;

    document.getElementById('aviso-select').addEventListener('change', async (e) => {
        const selectedAvisoId = e.target.value;
        const container = document.getElementById('candidatos-from-aviso-container');
        if (!selectedAvisoId) { container.innerHTML = ''; return; }
        container.innerHTML = '<p>Cargando candidatos...</p>';
        const { data, error: postError } = await supabase.from('v2_postulaciones').select('v2_candidatos(id, nombre_candidato)').eq('aviso_id', selectedAvisoId);
        if (postError) { container.innerHTML = '<p class="text-danger">Error al cargar candidatos.</p>'; return; }
        let candHtml = '';
        const candidatosPostulados = data.map(p => p.v2_candidatos).filter(Boolean);

        if (candidatosPostulados.length > 0) {
            candHtml = `
                <div class="carpeta-header">
                    <h4>Candidatos</h4>
                    <label class="select-all-folder-label">
                        <input type="checkbox" class="select-all-modal-cb"> Seleccionar Todos
                    </label>
                </div>
                <ul class="candidate-list-modal">
                    ${candidatosPostulados.map(c => `<li><label><input type="checkbox" class="candidato-checkbox-aviso" value="${c.id}"> ${c.nombre_candidato}</label></li>`).join('')}
                </ul>`;
        } else {
            candHtml = '<p>No hay candidatos postulados en este aviso.</p>';
        }
        container.innerHTML = candHtml;
    });
});

/**
 * ===== FUNCIÓN CORREGIDA Y SIMPLIFICADA =====
 * Añade los candidatos seleccionados a la postulación actual y los deja pendientes de análisis.
 */
async function addSelectedCandidatos(selectedIds) {
    if (selectedIds.length === 0) {
        alert('No has seleccionado ningún candidato.');
        return false;
    }

    // 1. Obtener los datos completos de los candidatos seleccionados
    const { data: candidatos, error: fetchError } = await supabase
        .from('v2_candidatos')
        .select('id, texto_cv_general, nombre_archivo_general, base64_general')
        .in('id', selectedIds);

    if (fetchError) {
        alert('Error al obtener los datos de los candidatos seleccionados.');
        console.error(fetchError);
        return false;
    }

    // 2. Preparar los nuevos registros de postulación
    const nuevasPostulaciones = candidatos.map(candidato => ({
        candidato_id: candidato.id,
        aviso_id: currentAvisoId,
        texto_cv_especifico: candidato.texto_cv_general,
        nombre_archivo_especifico: candidato.nombre_archivo_general,
        base64_cv_especifico: candidato.base64_general,
        calificacion: null // Se deja en null para que resumenes.js lo analice
    }));

    // 3. Insertar las nuevas postulaciones, ignorando duplicados
    // Usamos 'upsert' que es más seguro para manejar conflictos
    const { error: insertError } = await supabase
        .from('v2_postulaciones')
        .upsert(nuevasPostulaciones, { onConflict: 'candidato_id, aviso_id' });

    if (insertError) {
        alert('Error al añadir los candidatos a la búsqueda.');
        console.error(insertError);
        return false;
    }
    
    alert(`${nuevasPostulaciones.length} candidato(s) han sido añadidos a la búsqueda y están listos para ser analizados.`);
    
    // 4. Redirigir a la página de resúmenes donde se hará el análisis
    window.location.href = `resumenes.html?avisoId=${currentAvisoId}`;
    
    return true;
}

confirmAddFromDbBtn.addEventListener('click', async () => {
    const selectedCandidatos = Array.from(document.querySelectorAll('.candidato-checkbox-db:checked')).map(cb => cb.value);
    if (await addSelectedCandidatos(selectedCandidatos)) {
        hideModal('modal-add-from-db');
    }
});

confirmAddFromAvisoBtn.addEventListener('click', async () => {
    const selectedCandidatos = Array.from(document.querySelectorAll('.candidato-checkbox-aviso:checked')).map(cb => cb.value);
    if (await addSelectedCandidatos(selectedCandidatos)) {
        hideModal('modal-add-from-aviso');
    }
});

// --- LÓGICA DE EDICIÓN DE AVISO ---
editAvisoBtn.addEventListener('click', () => {
    showModal('modal-edit-aviso');
    document.getElementById('edit-descripcion').value = avisoActivo.descripcion;
    // ... y el resto de la lógica de edición
});

function renderEditList(listElement, conditions) {
    listElement.innerHTML = '';
    if (conditions) {
        conditions.forEach(cond => {
            const li = document.createElement('li');
            li.textContent = cond;
            const removeBtn = document.createElement('button');
            removeBtn.textContent = '×';
            removeBtn.className = 'remove-btn';
            removeBtn.onclick = () => li.remove();
            li.appendChild(removeBtn);
            listElement.appendChild(li);
        });
    }
}

document.getElementById('add-necesaria-btn-edit').addEventListener('click', () => {
    const input = document.getElementById('edit-necesaria-input');
    if (input.value.trim()) {
        const list = document.getElementById('necesarias-list-edit');
        const li = document.createElement('li');
        li.textContent = input.value.trim();
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '×';
        removeBtn.className = 'remove-btn';
        removeBtn.onclick = () => li.remove();
        li.appendChild(removeBtn);
        list.appendChild(li);
        input.value = '';
    }
});

document.getElementById('add-deseable-btn-edit').addEventListener('click', () => {
    const input = document.getElementById('edit-deseable-input');
    if (input.value.trim()) {
        const list = document.getElementById('deseables-list-edit');
        const li = document.createElement('li');
        li.textContent = input.value.trim();
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '×';
        removeBtn.className = 'remove-btn';
        removeBtn.onclick = () => li.remove();
        li.appendChild(removeBtn);
        list.appendChild(li);
        input.value = '';
    }
});

confirmEditAvisoBtn.addEventListener('click', async () => {
    const updatedData = {
        descripcion: document.getElementById('edit-descripcion').value,
        condiciones_necesarias: Array.from(document.getElementById('necesarias-list-edit').children).map(li => li.textContent.slice(0, -1)),
        condiciones_deseables: Array.from(document.getElementById('deseables-list-edit').children).map(li => li.textContent.slice(0, -1)),
        max_cv: document.getElementById('edit-max-cv').value,
        valido_hasta: document.getElementById('edit-valido-hasta').value
    };

    const { error } = await supabase.from('v2_avisos').update(updatedData).eq('id', currentAvisoId);

    if (error) {
        alert('Error al actualizar el aviso.');
    } else {
        alert('Aviso actualizado correctamente.');
        hideModal('modal-edit-aviso');
        await loadAvisoDetails(currentAvisoId);
    }
});
