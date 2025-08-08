// src/carga-masiva.js

import { supabase } from './supabaseClient.js';
import { toTitleCase, extractTextFromFile } from './utils.js'; // Importamos las funciones de formato y extracción

// --- SELECTORES DEL DOM ---
const fileInput = document.getElementById('file-input-masivo');
const folderSelect = document.getElementById('folder-select-masivo');
const queueList = document.getElementById('upload-queue-list');
const processQueueBtn = document.getElementById('process-queue-btn');
const processQueueBtnText = processQueueBtn.querySelector('span');
const clearQueueBtn = document.getElementById('clear-queue-btn');

// Elementos del link público
const linkPublicoInput = document.getElementById('link-publico');
const copiarLinkBtn = document.getElementById('copiar-link-btn');
const abrirLinkBtn = document.getElementById('abrir-link-btn');
const qrCanvas = document.getElementById('qr-canvas');

// --- ESTADO DE LA APLICACIÓN ---
let fileQueue = []; // Usaremos un array en memoria para la cola
let isProcessing = false;

// --- INICIALIZACIÓN ---
window.addEventListener('DOMContentLoaded', async () => {
    await loadFoldersIntoSelect();
    setupPublicLink();

    // Listeners de eventos
    fileInput.addEventListener('change', handleFileSelection);
    processQueueBtn.addEventListener('click', processQueue);
    clearQueueBtn.addEventListener('click', clearFinishedItems);
});

/**
 * Carga las carpetas del usuario en el selector.
 */
async function loadFoldersIntoSelect() {
    const { data: folders, error } = await supabase.from('v2_carpetas').select('*').order('nombre');
    if (error) {
        console.error("Error cargando carpetas", error);
        return;
    }
    folderSelect.innerHTML = '<option value="">Sin carpeta</option>';
    folders.forEach(folder => {
        folderSelect.innerHTML += `<option value="${folder.id}">${folder.nombre}</option>`;
    });
}

/**
 * Genera y configura el link público y el código QR.
 */
function setupPublicLink() {
    const path = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
    const link = `${window.location.origin}${path}/carga-publica.html`;
    linkPublicoInput.value = link;
    abrirLinkBtn.href = link;

    new QRious({ element: qrCanvas, value: link, size: 120 });

    copiarLinkBtn.addEventListener('click', () => {
        linkPublicoInput.select();
        document.execCommand('copy');
        copiarLinkBtn.innerHTML = `<i class="fa-solid fa-check"></i>`;
        setTimeout(() => { copiarLinkBtn.innerHTML = `<i class="fa-solid fa-copy"></i>`; }, 2000);
    });
}

// --- MANEJO DE LA COLA DE CARGA ---

function getStatusInfo(status) {
    switch (status) {
        case 'pendiente':
            return { icon: 'fa-regular fa-clock', text: 'Pendiente' };
        case 'procesando':
            return { icon: 'fa-solid fa-spinner fa-spin', text: 'Procesando' };
        case 'exito':
            return { icon: 'fa-solid fa-check-circle', text: 'Éxito' };
        case 'error':
            return { icon: 'fa-solid fa-times-circle', text: 'Error' };
        default:
            return { icon: 'fa-solid fa-question-circle', text: 'Desconocido' };
    }
}

function handleFileSelection(e) {
    const files = Array.from(e.target.files);
    files.forEach(file => {
        // Evitar duplicados en la cola
        if (!fileQueue.some(item => item.file.name === file.name)) {
            fileQueue.push({
                id: `file-${Date.now()}-${Math.random()}`,
                file: file,
                status: 'pendiente', // Estados: pendiente, procesando, exito, error
                error: null
            });
        }
    });
    renderQueue();
    fileInput.value = ''; // Resetear para poder seleccionar el mismo archivo de nuevo
}

function renderQueue() {
    if (fileQueue.length === 0) {
        queueList.innerHTML = '<li class="queue-item-empty">La cola de carga está vacía.</li>';
    } else {
        queueList.innerHTML = '';
        fileQueue.forEach(item => {
            const li = document.createElement('li');
            const statusInfo = getStatusInfo(item.status);
            li.className = `queue-item status-${item.status}`;
            li.dataset.id = item.id;
            li.innerHTML = `
                <div class="status-icon"><i class="fa-fw ${statusInfo.icon}"></i></div>
                <div class="file-details">
                    <span class="file-name">${item.file.name}</span>
                    ${item.error ? `<span class="error-message">${item.error}</span>` : ''}
                </div>
                <span class="status-badge">${statusInfo.text}</span>
            `;
            queueList.appendChild(li);
        });
    }

    const hasPending = fileQueue.some(item => item.status === 'pendiente');
    processQueueBtn.disabled = !hasPending || isProcessing;
    processQueueBtnText.textContent = isProcessing ? 'Procesando...' : 'Iniciar Carga';
}

