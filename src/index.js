// src/index.js

import { supabase } from './supabaseClient.js';
import { toTitleCase } from './utils.js'; // Importamos nuestra función de formato

// --- SELECTORES DEL DOM ---
const fileInput = document.getElementById('file-input');
const cvForm = document.getElementById('cv-form');
const submitBtn = document.getElementById('submit-btn');
const fileLabelText = document.getElementById('file-label-text');
const formView = document.getElementById('form-view');
const successView = document.getElementById('success-view');
const avisoContainer = document.getElementById('aviso-titulo');
const dropZone = document.getElementById('drop-zone');

let avisoActivo = null;
let selectedFile = null;

// --- INICIALIZACIÓN ---
window.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const avisoId = parseInt(urlParams.get('avisoId'), 10);

    if (!avisoId) {
        avisoContainer.textContent = 'Link de postulación inválido.';
        cvForm.classList.add('hidden');
        return;
    }
    
    const { data: aviso, error } = await supabase
        .from('v2_avisos')
        .select('id, titulo')
        .eq('id', avisoId)
        .single();

    if (error || !aviso) {
        console.error("Error al buscar el aviso:", error);
        avisoContainer.textContent = 'Esta búsqueda laboral no fue encontrada.';
        cvForm.classList.add('hidden');
        return;
    }
    
    avisoActivo = aviso;
    avisoContainer.textContent = `Postúlate para: ${avisoActivo.titulo}`;
});

// --- MANEJO DE ARCHIVOS ---
function handleFile(file) {
  if (file && file.type === 'application/pdf' && file.size <= 5 * 1024 * 1024) {
    selectedFile = file;
    fileLabelText.textContent = `Archivo seleccionado: ${selectedFile.name}`;
    submitBtn.disabled = false;
    dropZone.classList.remove('drag-over');
  } else {
    selectedFile = null;
    submitBtn.disabled = true;
    fileLabelText.textContent = 'Arrastra y suelta tu CV aquí o haz clic para seleccionar';
    if (file) alert("Por favor, selecciona un archivo PDF de menos de 5MB.");
  }
}

fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); });


// --- LÓGICA DE ENVÍO DEL FORMULARIO ---
cvForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedFile || !avisoActivo) return;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analizando CV...';

    try {
        const base64 = await fileToBase64(selectedFile);
        
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Extrayendo texto...';
        const textoCV = await extraerTextoDePDF(base64);
        
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Obteniendo contacto...';
        const iaData = await extraerDatosConIA(textoCV);
        
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando postulación...';
        await procesarCandidatoYPostulacion(iaData, base64, textoCV, selectedFile.name, avisoActivo.id);
        
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

async function procesarCandidatoYPostulacion(iaData, base64, textoCV, nombreArchivo, avisoId) {
    // ===== LÓGICA CORRECTA: Usamos el nombre formateado como identificador =====
    const formattedName = toTitleCase(iaData.nombreCompleto);
    if (!formattedName) throw new Error("No se pudo extraer un nombre válido del CV.");

    // Usamos 'upsert' para crear o actualizar el candidato en un solo paso, evitando duplicados por nombre.
    const { data: candidato, error: upsertError } = await supabase
        .from('v2_candidatos')
        .upsert({
            nombre_candidato: formattedName,
            email: iaData.email,
            telefono: iaData.telefono,
            base64_general: base64,
            texto_cv_general: textoCV,
            nombre_archivo_general: nombreArchivo,
            updated_at: new Date()
        }, {
            onConflict: 'nombre_candidato' // Le decimos a Supabase que el nombre es la clave para detectar conflictos
        })
        .select('id')
        .single();
    
    if (upsertError) throw new Error(`Error al procesar candidato: ${upsertError.message}`);

    // Ahora creamos la postulación con el ID del candidato (sea nuevo o existente)
    const { error: postulaError } = await supabase
        .from('v2_postulaciones')
        .insert({
            candidato_id: candidato.id,
            aviso_id: avisoId,
            base64_cv_especifico: base64,
            texto_cv_especifico: textoCV
        });

    if (postulaError) {
      if (postulaError.code === '23505') { // Código de error para violación de constraint UNIQUE
        console.warn('El candidato ya se había postulado a este aviso. Se actualizó su perfil general.');
      } else {
        throw new Error(`Error al guardar postulación: ${postulaError.message}`);
      }
    }
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
    const pdf = await pdfjsLib.getDocument(base64).promise;
    let textoFinal = '';
    try {
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            textoFinal += textContent.items.map(item => item.str).join(' ');
        }
        if (textoFinal.trim().length > 100) return textoFinal.trim().replace(/\x00/g, '');
    } catch (error) { console.warn("Fallo en extracción nativa, intentando OCR.", error); }
    
    try {
        textoFinal = '';
        const worker = await Tesseract.createWorker('spa');
        const { data: { text } } = await worker.recognize(base64);
        await worker.terminate();
        return text;
    } catch (error) { throw new Error("No se pudo leer el contenido del PDF."); }
}

async function extraerDatosConIA(textoCV) {
    const textoCVOptimizado = textoCV.substring(0, 4000);
    const prompt = `Actúa como un experto en RRHH. Analiza el siguiente CV y extrae nombre completo, email y teléfono. Texto: """${textoCVOptimizado}""" Responde únicamente con un objeto JSON con claves "nombreCompleto", "email" y "telefono". Si no encuentras un dato, usa null.`;
    
    // ===== CORRECCIÓN IMPORTANTE: Asegúrate de llamar a la función de IA correcta. Si la renombraste a "openaiv2", cámbialo aquí. =====
    const { data, error } = await supabase.functions.invoke('openaiv2', { body: { query: prompt } });
    if (error) throw new Error(`Error con el servicio de IA: ${error.message}`);
    try { return JSON.parse(data.message); }
    catch (e) { throw new Error("La IA devolvió una respuesta con formato inesperado."); }
}