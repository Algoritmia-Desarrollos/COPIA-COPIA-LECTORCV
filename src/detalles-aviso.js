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
const dbModalFooter = document.getElementById('db-modal-footer');
const avisoModalFooter = document.getElementById('aviso-modal-footer');
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
                    // Disparar manualmente un evento de cambio en el contenedor para actualizar el footer
                    const modalBody = e.target.closest('.modal-body');
                    if (modalBody) {
                        modalBody.dispatchEvent(new Event('change'));
                    }
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
    const { data: carpetas, error } = await supabase.from('v2_carpetas').select('id, nombre').order('nombre');
    if (error) {
        dbModalContent.innerHTML = '<p class="text-danger">Error al cargar las carpetas.</p>';
        return;
    }
    let html = `<select id="db-folder-select" class="form-control"><option value="">Selecciona una carpeta...</option><option value="all">Todos los Candidatos</option>${carpetas.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')}</select><div id="candidates-from-folder-container" style="margin-top: 1rem;"></div>`;
    dbModalContent.innerHTML = html;

    document.getElementById('db-folder-select').addEventListener('change', async (e) => {
        const folderId = e.target.value;
        const container = document.getElementById('candidates-from-folder-container');
        if (!folderId) {
            container.innerHTML = '';
            updateModalFooter(dbModalContent, dbModalFooter, 'db');
            return;
        }
        container.innerHTML = '<p>Cargando candidatos...</p>';
        
        let query = supabase.from('v2_candidatos').select('id, nombre_candidato');
        if (folderId !== 'all') {
            query = query.eq('carpeta_id', folderId);
        }

        const { data: candidatos, error: candError } = await query.order('nombre_candidato');

        if (candError) { container.innerHTML = '<p class="text-danger">Error al cargar candidatos.</p>'; return; }
        if (candidatos.length === 0) { container.innerHTML = '<p>No se encontraron candidatos.</p>'; return; }
        
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
        updateModalFooter(dbModalContent, dbModalFooter, 'db');
    });

    dbModalContent.addEventListener('change', () => updateModalFooter(dbModalContent, dbModalFooter, 'db'));
    updateModalFooter(dbModalContent, dbModalFooter, 'db');
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
        if (!selectedAvisoId) {
            container.innerHTML = '';
            updateModalFooter(avisoModalContent, avisoModalFooter, 'aviso');
            return;
        }
        container.innerHTML = '<p>Cargando candidatos...</p>';
        const { data, error: postError } = await supabase.from('v2_postulaciones').select('v2_candidatos(id, nombre_candidato)').eq('aviso_id', selectedAvisoId);
        if (postError) { container.innerHTML = '<p class="text-danger">Error al cargar candidatos.</p>'; return; }
        
        const candidatosPostulados = data.map(p => p.v2_candidatos).filter(Boolean);
        candidatosPostulados.sort((a, b) => a.nombre_candidato.localeCompare(b.nombre_candidato));

        if (candidatosPostulados.length > 0) {
            let candHtml = `
                <div class="carpeta-header">
                    <h4>Candidatos</h4>
                    <label class="select-all-folder-label">
                        <input type="checkbox" class="select-all-modal-cb"> Seleccionar Todos
                    </label>
                </div>
                <ul class="candidate-list-modal">
                    ${candidatosPostulados.map(c => `<li><label><input type="checkbox" class="candidato-checkbox-aviso" value="${c.id}"> ${c.nombre_candidato}</label></li>`).join('')}
                </ul>`;
            container.innerHTML = candHtml;
        } else {
            container.innerHTML = '<p>No hay candidatos postulados en este aviso.</p>';
        }
        updateModalFooter(avisoModalContent, avisoModalFooter, 'aviso');
    });

    avisoModalContent.addEventListener('change', () => updateModalFooter(avisoModalContent, avisoModalFooter, 'aviso'));
    updateModalFooter(avisoModalContent, avisoModalFooter, 'aviso');
});

function updateModalFooter(modalBody, modalFooter, type) {
    const selectedCount = modalBody.querySelectorAll(`.candidato-checkbox-${type}:checked`).length;
    
    if (selectedCount > 0) {
        modalFooter.innerHTML = `
            <span class="selection-count">${selectedCount} seleccionado(s)</span>
            <div>
                <button type="button" class="btn btn-secondary modal-close-btn">Cancelar</button>
                <button type="button" id="confirm-add-from-${type}" class="btn btn-primary">Agregar Seleccionados</button>
            </div>
        `;
        modalFooter.querySelector(`#confirm-add-from-${type}`).addEventListener('click', () => {
            const selectedCandidatos = Array.from(modalBody.querySelectorAll(`.candidato-checkbox-${type}:checked`)).map(cb => cb.value);
            const modalElement = modalBody.closest('.modal-overlay');
            addSelectedCandidatos(selectedCandidatos, modalElement);
        });
        modalFooter.querySelector('.modal-close-btn').addEventListener('click', () => {
            hideModal(modalBody.closest('.modal-overlay').id);
        });
    } else {
        modalFooter.innerHTML = `
            <button type="button" class="btn btn-secondary modal-close-btn" style="margin-left: auto;">Cerrar</button>
        `;
        modalFooter.querySelector('.modal-close-btn').addEventListener('click', () => {
            hideModal(modalBody.closest('.modal-overlay').id);
        });
    }
}

async function addSelectedCandidatos(selectedIds, fromModal) {
    const confirmBtn = fromModal.querySelector('.btn-primary');
    if (!confirmBtn) return;

    if (selectedIds.length === 0) {
        alert('No has seleccionado ningún candidato.');
        return;
    }

    confirmBtn.disabled = true;
    let nuevos = 0;
    let existentes = 0;

    for (const [index, candidatoId] of selectedIds.entries()) {
        confirmBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Procesando ${index + 1}/${selectedIds.length}`;

        const { data: existing, error: checkError } = await supabase
            .from('v2_postulaciones')
            .select('id')
            .eq('candidato_id', candidatoId)
            .eq('aviso_id', currentAvisoId)
            .single();

        if (checkError && checkError.code !== 'PGRST116') {
            console.error('Error verificando postulación existente:', checkError);
            continue;
        }

        if (existing) {
            existentes++;
            continue;
        }

        const { data: candidatoData, error: fetchError } = await supabase
            .from('v2_candidatos')
            .select('texto_cv_general, nombre_archivo_general, base64_general')
            .eq('id', candidatoId)
            .single();

        if (fetchError) {
            console.error(`Error obteniendo datos del candidato ${candidatoId}:`, fetchError);
            continue;
        }

        const newPostulacion = {
            candidato_id: candidatoId,
            aviso_id: currentAvisoId,
            texto_cv_especifico: candidatoData.texto_cv_general,
            nombre_archivo_especifico: candidatoData.nombre_archivo_general,
            base64_cv_especifico: candidatoData.base64_general,
            calificacion: null
        };

        const { error: insertError } = await supabase.from('v2_postulaciones').insert(newPostulacion);

        if (insertError) {
            console.error(`Error insertando postulación para candidato ${candidatoId}:`, insertError);
        } else {
            nuevos++;
        }
    }

    confirmBtn.textContent = '¡Completado!';
    let summary = `Proceso finalizado.\n\n`;
    summary += `- ${nuevos} candidato(s) fueron agregados a la búsqueda.\n`;
    summary += `- ${existentes} candidato(s) ya se encontraban en la lista.`;
    
    alert(summary);
    
    window.location.reload();
}

// Los listeners de los botones de confirmación ahora se añaden dinámicamente en updateModalFooter

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
