// src/carga-masiva.js

import { supabase } from './supabaseClient.js';
import { toTitleCase } from './utils.js'; // Importamos la función de formato

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

    new QRious({ element: qrCanvas, value: link, size: 120 });

    copiarLinkBtn.addEventListener('click', () => {
        linkPublicoInput.select();
        document.execCommand('copy');
        copiarLinkBtn.innerHTML = `<i class="fa-solid fa-check"></i>`;
        setTimeout(() => { copiarLinkBtn.innerHTML = `<i class="fa-solid fa-copy"></i>`; }, 2000);
    });
}

// --- MANEJO DE LA COLA DE CARGA ---

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
            li.className = `queue-item status-${item.status}`;
            li.dataset.id = item.id;
            li.innerHTML = `
                <span class="file-name">${item.file.name}</span>
                <span class="status-badge">${item.status}</span>
                ${item.error ? `<span class="error-message">${item.error}</span>` : ''}
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
    li.className = `queue-item status-${status}`;
    li.querySelector('.status-badge').textContent = status;

    const existingError = li.querySelector('.error-message');
    if (existingError) existingError.remove();

    if (status === 'error' && errorMsg) {
        const errorSpan = document.createElement('span');
        errorSpan.className = 'error-message';
        errorSpan.textContent = errorMsg;
        li.appendChild(errorSpan);
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

    for (const item of fileQueue) {
        if (item.status === 'pendiente') {
            try {
                item.status = 'procesando';
                updateQueueItemUI(item.id, 'procesando');
                
                const base64 = await fileToBase64(item.file);
                const textoCV = await extraerTextoDePDF(base64);
                const iaData = await extraerDatosConIA(textoCV);
                
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
        }
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
            email: iaData.email || 'no-extraido@dominio.com',
            telefono: iaData.telefono,
            base64_general: base64,
            texto_cv_general: textoCV,
            nombre_archivo_general: nombreArchivo,
            carpeta_id: carpetaId,
            updated_at: new Date()
        }, {
            onConflict: 'nombre_candidato'
        });

    if (error) throw new Error(`Error en base de datos: ${error.message}`);
}


// --- FUNCIONES AUXILIARES ---
function fileToBase64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.readAsDataURL(file); r.onload = () => res(r.result); r.onerror = e => rej(e); }); }
async function extraerTextoDePDF(base64) {
    try {
        const pdf = await pdfjsLib.getDocument(base64).promise;
        let textoFinal = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            textoFinal += textContent.items.map(item => item.str).join(' ');
        }
        if (textoFinal.trim().length > 50) return textoFinal.trim().replace(/\x00/g, '');
    } catch (error) { console.warn("Extracción nativa fallida, intentando con OCR.", error); }
    try {
        const worker = await Tesseract.createWorker('spa');
        const { data: { text } } = await worker.recognize(base64);
        await worker.terminate();
        return text || "Texto no legible por OCR";
    } catch (error) {
        console.error("Error de OCR:", error);
        return "El contenido del PDF no pudo ser leído.";
    }
}
async function extraerDatosConIA(texto) {
    const prompt = `Actúa como un experto en RRHH. Analiza este CV y extrae nombre completo, email y teléfono. Texto: """${texto.substring(0,4000)}""" Responde solo con JSON con claves "nombreCompleto", "email" y "telefono". Si no encuentras un dato, usa null.`;
    try {
        const { data, error } = await supabase.functions.invoke('openaiv2', { body: { query: prompt } });
        if (error) throw error;
        return JSON.parse(data.message);
    } catch (e) {
        console.error("Error al contactar o parsear la respuesta de la IA:", e);
        return { nombreCompleto: null, email: null, telefono: null };
    }
}