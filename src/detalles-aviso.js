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
    const postulantesCount = params.get('count'); // Obtenemos el conteo desde la URL
    currentAvisoId = avisoId;

    if (!avisoId) {
        window.location.href = 'lista-avisos.html';
        return;
    }

    await loadAvisoDetails(avisoId, postulantesCount); // Pasamos el conteo a la función

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

    // Listener global para cerrar modales
    document.body.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-close-btn')) {
            const modal = e.target.closest('.modal-overlay');
            if (modal) {
                hideModal(modal.id);
            }
        }
    });
});

async function loadAvisoDetails(id, countFromUrl) {
    // Cargar los detalles principales del aviso.
    const { data: avisoData, error: avisoError } = await supabase
        .from('v2_avisos')
        .select('*')
        .eq('id', id)
        .single();

    if (avisoError) {
        console.error('Error cargando los detalles del aviso:', avisoError);
        document.body.innerHTML = `<div class="panel-container" style="text-align: center; margin: 2rem auto; max-width: 600px;"><h1>Error</h1><p>No se pudo cargar el aviso. Es posible que haya sido eliminado.</p><a href="lista-avisos.html" class="btn btn-primary">Volver a la lista</a></div>`;
        return;
    }

    avisoActivo = avisoData;
    populateUI(avisoActivo); // Rellenar la UI con la información básica.

    const maxCv = avisoActivo.max_cv || 'Ilimitados';

    // Usar el conteo de la URL si está disponible.
    if (countFromUrl !== null && !isNaN(countFromUrl)) {
        postulantesHeader.textContent = `Candidatos Postulados (${countFromUrl} / ${maxCv})`;
    } else {
        // Si no viene en la URL (por ejemplo, si se accede directamente al link),
        // mostramos "Cargando..." y hacemos la consulta como antes.
        postulantesHeader.textContent = `Candidatos Postulados (Cargando... / ${maxCv})`;
        const { count, error } = await supabase
            .from('v2_postulaciones')
            .select('*', { count: 'exact', head: true })
            .eq('aviso_id', id);

        if (error) {
            console.error('Error cargando el conteo de postulantes:', error);
            postulantesHeader.textContent = `Candidatos Postulados (Error / ${maxCv})`;
        } else {
            postulantesHeader.textContent = `Candidatos Postulados (${count} / ${maxCv})`;
        }
    }
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

// --- LÓGICA DE MODALES PARA AÑADIR CANDIDATOS (REFACTORIZADA) ---

// Función genérica para manejar la apertura y lógica de los modales
async function setupModal(modal, contentEl, footerEl, type) {
    showModal(modal.id);
    contentEl.innerHTML = '<p>Cargando...</p>';
    footerEl.innerHTML = ''; // Limpiar footer

    let items; // 'avisos' o 'carpetas'
    if (type === 'aviso') {
        const { data, error } = await supabase.from('v2_avisos').select('id, titulo').neq('id', currentAvisoId);
        if (error) { contentEl.innerHTML = '<p class="text-danger">Error al cargar avisos.</p>'; return; }
        items = data;
    } else { // db
        const { data, error } = await supabase.from('v2_carpetas').select('id, nombre').order('nombre');
        if (error) { contentEl.innerHTML = '<p class="text-danger">Error al cargar carpetas.</p>'; return; }
        items = data;
    }

    const selectLabel = type === 'aviso' ? 'un aviso' : 'una carpeta';
    const allOption = type === 'db' ? '<option value="all">Todos los Candidatos</option>' : '';
    contentEl.innerHTML = `
        <select id="modal-select-${type}" class="form-control">
            <option value="">Selecciona ${selectLabel}...</option>
            ${allOption}
            ${items.map(item => `<option value="${item.id}">${item.titulo || item.nombre}</option>`).join('')}
        </select>
        <div id="modal-candidates-container-${type}" style="margin-top: 1rem;"></div>`;

    const selectEl = document.getElementById(`modal-select-${type}`);
    const candidatesContainer = document.getElementById(`modal-candidates-container-${type}`);

    selectEl.addEventListener('change', async () => {
        const selectedId = selectEl.value;
        if (!selectedId) {
            candidatesContainer.innerHTML = '';
            updateModalFooter(contentEl, footerEl, type);
            return;
        }
        candidatesContainer.innerHTML = '<p>Cargando candidatos...</p>';
        
        let query;
        if (type === 'aviso') {
            query = supabase.from('v2_postulaciones').select('v2_candidatos(id, nombre_candidato)').eq('aviso_id', selectedId);
        } else { // db
            query = supabase.from('v2_candidatos').select('id, nombre_candidato');
            if (selectedId !== 'all') {
                query = query.eq('carpeta_id', selectedId);
            }
        }
        
        const { data, error } = await query;
        if (error) { candidatesContainer.innerHTML = '<p class="text-danger">Error al cargar candidatos.</p>'; return; }

        const candidatos = (type === 'aviso' ? data.map(p => p.v2_candidatos).filter(Boolean) : data)
                           .sort((a, b) => a.nombre_candidato.localeCompare(b.nombre_candidato));

        if (candidatos.length > 0) {
            candidatesContainer.innerHTML = `
                <div class="carpeta-header">
                    <h4>Candidatos</h4>
                    <label class="select-all-folder-label"><input type="checkbox" class="select-all-modal-cb"> Seleccionar Todos</label>
                </div>
                <ul class="candidate-list-modal">
                    ${candidatos.map(c => `<li><label><input type="checkbox" class="candidato-checkbox-${type}" value="${c.id}"> ${c.nombre_candidato}</label></li>`).join('')}
                </ul>`;
        } else {
            candidatesContainer.innerHTML = '<p>No se encontraron candidatos.</p>';
        }
        updateModalFooter(contentEl, footerEl, type);
    });

    // Listener único para cambios dentro del contenido del modal
    contentEl.addEventListener('change', () => updateModalFooter(contentEl, footerEl, type));
    updateModalFooter(contentEl, footerEl, type);
}

// Listeners para abrir los modales
addFromDbBtn.addEventListener('click', () => setupModal(modalAddFromDb, dbModalContent, dbModalFooter, 'db'));
addFromAvisoBtn.addEventListener('click', () => setupModal(modalAddFromAviso, avisoModalContent, avisoModalFooter, 'aviso'));

// Listener de evento delegado en los footers de los modales para la acción de confirmar
[dbModalFooter, avisoModalFooter].forEach(footer => {
    footer.addEventListener('click', (e) => {
        const target = e.target;
        if (target.matches('.confirm-add-btn')) {
            const modal = target.closest('.modal-overlay');
            const type = target.dataset.type;
            const selectedCandidatos = Array.from(modal.querySelectorAll(`.candidato-checkbox-${type}:checked`)).map(cb => cb.value);
            addSelectedCandidatos(selectedCandidatos, modal);
        }
    });
});

function updateModalFooter(modalBody, modalFooter, type) {
    const selectedCount = modalBody.querySelectorAll(`.candidato-checkbox-${type}:checked`).length;
    
    if (selectedCount > 0) {
        modalFooter.innerHTML = `
            <span class="selection-count">${selectedCount} seleccionado(s)</span>
            <div>
                <button type="button" class="btn btn-secondary modal-close-btn">Cancelar</button>
                <button type="button" class="btn btn-primary confirm-add-btn" data-type="${type}">Agregar Seleccionados</button>
            </div>
        `;
    } else {
        modalFooter.innerHTML = `
            <button type="button" class="btn btn-secondary modal-close-btn" style="margin-left: auto;">Cerrar</button>
        `;
    }
}

async function addSelectedCandidatos(selectedIds, fromModal) {
    const modalBody = fromModal.querySelector('.modal-body');
    const modalFooter = fromModal.querySelector('.modal-footer');
    const progressContainer = fromModal.querySelector('#aviso-modal-progress-container');
    const progressBar = fromModal.querySelector('#aviso-modal-progress-bar');
    const statusText = fromModal.querySelector('#aviso-modal-status-text');
    const percentageText = fromModal.querySelector('#aviso-modal-percentage');

    if (selectedIds.length === 0) {
        alert('No has seleccionado ningún candidato.');
        return;
    }

    // 1. Ocultar UI de selección y mostrar UI de progreso
    modalBody.classList.add('hidden');
    modalFooter.classList.add('hidden');
    progressContainer.classList.remove('hidden');
    statusText.textContent = 'Iniciando proceso...';
    progressBar.style.width = '0%';
    percentageText.textContent = '0%';

    try {
        // 2. Verificar candidatos existentes
        statusText.textContent = 'Verificando candidatos existentes...';
        const { data: existingPostulaciones, error: checkError } = await supabase
            .from('v2_postulaciones')
            .select('candidato_id')
            .eq('aviso_id', currentAvisoId)
            .in('candidato_id', selectedIds);

        if (checkError) {
            throw new Error(`Error verificando postulaciones: ${checkError.message}`);
        }

        const existingCandidatoIds = new Set(existingPostulaciones.map(p => p.candidato_id));
        const nuevosCandidatoIds = selectedIds.map(Number).filter(id => !existingCandidatoIds.has(id));
        const existentes = selectedIds.length - nuevosCandidatoIds.length;
        let totalAgregados = 0;

        if (nuevosCandidatoIds.length === 0) {
            statusText.innerHTML = `<strong>Proceso Finalizado</strong><br><br>
                - 0 candidatos fueron agregados.<br>
                - ${existentes} candidato(s) ya se encontraban en la lista.`;
            percentageText.textContent = '';
            progressBar.style.width = '100%';
            progressBar.style.backgroundColor = 'var(--primary-color)';
            modalFooter.innerHTML = `<button type="button" class="btn btn-primary" onclick="window.location.reload()">Cerrar y Recargar</button>`;
            modalFooter.classList.remove('hidden');
            return;
        }

        // 3. Procesar nuevos candidatos en lotes
        const BATCH_SIZE = 50;
        for (let i = 0; i < nuevosCandidatoIds.length; i += BATCH_SIZE) {
            const batchIds = nuevosCandidatoIds.slice(i, i + BATCH_SIZE);
            const progress = i + batchIds.length;
            const percentage = Math.round((progress / nuevosCandidatoIds.length) * 100);

            statusText.textContent = `Procesando ${progress} de ${nuevosCandidatoIds.length} candidatos...`;
            progressBar.style.width = `${percentage}%`;
            percentageText.textContent = `${percentage}% completado`;

            const { data: candidatosData, error: fetchError } = await supabase
                .from('v2_candidatos')
                .select('id, texto_cv_general, nombre_archivo_general, base64_general')
                .in('id', batchIds);

            if (fetchError) throw new Error(`Error obteniendo datos (lote ${i / BATCH_SIZE + 1}): ${fetchError.message}`);

            const nuevasPostulaciones = candidatosData.map(c => ({
                candidato_id: c.id,
                aviso_id: currentAvisoId,
                texto_cv_especifico: c.texto_cv_general,
                nombre_archivo_especifico: c.nombre_archivo_general,
                base64_cv_especifico: c.base64_general,
                calificacion: null
            }));

            const { error: insertError } = await supabase.from('v2_postulaciones').insert(nuevasPostulaciones);
            if (insertError) throw new Error(`Error insertando postulaciones (lote ${i / BATCH_SIZE + 1}): ${insertError.message}`);
            
            totalAgregados += nuevasPostulaciones.length;
        }

        // 4. Mostrar resumen final
        statusText.innerHTML = `<strong>¡Proceso Completado!</strong><br><br>
            - <strong>${totalAgregados}</strong> candidato(s) fueron agregados a la búsqueda.<br>
            - <strong>${existentes}</strong> candidato(s) ya se encontraban en la lista.`;
        progressBar.style.backgroundColor = 'var(--success-color)';
        percentageText.textContent = '¡Éxito!';
        modalFooter.innerHTML = `<button type="button" class="btn btn-primary" onclick="window.location.reload()">Cerrar y Recargar</button>`;
        modalFooter.classList.remove('hidden');

    } catch (error) {
        console.error("Error en el proceso de agregar candidatos:", error);
        statusText.innerHTML = `<strong>Ocurrió un Error</strong><br><br>${error.message}`;
        progressBar.style.backgroundColor = 'var(--danger-color)';
        percentageText.textContent = 'Fallo';
        modalFooter.innerHTML = `<button type="button" class="btn btn-secondary" onclick="window.location.reload()">Cerrar e Intentar de Nuevo</button>`;
        modalFooter.classList.remove('hidden');
    }
}

// Los listeners de los botones de confirmación ahora se añaden dinámicamente en updateModalFooter

// --- LÓGICA DE EDICIÓN DE AVISO ---
editAvisoBtn.addEventListener('click', () => {
    if (!avisoActivo) return;
    showModal('modal-edit-aviso');
    
    // Poblar el formulario con los datos actuales del aviso
    document.getElementById('edit-descripcion').value = avisoActivo.descripcion;
    document.getElementById('edit-max-cv').value = avisoActivo.max_cv || 0;
    
    // Formatear la fecha para el input type="date" (YYYY-MM-DD)
    const fecha = new Date(avisoActivo.valido_hasta);
    const anio = fecha.getUTCFullYear();
    const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getUTCDate()).padStart(2, '0');
    document.getElementById('edit-valido-hasta').value = `${anio}-${mes}-${dia}`;

    renderEditList(document.getElementById('necesarias-list-edit'), avisoActivo.condiciones_necesarias);
    renderEditList(document.getElementById('deseables-list-edit'), avisoActivo.condiciones_deseables);
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
    const maxCvValue = document.getElementById('edit-max-cv').value;
    
    const updatedData = {
        descripcion: document.getElementById('edit-descripcion').value,
        condiciones_necesarias: Array.from(document.getElementById('necesarias-list-edit').children).map(li => li.firstChild.textContent.trim()),
        condiciones_deseables: Array.from(document.getElementById('deseables-list-edit').children).map(li => li.firstChild.textContent.trim()),
        max_cv: maxCvValue ? parseInt(maxCvValue, 10) : null, // Convertir a número o null si está vacío
        valido_hasta: document.getElementById('edit-valido-hasta').value
    };

    // Validar que la fecha no esté vacía
    if (!updatedData.valido_hasta) {
        alert('Por favor, especifica una fecha de validez.');
        return;
    }

    const { error } = await supabase.from('v2_avisos').update(updatedData).eq('id', currentAvisoId);

    if (error) {
        alert('Error al actualizar el aviso.');
    } else {
        alert('Aviso actualizado correctamente.');
        hideModal('modal-edit-aviso');
        await loadAvisoDetails(currentAvisoId);
    }
});
