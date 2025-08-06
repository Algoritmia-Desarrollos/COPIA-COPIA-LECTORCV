// src/carga-publica.js

import { supabase } from './supabaseClient.js';
import { toTitleCase } from './utils.js'; // Importamos la función de formato

// --- SELECTORES DEL DOM ---
const fileInput = document.getElementById('file-input');
const cvForm = document.getElementById('cv-form');
const submitBtn = document.getElementById('submit-btn');
const fileLabelText = document.getElementById('file-label-text');
const formView = document.getElementById('form-view');
const successView = document.getElementById('success-view');
const dropZone = document.getElementById('drop-zone');

let selectedFile = null;

// --- MANEJO DE ARCHIVOS ---
function handleFile(file) {
  if (file && file.type === 'application/pdf' && file.size <= 5 * 1024 * 1024) {
    selectedFile = file;
    dropZone.classList.add('file-selected');
    fileLabelText.innerHTML = `
      <i class="fa-solid fa-file-pdf" style="color: var(--success-color); font-size: 2rem; margin-bottom: 0.5rem;"></i>
      <span class="file-name">${selectedFile.name}</span>
      <span class="upload-hint" style="margin-top: 0.5rem;">¡Listo para enviar!</span>
    `;
    submitBtn.disabled = false;
    dropZone.classList.remove('drag-over');
  } else {
    selectedFile = null;
    submitBtn.disabled = true;
    dropZone.classList.remove('file-selected');
    fileLabelText.innerHTML = `
      <i class="fa-solid fa-cloud-arrow-up upload-icon"></i>
      <span class="upload-text">Arrastra y suelta tu CV aquí o haz clic para seleccionar</span>
      <span class="upload-hint">Solo archivos PDF, tamaño máximo: 5MB</span>
    `;
    if (file) {
      alert("Por favor, selecciona un archivo PDF de menos de 5MB.");
    }
  }
}

fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); });


// --- LÓGICA DE ENVÍO DEL FORMULARIO ---
cvForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedFile) return;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

    try {
        const base64 = await fileToBase64(selectedFile);
        const textoCV = await extraerTextoDePDF(base64);
        const iaData = await extraerDatosConIA(textoCV);

        await procesarCandidato(iaData, base64, textoCV, selectedFile.name);
        
        formView.classList.add('hidden');
        successView.classList.remove('hidden');

    } catch (error) {
        console.error("Error en el proceso de carga:", error);
        alert(`No se pudo procesar el archivo: ${error.message}`);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reintentar Envío';
    }
});


// --- FUNCIONES AUXILIARES ---

/**
 * Lógica para crear o actualizar un candidato en la base de talentos.
 */
async function procesarCandidato(iaData, base64, textoCV, nombreArchivo) {
    // ===== LÓGICA DE ACEPTACIÓN GARANTIZADA =====
    let nombreFormateado = toTitleCase(iaData.nombreCompleto);
    
    if (!nombreFormateado) {
        nombreFormateado = `Candidato No Identificado ${Date.now()}`;
    }

    // Usamos 'upsert' para crear o actualizar el candidato en un solo paso.
    const { error } = await supabase
        .from('v2_candidatos')
        .upsert({
            nombre_candidato: nombreFormateado,
            email: iaData.email || 'no-extraido@dominio.com',
            telefono: iaData.telefono,
            base64_general: base64,
            texto_cv_general: textoCV,
            nombre_archivo_general: nombreArchivo,
            updated_at: new Date()
        }, {
            onConflict: 'nombre_candidato' // La clave para evitar duplicados es el nombre
        });

    if (error) throw new Error(`Error en base de datos: ${error.message}`);
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

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
    } catch (error) {
        console.warn("Extracción nativa fallida, intentando con OCR.", error);
    }
    
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

async function extraerDatosConIA(textoCV) {
    const textoCVOptimizado = textoCV.substring(0, 4000);
    const prompt = `Actúa como un experto en RRHH. Analiza el siguiente CV y extrae nombre completo, email y teléfono. Texto: """${textoCVOptimizado}""" Responde únicamente con un objeto JSON con claves "nombreCompleto", "email" y "telefono". Si no encuentras un dato, usa null.`;
    
    try {
        const { data, error } = await supabase.functions.invoke('openaiv2', { body: { query: prompt } });
        if (error) throw error;
        return JSON.parse(data.message);
    } catch (e) {
        console.error("Error al contactar o parsear la respuesta de la IA:", e);
        return { nombreCompleto: null, email: null, telefono: null };
    }
}
