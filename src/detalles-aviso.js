// src/detalles-aviso.js

import { supabase } from './supabaseClient.js';

// --- SELECTORES DE ELEMENTOS DEL DOM ---
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
const postulantesListContainer = document.getElementById('postulantes-list-container');
const postulantesHeader = document.getElementById('postulantes-header');
const verPostuladosBtn = document.getElementById('ver-postulados-btn');
const editAvisoBtn = document.getElementById('edit-aviso-btn');

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
let selectedCandidatosDb = [];

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
});

async function loadAvisoDetails(id) {
    const { data, error } = await supabase
        .from('v2_avisos')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        console.error('Error cargando los detalles del aviso:', error);
        document.body.innerHTML = `<div class="panel-container" style="text-align: center; margin: 2rem auto; max-width: 600px;"><h1>Error</h1><p>No se pudo cargar el aviso. Es posible que haya sido eliminado.</p><a href="lista-avisos.html" class="btn btn-primary">Volver a la lista</a></div>`;
        return;
    }

    avisoActivo = data;
    populateUI(avisoActivo);
    await loadPostulantes(id); // Cargar postulantes después de tener los detalles del aviso
}

async function loadPostulantes(avisoId) {
    // Solo obtener el conteo, no los datos completos
    const { error, count } = await supabase
        .from('v2_postulaciones')
        .select('id', { count: 'exact', head: true })
        .eq('aviso_id', avisoId);

    if (error) {
        console.error('Error cargando conteo de postulantes:', error);
        postulantesHeader.textContent = 'Candidatos Postulados';
        postulantesListContainer.innerHTML = `<p class="text-danger">Error al cargar el conteo.</p>`;
        return;
    }

    const maxCv = avisoActivo.max_cv || '∞';
    postulantesHeader.textContent = `Candidatos Postulados (${count} de ${maxCv})`;
    
    // Limpiar el contenedor para no mostrar la lista de nombres
    postulantesListContainer.innerHTML = '';
}


function populateUI(aviso) {
    avisoTitulo.textContent = aviso.titulo;
    avisoDescripcion.textContent = aviso.descripcion;
    renderCondiciones(necesariasList, aviso.condiciones_necesarias, 'No se especificaron condiciones necesarias.');
    renderCondiciones(deseablesList, aviso.condiciones_deseables, 'No se especificaron condiciones deseables.');
    avisoIdSpan.textContent = aviso.id;
    avisoMaxCvSpan.textContent = aviso.max_cv || 'Ilimitados';
    avisoValidoHastaSpan.textContent = new Date(aviso.valido_hasta).toLocaleDateString('es-AR', { timeZone: 'UTC' });
    const publicLink = `${window.location.origin}/carga-publica.html?avisoId=${aviso.id}`;
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
    if (confirm(`¿Estás seguro de que quieres eliminar el aviso "${avisoActivo.titulo}"? Esta acción no se puede deshacer.`)) {
        deleteAvisoBtn.disabled = true;
        deleteAvisoBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Eliminando...';
        const { error } = await supabase.from('v2_avisos').delete().eq('id', avisoActivo.id);
        if (error) {
            alert('Error al eliminar el aviso.');
            deleteAvisoBtn.disabled = false;
            deleteAvisoBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Eliminar Aviso';
        } else {
            alert('Aviso eliminado correctamente.');
            window.location.href = 'lista-avisos.html';
        }
    }
});

function openModal(modal) { modal.style.display = 'flex'; }
function closeModal(modal) { modal.style.display = 'none'; }

document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const modalId = btn.getAttribute('data-modal-id');
        closeModal(document.getElementById(modalId));
    });
});

verPostuladosBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (currentAvisoId) {
        window.location.href = `resumenes.html?avisoId=${currentAvisoId}`;
    }
});

addFromDbBtn.addEventListener('click', async () => {
    openModal(modalAddFromDb);
    dbModalContent.innerHTML = '<p>Cargando carpetas...</p>';

    const { data: carpetas, error } = await supabase.from('v2_carpetas').select('id, nombre');
    if (error) {
        dbModalContent.innerHTML = '<p class="text-danger">Error al cargar las carpetas.</p>';
        return;
    }

    let html = `
        <select id="db-folder-select" class="form-control">
            <option value="">Selecciona una carpeta...</option>
            ${carpetas.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')}
        </select>
        <div id="candidates-from-folder-container" style="margin-top: 1rem;"></div>
    `;
    dbModalContent.innerHTML = html;

    document.getElementById('db-folder-select').addEventListener('change', async (e) => {
        const folderId = e.target.value;
        const container = document.getElementById('candidates-from-folder-container');
        if (!folderId) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = '<p>Cargando candidatos...</p>';

        const { data: candidatos, error: candError } = await supabase
            .from('v2_candidatos')
            .select('id, nombre_candidato')
            .eq('carpeta_id', folderId);

        if (candError) {
            container.innerHTML = '<p class="text-danger">Error al cargar candidatos.</p>';
            return;
        }

        if (candidatos.length === 0) {
            container.innerHTML = '<p>No hay candidatos en esta carpeta.</p>';
            return;
        }

        let candHtml = `
            <div class="carpeta-header">
                <h4>Candidatos</h4>
                <label class="select-all-folder-label">
                    <input type="checkbox" id="select-all-folder-cand-checkbox">
                    Seleccionar todos
                </label>
            </div>
            <ul class="candidate-list-modal">
                ${candidatos.map(c => `
                    <li>
                        <label>
                            <input type="checkbox" class="candidato-checkbox-db" value="${c.id}" ${selectedCandidatosDb.includes(c.id.toString()) ? 'checked' : ''}>
                            ${c.nombre_candidato}
                        </label>
                    </li>
                `).join('')}
            </ul>
        `;
        container.innerHTML = candHtml;

        document.getElementById('select-all-folder-cand-checkbox').addEventListener('change', (event) => {
            container.querySelectorAll('.candidato-checkbox-db').forEach(cb => {
                cb.checked = event.target.checked;
            });
        });
    });
});

