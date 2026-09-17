// src/carga-masiva.js

import { supabase } from './supabaseClient.js';
import { llamarFuncion } from './api.js';
import { extractTextFromFile, fileToBase64, escapeHtml, copiarAlPortapapeles } from './utils.js';

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
    setupPublicLink();

    // Listeners de eventos
    fileInput.addEventListener('change', handleFileSelection);
    processQueueBtn.addEventListener('click', processQueue);
    clearQueueBtn.addEventListener('click', clearFinishedItems);

    await loadFoldersIntoSelect();
});

/**
 * Carga las carpetas del usuario en el selector.
 */
async function loadFoldersIntoSelect() {
    const { data: folders, error } = await supabase.from('v2_carpetas').select('id, nombre').order('nombre');
    if (error) {
        console.error("Error cargando carpetas", error);
        return;
    }
    folderSelect.innerHTML = '<option value="">Sin carpeta</option>' +
        folders.map(folder => `<option value="${folder.id}">${escapeHtml(folder.nombre)}</option>`).join('');
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

    copiarLinkBtn.addEventListener('click', async () => {
        await copiarAlPortapapeles(link, linkPublicoInput);
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

async function getFileHash(file) {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleFileSelection(e) {
    const files = Array.from(e.target.files);
    for (const file of files) {
        const hash = await getFileHash(file);
        if (!fileQueue.some(item => item.hash === hash)) {
            fileQueue.push({
                id: `file-${Date.now()}-${Math.random()}`,
                file: file,
                hash: hash,
                status: 'pendiente',
                error: null
            });
        }
    }
    renderQueue();
    fileInput.value = '';
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
                    <span class="file-name">${escapeHtml(item.file.name)}</span>
                    ${item.error ? `<span class="error-message">${escapeHtml(item.error)}</span>` : ''}
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
    const selectedFolderId = folderSelect.value ? parseInt(folderSelect.value, 10) : null;
    const CONCURRENCY_LIMIT = 4;
    let siguiente = 0;

    const procesarSiguiente = async () => {
        while (siguiente < itemsToProcess.length) {
            const item = itemsToProcess[siguiente++];
            try {
                item.status = 'procesando';
                updateQueueItemUI(item.id, 'procesando');

                const textoCV = await extractTextFromFile(item.file);
                const base64 = await fileToBase64(item.file);
                await llamarFuncion('guardar-cv', {
                    carpetaId: selectedFolderId,
                    texto: textoCV,
                    archivo: { nombre: item.file.name, tipo: item.file.type, base64 },
                });

                item.status = 'exito';
                updateQueueItemUI(item.id, 'exito');
            } catch (error) {
                console.error(`Fallo en ${item.file.name}:`, error);
                item.status = 'error';
                item.error = error.message;
                updateQueueItemUI(item.id, 'error', error.message);
            }
        }
    };

    // Varios archivos a la vez: cuando uno termina, arranca el siguiente.
    await Promise.all(Array.from({ length: CONCURRENCY_LIMIT }, procesarSiguiente));

    isProcessing = false;
    renderQueue();
}
