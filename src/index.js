// src/index.js

// Importamos el cliente de Supabase que acabamos de crear.
import { supabase } from './supabaseClient.js';

// --- SELECTORES DE ELEMENTOS DEL DOM ---
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

// --- INICIALIZACIÓN DE LA PÁGINA ---
// Al cargar la página, obtenemos el ID del aviso desde la URL y mostramos su título.
window.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const avisoId = parseInt(urlParams.get('avisoId'), 10);

    if (!avisoId) {
        avisoContainer.textContent = 'Link de postulación inválido.';
        cvForm.classList.add('hidden');
        return;
    }
    
    // Consultamos la nueva tabla v2_avisos
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


// --- MANEJO DE ARCHIVOS (DRAG & DROP Y SELECCIÓN) ---

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
    if (file && file.type !== 'application/pdf') {
      alert("Por favor, selecciona un archivo en formato PDF.");
    } else if (file && file.size > 5 * 1024 * 1024) {
      alert("El archivo es demasiado grande. El tamaño máximo es de 5MB.");
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
    if (!selectedFile || !avisoActivo) return;

    // Deshabilitar el botón y mostrar estado de carga
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analizando CV...';

    try {
        // 1. Convertir el archivo a Base64
        const base64 = await fileToBase64(selectedFile);
        
        // 2. Extraer el texto del PDF
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Extrayendo texto...';
        const textoCV = await extraerTextoDePDF(base64);
        if (!textoCV || textoCV.trim().length < 50) {
            throw new Error("El contenido del PDF está vacío o no se pudo leer.");
        }

        // 3. Extraer datos de contacto con IA
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Obteniendo contacto...';
        const iaData = await extraerDatosConIA(textoCV);
        if (!iaData.email) {
            throw new Error("No se pudo extraer una dirección de email válida del CV. Por favor, asegúrate de que sea legible.");
        }

        // 4. Guardar en la base de datos (lógica anti-duplicados)
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando postulación...';
        await procesarCandidatoYPostulacion(iaData, base64, textoCV, selectedFile.name, avisoActivo.id);
        
        // 5. Mostrar mensaje de éxito
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
 * Lógica principal para crear/actualizar candidatos y registrar la postulación.
 */
async function procesarCandidatoYPostulacion(iaData, base64, textoCV, nombreArchivo, avisoId) {
    // Buscamos si ya existe un candidato con el mismo email.
    const { data: candidatoExistente, error: findError } = await supabase
        .from('v2_candidatos')
        .select('id')
        .eq('email', iaData.email)
        .single();

    if (findError && findError.code !== 'PGRST116') { // PGRST116 = No rows found, lo cual es normal.
        throw new Error(`Error al buscar candidato: ${findError.message}`);
    }

    let candidatoId;

    if (candidatoExistente) {
        // --- SI EL CANDIDATO YA EXISTE ---
        console.log(`Candidato existente encontrado con ID: ${candidatoExistente.id}. Actualizando CV general.`);
        candidatoId = candidatoExistente.id;
        
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
            .eq('id', candidatoId);

        if (updateError) throw new Error(`Error al actualizar candidato: ${updateError.message}`);

    } else {
        // --- SI EL CANDIDATO ES NUEVO ---
        console.log("Candidato nuevo. Creando registro...");
        
        const { data: nuevoCandidato, error: insertError } = await supabase
            .from('v2_candidatos')
            .insert({
                email: iaData.email,
                nombre_candidato: iaData.nombreCompleto,
                telefono: iaData.telefono,
                base64_general: base64,
                texto_cv_general: textoCV,
                nombre_archivo_general: nombreArchivo
            })
            .select('id')
            .single();

        if (insertError) throw new Error(`Error al crear candidato: ${insertError.message}`);
        candidatoId = nuevoCandidato.id;
    }

    // --- REGISTRAR LA POSTULACIÓN ---
    // Usamos 'upsert' por si el usuario intenta postularse de nuevo al mismo aviso.
    // Esto actualizará la postulación existente en lugar de fallar.
    console.log(`Registrando postulación para candidato ID: ${candidatoId} y aviso ID: ${avisoId}`);
    
    const { error: postulaError } = await supabase
        .from('v2_postulaciones')
        .upsert({
            candidato_id: candidatoId,
            aviso_id: avisoId,
            base64_cv_especifico: base64, // Guardamos el CV exacto de esta postulación
            texto_cv_especifico: textoCV,
            // La calificación y el resumen se llenarán después por un proceso interno.
        }, { onConflict: 'candidato_id, aviso_id' });

    if (postulaError) throw new Error(`Error al guardar la postulación: ${postulaError.message}`);
}

/**
 * Convierte un objeto File a una cadena Base64.
 */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

/**
 * Extrae el texto de un PDF usando pdf.js o Tesseract.js como fallback.
 */
async function extraerTextoDePDF(base64) {
    const pdf = await pdfjsLib.getDocument(base64).promise;
    let textoFinal = '';
    // Intento de extracción nativa (rápido)
    try {
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            textoFinal += textContent.items.map(item => item.str).join(' ');
        }
        textoFinal = textoFinal.trim();
        // Si el texto nativo es suficientemente largo, lo retornamos.
        if (textoFinal.length > 100) return textoFinal.replace(/\x00/g, '');
    } catch (error) { 
        console.warn("Fallo en extracción nativa, intentando con OCR.", error); 
    }
    // Fallback a OCR (lento pero más robusto)
    try {
        textoFinal = ''; // Reiniciamos por si la extracción nativa falló a la mitad
        const worker = await Tesseract.createWorker('spa');
        const { data: { text } } = await worker.recognize(base64);
        await worker.terminate();
        return text;
    } catch (error) { 
        throw new Error("No se pudo leer el contenido del PDF, ni siquiera con OCR."); 
    }
}

/**
 * Llama a una Edge Function de Supabase para extraer datos con IA.
 */
async function extraerDatosConIA(textoCV) {
    // Acortamos el texto para no exceder los límites del modelo de IA.
    const textoCVOptimizado = textoCV.substring(0, 4000);
    const prompt = `
      Actúa como un experto en Recursos Humanos. Analiza el siguiente texto de un CV y extrae el nombre completo, el email principal y el teléfono de contacto.
      Texto del CV: """${textoCVOptimizado}"""
      Responde únicamente con un objeto JSON con las claves "nombreCompleto", "email" y "telefono". Si un dato no se encuentra, usa null.
    `;
    
    // Llamada a la Edge Function 'openai' que debe existir en tu proyecto de Supabase.
    const { data, error } = await supabase.functions.invoke('openai', {
        body: { query: prompt },
    });

    if (error) {
        throw new Error(`Error con el servicio de IA: ${error.message}`);
    }

    try {
        // La respuesta de la función de Supabase debería estar en 'data.message'.
        return JSON.parse(data.message);
    } catch (e) {
        console.error("Error al parsear la respuesta de la IA:", data.message, e);
        throw new Error("La IA devolvió una respuesta con un formato inesperado.");
    }
}