addFromAvisoBtn.addEventListener('click', async () => {
    openModal(modalAddFromAviso);
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
        let candHtml = `
            <div class="carpeta-header">
                <h4>Candidatos</h4>
                <label class="select-all-folder-label">
                    <input type="checkbox" id="select-all-aviso-cand-checkbox">
                    Seleccionar todos
                </label>
            </div>
            <ul class="candidate-list-modal">
        `;
        if (data.length > 0) {
            data.forEach(post => {
                if (post.v2_candidatos) {
                    candHtml += `<li><label><input type="checkbox" class="candidato-checkbox-aviso" value="${post.v2_candidatos.id}"> ${post.v2_candidatos.nombre_candidato}</label></li>`;
                }
            });
        } else {
            candHtml += '<li>No hay candidatos en este aviso.</li>';
        }
        candHtml += '</ul>';
        container.innerHTML = candHtml;

        document.getElementById('select-all-aviso-cand-checkbox').addEventListener('change', (event) => {
            container.querySelectorAll('.candidato-checkbox-aviso').forEach(cb => {
                cb.checked = event.target.checked;
            });
        });
    });
});

async function addSelectedCandidatos(selectedIds) {
    if (selectedIds.length === 0) {
        alert('No has seleccionado ningún candidato.');
        return false;
    }

    const { data: existingPostulaciones, error: fetchError } = await supabase
        .from('v2_postulaciones')
        .select('candidato_id')
        .eq('aviso_id', currentAvisoId);

    if (fetchError) {
        console.error('Error al verificar postulaciones existentes:', fetchError);
        alert('Error al verificar duplicados.');
        return false;
    }

    const existingIds = existingPostulaciones.map(p => p.candidato_id.toString());
    const newCandidatosIds = selectedIds.filter(id => !existingIds.includes(id));
    const omittedCount = selectedIds.length - newCandidatosIds.length;

    if (newCandidatosIds.length === 0) {
        alert(`Todos los candidatos seleccionados ya estaban en el aviso. ${omittedCount} omitidos.`);
        return true;
    }

    const postulaciones = newCandidatosIds.map(candidatoId => ({
        aviso_id: currentAvisoId,
        candidato_id: candidatoId
    }));

    const { data: insertedData, error } = await supabase.from('v2_postulaciones').insert(postulaciones).select();

    if (error) {
        console.error('Error al agregar postulantes:', error);
        alert('Error al agregar los candidatos.');
        return false;
    }

    if (insertedData) {
        for (const postulacion of insertedData) {
            await supabase.functions.invoke('v2-process-cv', {
                body: { record: { id: postulacion.id, aviso_id: postulacion.aviso_id, candidato_id: postulacion.candidato_id } },
            });
        }
    }

    let message = `${newCandidatosIds.length} candidatos agregados y enviados a re-análisis.`;
    if (omittedCount > 0) {
        message += ` ${omittedCount} fueron omitidos porque ya estaban postulados.`;
    }
    alert(message);
    await loadPostulantes(currentAvisoId);
    return true;
}


confirmAddFromDbBtn.addEventListener('click', async () => {
    document.querySelectorAll('.candidato-checkbox-db').forEach(cb => {
        const id = cb.value;
        if (cb.checked && !selectedCandidatosDb.includes(id)) {
            selectedCandidatosDb.push(id);
        } else if (!cb.checked && selectedCandidatosDb.includes(id)) {
            selectedCandidatosDb = selectedCandidatosDb.filter(selId => selId !== id);
        }
    });

    if (await addSelectedCandidatos(selectedCandidatosDb)) {
        selectedCandidatosDb = [];
        closeModal(modalAddFromDb);
    }
});

confirmAddFromAvisoBtn.addEventListener('click', async () => {
    const selectedCandidatos = Array.from(document.querySelectorAll('.candidato-checkbox-aviso:checked')).map(cb => cb.value);
    if (await addSelectedCandidatos(selectedCandidatos)) {
        closeModal(modalAddFromAviso);
    }
});

editAvisoBtn.addEventListener('click', () => {
    openModal(modalEditAviso);
    document.getElementById('edit-descripcion').value = avisoActivo.descripcion;
    document.getElementById('edit-max-cv').value = avisoActivo.max_cv;
    document.getElementById('edit-valido-hasta').value = new Date(avisoActivo.valido_hasta).toISOString().split('T')[0];

    const necesariasListEdit = document.getElementById('necesarias-list-edit');
    const deseablesListEdit = document.getElementById('deseables-list-edit');

    renderEditList(necesariasListEdit, avisoActivo.condiciones_necesarias);
    renderEditList(deseablesListEdit, avisoActivo.condiciones_deseables);
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
        closeModal(modalEditAviso);
        await loadAvisoDetails(currentAvisoId);
    }
});
