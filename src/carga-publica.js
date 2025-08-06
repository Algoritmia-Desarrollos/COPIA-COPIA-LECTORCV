// src/carga-publica.js

import { supabase } from './supabaseClient.js';

// --- SELECTORES DEL DOM ---
const fileInput = document.getElementById('file-input');
const cvForm = document.getElementById('cv-form');
const submitBtn = document.getElementById('submit-btn');
const fileLabelText = document.getElementById('file-label-text');
const formView = document.getElementById('form-view');
const successView = document.getElementById('success-view');
const dropZone = document.getElementById('drop-zone');

let selectedFile = null;

// --- MANEJO DE ARCHIVOS (IDÉNTICO AL ANTERIOR) ---

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
    if (file && file.type !== 'application/pdf') alert("Por favor, selecciona un archivo en formato PDF.");
    else if (file && file.size > 5 * 1024 * 1024) alert("El archivo es demasiado grande. El tamaño máximo es de 5MB.");
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
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analizando CV...';

    try {
        const base64 = await fileToBase64(selectedFile);
        
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Extrayendo texto...';
        const textoCV = await extraerTextoDePDF(base64);
        if (!textoCV || textoCV.trim().length < 50) throw new Error("PDF vacío o ilegible.");
        
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Obteniendo contacto...';
        const iaData = await extraerDatosConIA(textoCV);
        if (!iaData.email) throw new Error("No se pudo extraer una dirección de email válida del CV.");

        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando en Base de Datos...';
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
    const { data: candidatoExistente, error: findError } = await supabase
        .from('v2_candidatos')
        .select('id')
        .eq('email', iaData.email)
        .single();

    if (findError && findError.code !== 'PGRST116') {
        throw new Error(`Error al buscar candidato: ${findError.message}`);
    }

    if (candidatoExistente) {
        // --- SI EL CANDIDATO YA EXISTE, ACTUALIZAMOS SU PERFIL ---
        console.log(`Candidato existente encontrado. Actualizando ID: ${candidatoExistente.id}.`);
        const { error: updateError } = await supabase
            .from('v2_candidatos')
            .update({
                nombre_candidato: iaData.nombreCompleto,
                telefono: iaData.telefono,
                base64_general: base64,
                texto_cv_general: textoCV,
                nombre_archivo_general: nombreArchivo,
                updated_at: new Date()
            })
            .eq('id', candidatoExistente.id);

        if (updateError) throw new Error(`Error al actualizar candidato: ${updateError.message}`);

    } else {
        // --- SI EL CANDIDATO ES NUEVO, LO CREAMOS ---
        console.log("Candidato nuevo. Creando registro...");
        const { error: insertError } = await supabase
            .from('v2_candidatos')
            .insert({
                email: iaData.email,
                nombre_candidato: iaData.nombreCompleto,
                telefono: iaData.telefono,
                base64_general: base64,
                texto_cv_general: textoCV,
                nombre_archivo_general: nombreArchivo
            });
        
        if (insertError) throw new Error(`Error al crear candidato: ${insertError.message}`);
    }
}

// Las siguientes funciones son idénticas a las de `src/index.js`
// y se pueden reutilizar, pero las incluimos aquí para que el archivo sea autónomo.

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
    const prompt = `
      Actúa como un experto en RRHH. Analiza el siguiente CV y extrae el nombre completo, email y teléfono.
      Texto: """${textoCVOptimizado}"""
      Responde únicamente con un objeto JSON con claves "nombreCompleto", "email" y "telefono". Si no encuentras un dato, usa null.
    `;
    
    const { data, error } = await supabase.functions.invoke('openai', {
        body: { query: prompt },
    });

    if (error) throw new Error(`Error con el servicio de IA: ${error.message}`);

    try {
        return JSON.parse(data.message);
    } catch (e) {
        throw new Error("La IA devolvió una respuesta con formato inesperado.");
    }
}