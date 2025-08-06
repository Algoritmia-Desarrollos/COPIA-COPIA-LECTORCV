// src/index.js

import { supabase } from './supabaseClient.js';
import { toTitleCase } from './utils.js';

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
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

    try {
        const base64 = await fileToBase64(selectedFile);
        // Pasamos el objeto 'File' para la extracción de texto, es más robusto
        const textoCV = await extraerTextoDePDF(selectedFile); 
        const iaData = await extraerDatosConIA(textoCV);
        
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
    let nombreFormateado = toTitleCase(iaData.nombreCompleto);
    
    if (!nombreFormateado) {
        nombreFormateado = `Candidato No Identificado ${Date.now()}`;
    }

    const { data: candidato, error: upsertError } = await supabase
        .from('v2_candidatos')
        .upsert({
            nombre_candidato: nombreFormateado,
            email: iaData.email || `no-extraido-${Date.now()}@dominio.com`,
            telefono: iaData.telefono,
            base64_general: base64,
            texto_cv_general: textoCV,
            nombre_archivo_general: nombreArchivo,
            updated_at: new Date()
        }, {
            onConflict: 'nombre_candidato'
        })
        .select('id')
        .single();
    
    if (upsertError) throw new Error(`Error al procesar candidato: ${upsertError.message}`);

    const { error: postulaError } = await supabase
        .from('v2_postulaciones')
        .insert({
            candidato_id: candidato.id,
            aviso_id: avisoId,
            base64_cv_especifico: base64,
            texto_cv_especifico: textoCV,
            nombre_archivo_especifico: nombreArchivo
        });

    if (postulaError) {
      if (postulaError.code === '23505') {
        // En lugar de una alerta, podemos simplemente registrarlo o no hacer nada.
        console.warn('El candidato ya se había postulado a este aviso. Su perfil ha sido actualizado.');
      } else {
        throw new Error(`Error al guardar la postulación: ${postulaError.message}`);
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

/**
 * Función de extracción de texto mejorada.
 * @param {File} file - El objeto File del CV.
 * @returns {Promise<string>} El texto extraído.
 */
async function extraerTextoDePDF(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        let textoFinal = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            textoFinal += textContent.items.map(item => item.str).join(' ');
        }
        if (textoFinal.trim().length > 50) return textoFinal.trim().replace(/\x00/g, '');
    } catch (error) {
        console.warn("Extracción nativa de texto fallida, intentando con OCR.", error);
    }
    
    try {
        const { data: { text } } = await Tesseract.recognize(file, 'spa');
        return text || "Texto no legible por OCR";
    } catch (error) {
        console.error("Error de OCR:", error);
        return "El contenido del PDF no pudo ser leído.";
    }
}

async function extraerDatosConIA(textoCV) {
    const textoCVOptimizado = textoCV.substring(0, 4000);
    const prompt = `Actúa como un experto en RRHH. Analiza el siguiente CV y extrae el nombre completo, el email principal y el teléfono de contacto. Texto del CV: """${textoCVOptimizado}""" Responde únicamente con un objeto JSON con las claves "nombreCompleto", "email" y "telefono". Si no encuentras un dato, usa null.`;
    
    try {
        const { data, error } = await supabase.functions.invoke('openaiv2', { body: { query: prompt } });
        if (error) throw error;
        return JSON.parse(data.message);
    } catch (e) {
        console.error("Error al contactar o parsear la respuesta de la IA:", e);
        // Devolvemos un objeto vacío para que el flujo principal no se detenga.
        return { nombreCompleto: null, email: null, telefono: null };
    }
}