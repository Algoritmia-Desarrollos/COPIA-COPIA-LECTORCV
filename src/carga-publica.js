// src/carga-publica.js

import { supabase } from './supabaseClient.js';
import { toTitleCase, extractTextFromFile } from './utils.js'; // Importamos las funciones de formato y extracción

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
  const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  const maxSize = 5 * 1024 * 1024; // 5MB

  if (file && validTypes.includes(file.type) && file.size <= maxSize) {
    selectedFile = file;
    dropZone.classList.add('file-selected');
    
    let iconClass = 'fa-solid fa-file-lines'; // Icono por defecto
    if (file.type === 'application/pdf') {
      iconClass = 'fa-solid fa-file-pdf';
    } else if (file.type.startsWith('image/')) {
      iconClass = 'fa-solid fa-file-image';
    }

    fileLabelText.innerHTML = `
      <i class="${iconClass}" style="color: var(--success-color); font-size: 2rem; margin-bottom: 0.5rem;"></i>
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
      <span class="upload-hint">PDF o Imagen (JPG, PNG), máx: 5MB</span>
    `;
    if (file) {
      alert("Por favor, selecciona un archivo PDF o de imagen (JPG, PNG) de menos de 5MB.");
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
        // La nueva función maneja el archivo directamente
        const textoCV = await extractTextFromFile(selectedFile);
        const iaData = await extraerDatosConIA(textoCV);

        // Convertimos a base64 solo si es necesario para el almacenamiento
        const base64 = await fileToBase64(selectedFile);
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

    const publicUserId = '3973abe3-ca7c-4a7c-b51a-f5024731bb6c';

    // Usamos 'upsert' para crear o actualizar el candidato en un solo paso.
    const { error } = await supabase
        .from('v2_candidatos')
        .upsert({
            user_id: publicUserId,
            nombre_candidato: nombreFormateado,
            email: iaData.email || `no-extraido-${Date.now()}@dominio.com`,
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