function updateQueueItemUI(id, status, errorMsg = null) {
    const li = queueList.querySelector(`[data-id="${id}"]`);
    if (!li) return;

    const statusInfo = getStatusInfo(status);
    li.className = `queue-item status-${status}`;
    
    const iconEl = li.querySelector('.status-icon i');
    if (iconEl) {
        iconEl.className = `fa-fw ${statusInfo.icon}`;
    }

    const badgeEl = li.querySelector('.status-badge');
    if (badgeEl) {
        badgeEl.textContent = statusInfo.text;
    }

    const fileDetailsEl = li.querySelector('.file-details');
    if (fileDetailsEl) {
        const existingError = fileDetailsEl.querySelector('.error-message');
        if (existingError) existingError.remove();

        if (status === 'error' && errorMsg) {
            const errorSpan = document.createElement('span');
            errorSpan.className = 'error-message';
            errorSpan.textContent = errorMsg;
            fileDetailsEl.appendChild(errorSpan);
        }
    }
}

function clearFinishedItems() {
    fileQueue = fileQueue.filter(item => item.status === 'pendiente' || item.status === 'procesando');
    renderQueue();
}

// --- PROCESAMIENTO DE LA COLA ---

async function processQueue() {
    isProcessing = true;
    renderQueue();

    const itemsToProcess = fileQueue.filter(item => item.status === 'pendiente');
    const CONCURRENCY_LIMIT = 15;

    for (let i = 0; i < itemsToProcess.length; i += CONCURRENCY_LIMIT) {
        const batch = itemsToProcess.slice(i, i + CONCURRENCY_LIMIT);
        
        const promises = batch.map(async (item) => {
            try {
                item.status = 'procesando';
                updateQueueItemUI(item.id, 'procesando');
                
                const textoCV = await extractTextFromFile(item.file);
                const iaData = await extraerDatosConIA(textoCV);
                
                const base64 = await fileToBase64(item.file);
                const selectedFolderId = folderSelect.value ? parseInt(folderSelect.value, 10) : null;
                await procesarCandidato(iaData, base64, textoCV, item.file.name, selectedFolderId);

                item.status = 'exito';
                updateQueueItemUI(item.id, 'exito');

            } catch (error) {
                console.error(`Fallo en ${item.file.name}:`, error);
                item.status = 'error';
                item.error = error.message;
                updateQueueItemUI(item.id, 'error', error.message);
            }
        });

        await Promise.all(promises);
    }

    isProcessing = false;
    renderQueue();
}

/**
 * Lógica para crear o actualizar un candidato en la base de talentos.
 */
async function procesarCandidato(iaData, base64, textoCV, nombreArchivo, carpetaId) {
    let nombreFormateado = toTitleCase(iaData.nombreCompleto);
    if (!nombreFormateado) {
        nombreFormateado = `Candidato No Identificado ${Date.now()}`;
    }

    const { error } = await supabase
        .from('v2_candidatos')
        .upsert({
            nombre_candidato: nombreFormateado,
            email: iaData.email || `no-extraido-${Date.now()}@dominio.com`,
            telefono: iaData.telefono,
            base64_general: base64,
            texto_cv_general: textoCV,
            nombre_archivo_general: nombreArchivo,
            carpeta_id: carpetaId,
            updated_at: new Date()
        }, {
            onConflict: 'nombre_candidato' // Corregido para consistencia
        });

    if (error) throw new Error(`Error en base de datos: ${error.message}`);
}


// --- FUNCIONES AUXILIARES ---
function fileToBase64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.readAsDataURL(file); r.onload = () => res(r.result); r.onerror = e => rej(e); }); }
async function extraerDatosConIA(texto) {
    const textoLimpio = texto.replace(/\s+/g, ' ').trim();
    const prompt = `
Actúa como un asistente de extracción de datos altamente preciso. Tu única tarea es analizar el siguiente texto de un CV y extraer el nombre completo, la dirección de email y el número de teléfono.

**Instrucciones Clave:**
1.  **Nombre Completo:** Busca el nombre más prominente, usualmente ubicado al principio del documento.
2.  **Email:** Busca un texto que siga el formato de un correo electrónico (ej: texto@dominio.com). Sé flexible con los espacios que puedan haberse colado (ej: texto @ dominio . com).
3.  **Teléfono:** Busca secuencias de números que parezcan un número de teléfono. Pueden incluir prefijos (+54), paréntesis, guiones o espacios. Prioriza números de móvil si hay varios.

**Texto del CV a Analizar:**
"""
${textoLimpio.substring(0, 4000)}
"""

**Formato de Salida Obligatorio:**
Responde únicamente con un objeto JSON válido con las claves "nombreCompleto", "email" y "telefono". Si no puedes encontrar un dato de forma confiable, usa el valor \`null\`. No incluyas ninguna otra explicación o texto fuera del JSON.
`;
    try {
        const { data, error } = await supabase.functions.invoke('openaiv2', { body: { query: prompt } });
        if (error) throw error;
        return JSON.parse(data.message);
    } catch (e) {
        console.error("Error al contactar o parsear la respuesta de la IA:", e);
        return { nombreCompleto: null, email: null, telefono: null };
    }
}
