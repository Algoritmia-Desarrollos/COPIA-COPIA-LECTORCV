// src/carga-masiva.js

import { supabase } from './supabaseClient.js';

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

    // Limpiar mensaje de error antiguo
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
                if (!textoCV || textoCV.trim().length < 50) throw new Error("PDF vacío o ilegible.");
                
                const iaData = await extraerDatosConIA(textoCV);
                if (!iaData.email) throw new Error("No se pudo extraer un email válido del CV.");
                
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
    const formattedName = toTitleCase(iaData.nombreCompleto);
    if (!formattedName) throw new Error("El nombre extraído del CV no es válido.");

    const { data: candidatoExistente, error: findError } = await supabase
        .from('v2_candidatos')
        .select('id, email')
        .eq('nombre_candidato', formattedName)
        .maybeSingle();

    if (findError) throw new Error(`Error al buscar candidato: ${findError.message}`);

    const candidatoData = {
        nombre_candidato: formattedName,
        telefono: iaData.telefono,
        email: iaData.email,
        base64_general: base64,
        texto_cv_general: textoCV,
        nombre_archivo_general: nombreArchivo,
        carpeta_id: carpetaId,
        updated_at: new Date().toISOString()
    };

    let error;
    // Si existe un candidato con el mismo nombre
    if (candidatoExistente) {
        // Si el email también coincide, lo actualizamos
        if (candidatoExistente.email === iaData.email) {
            ({ error } = await supabase.from('v2_candidatos').update(candidatoData).eq('id', candidatoExistente.id));
        } else {
            // Si el email es diferente, creamos uno nuevo
            ({ error } = await supabase.from('v2_candidatos').insert(candidatoData));
        }
    } else {
        // Si no existe, lo creamos
        ({ error } = await supabase.from('v2_candidatos').insert(candidatoData));
    }

    if (error) throw new Error(`Error en base de datos: ${error.message}`);
}

// --- FUNCIONES AUXILIARES ---
function toTitleCase(str) {
    if (!str || typeof str !== 'string') return null;
    return str.toLowerCase().trim().replace(/\s+/g, ' ').split(' ').map(word => {
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
}

function fileToBase64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.readAsDataURL(file); r.onload = () => res(r.result); r.onerror = e => rej(e); }); }
async function extraerTextoDePDF(base64) { const pdf = await pdfjsLib.getDocument(base64).promise; let txt = ''; try { for (let i = 1; i <= pdf.numPages; i++) { const p = await pdf.getPage(i); const tc = await p.getTextContent(); txt += tc.items.map(it => it.str).join(' '); } if (txt.trim().length > 100) return txt.trim().replace(/\x00/g, ''); } catch (e) { console.warn("Fallo en extracción nativa", e); } try { const w = await Tesseract.createWorker('spa'); const { data: { text } } = await w.recognize(base64); await w.terminate(); return text; } catch (e) { throw new Error("No se pudo leer el PDF."); } }
async function extraerDatosConIA(texto) { const p = `Actúa como experto en RRHH. Analiza este CV y extrae nombre, email y teléfono. Texto: """${texto.substring(0,4000)}""" Responde solo con JSON con claves "nombreCompleto", "email", "telefono". Si no encuentras un dato, usa null.`; const { data, error } = await supabase.functions.invoke('openaiv2', { body: { query: p } }); if (error) throw new Error(`Error IA: ${error.message}`); try { return JSON.parse(data.message); } catch (e) { throw new Error("La IA devolvió una respuesta inesperada."); } }
