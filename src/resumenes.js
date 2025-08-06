// src/resumenes.js

import { supabase } from './supabaseClient.js';
import { toTitleCase, showModal, hideModal } from './utils.js';

// --- SELECTORES DEL DOM ---
const panelTitle = document.getElementById('panel-title');
const processingStatus = document.getElementById('processing-status');
const resumenesListBody = document.getElementById('resumenes-list');
const detailsLinkBtn = document.getElementById('details-link-btn');
const avisosList = document.getElementById('avisos-list');
const selectAllCheckbox = document.getElementById('select-all-checkbox');
const uploadCvBtn = document.getElementById('upload-cv-btn');
const bulkActionsContainer = document.getElementById('bulk-actions-container');
const bulkActionsCount = document.getElementById('bulk-actions-count');
const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
const modalContainer = document.getElementById('modal-container');
const modalTitle = document.getElementById('modal-title');
const modalSaveNotesBtn = document.getElementById('modal-save-notes');
const modalResumenContent = document.getElementById('modal-resumen-content');
const modalNotasTextarea = document.getElementById('modal-notas-textarea');

// --- ESTADO DE LA APLICACIÓN ---
let avisoActivo = null;
let postulacionesCache = [];

// --- INICIALIZACIÓN ---
window.addEventListener('DOMContentLoaded', async () => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

    await cargarAvisos();

    const urlParams = new URLSearchParams(window.location.search);
    const avisoId = parseInt(urlParams.get('avisoId'), 10);

    if (avisoId) {
        await cargarDatosDeAviso(avisoId);
    } else {
        panelTitle.textContent = 'Seleccione una búsqueda';
        resumenesListBody.innerHTML = `<tr><td colspan="6" style="text-align: center;">Seleccione una búsqueda para ver los candidatos.</td></tr>`;
        processingStatus.textContent = '';
    }
});

async function cargarAvisos() {
    const { data, error } = await supabase.from('v2_avisos').select('id, titulo').order('created_at', { ascending: false });
    if (error) {
        avisosList.innerHTML = '<li>Error al cargar búsquedas</li>';
        return;
    }

    avisosList.innerHTML = '';
    data.forEach(aviso => {
        const li = document.createElement('li');
        li.innerHTML = `<a href="?avisoId=${aviso.id}" class="folder-item" data-aviso-id="${aviso.id}">${aviso.titulo}</a>`;
        avisosList.appendChild(li);
    });

    const urlParams = new URLSearchParams(window.location.search);
    const currentAvisoId = parseInt(urlParams.get('avisoId'), 10);
    if (currentAvisoId) {
        document.querySelector(`[data-aviso-id="${currentAvisoId}"]`)?.classList.add('active');
    }
}

async function cargarDatosDeAviso(avisoId) {
    try {
        const { data, error } = await supabase.from('v2_avisos').select('*').eq('id', avisoId).single();
        if (error) throw error;
        
        avisoActivo = data;
        panelTitle.textContent = `Candidatos para: ${avisoActivo.titulo}`;
        if (detailsLinkBtn) {
            detailsLinkBtn.href = `detalles-aviso.html?id=${avisoId}`;
        }

        await cargarPostulantes(avisoId);
        await analizarPostulantesPendientes();

    } catch (error) {
        console.error("Error al cargar datos iniciales:", error);
        panelTitle.textContent = 'Error de Carga';
    }
}

// --- LÓGICA DE CARGA Y ANÁLISIS ---
async function cargarPostulantes(avisoId) {
    processingStatus.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Cargando postulantes...`;
    
    const { data, error } = await supabase
        .from('v2_postulaciones')
        .select(`
            id, calificacion, resumen, notas, nombre_archivo_especifico,
            v2_candidatos (id, nombre_candidato, email, telefono, nombre_archivo_general)
        `)
        .eq('aviso_id', avisoId);

    if (error) {
        console.error("Error al cargar postulantes:", error);
        processingStatus.textContent = 'Error al cargar postulantes.';
        return;
    }
    postulacionesCache = data;
    renderizarTablaCompleta();
}

async function analizarUnaPostulacion(postulacion, total) {
    const index = postulacionesCache.findIndex(p => p.id === postulacion.id) + 1;
    const nombreMostrado = postulacion.v2_candidatos?.nombre_candidato || 'Nuevo CV';
    processingStatus.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Analizando ${index} de ${total}: <strong>${nombreMostrado}</strong>`;

    try {
        // Carga perezosa del texto del CV
        const { data: postData, error: textError } = await supabase
            .from('v2_postulaciones')
            .select('texto_cv_especifico')
            .eq('id', postulacion.id)
            .single();

        if (textError) throw new Error(`No se pudo cargar el texto del CV: ${textError.message}`);
        const textoCV = postData.texto_cv_especifico;
        if (!textoCV) throw new Error("El texto del CV está vacío.");

        const iaData = await calificarCVConIA(textoCV, avisoActivo);
        const updatedPostulacion = {
            calificacion: iaData.calificacion,
            resumen: iaData.justificacion,
        };
        
        await supabase.from('v2_postulaciones').update(updatedPostulacion).eq('id', postulacion.id);
        actualizarFilaEnVista(postulacion.id, updatedPostulacion);

    } catch (err) {
        console.error(`Error analizando postulación ${postulacion.id}:`, err);
        await supabase.from('v2_postulaciones').update({ calificacion: -1, resumen: err.message }).eq('id', postulacion.id);
        actualizarFilaEnVista(postulacion.id, { calificacion: -1, resumen: err.message });
    }
}

async function analizarPostulantesPendientes() {
    const postulacionesNuevas = postulacionesCache.filter(p => p.calificacion === null);
    const totalPostulaciones = postulacionesCache.length;
    const maxCv = avisoActivo.max_cv || 'Ilimitados';

    if (postulacionesNuevas.length > 0) {
        const totalNuevas = postulacionesNuevas.length;
        processingStatus.innerHTML = `<i class="fa-solid fa-sync fa-spin"></i> Preparando análisis para ${totalNuevas} de ${totalPostulaciones} candidatos...`;
        
        // Procesar en paralelo
        const analysisPromises = postulacionesNuevas.map(p => analizarUnaPostulacion(p, totalNuevas));
        await Promise.all(analysisPromises);

        processingStatus.textContent = `¡Análisis completado! Se han procesado ${totalNuevas} nuevos candidatos. Total: ${totalPostulaciones} / ${maxCv}.`;
    } else {
        processingStatus.textContent = `Todos los ${totalPostulaciones} / ${maxCv} candidatos están analizados.`;
    }
}

async function calificarCVConIA(textoCV, aviso) {
    const textoCVOptimizado = textoCV.substring(0, 12000);
    const contextoAviso = `Puesto: ${aviso.titulo}, Descripción: ${aviso.descripcion}, Condiciones Necesarias: ${aviso.condiciones_necesarias.join(', ')}, Condiciones Deseables: ${aviso.condiciones_deseables.join(', ')}`;
   const prompt = `
      Actúa como un Headhunter y Especialista Senior en Reclutamiento y Selección para una consultora de élite. Tu criterio es agudo, analítico y está orientado a resultados. Tu misión es realizar un análisis forense de un CV contra una búsqueda laboral, culminando en una calificación precisa y diferenciada, y una justificación profesional.
      **Contexto de la Búsqueda (Job Description):**
      ${contextoAviso}
      **Texto del CV a Analizar:**
      """${textoCVOptimizado}"""
      ---
      **METODOLOGÍA DE EVALUACIÓN ESTRUCTURADA Y SISTEMA DE PUNTUACIÓN (SEGUIR ESTRICTAMENTE):**
      **PASO 1: Extracción de Datos Fundamentales.**
      Primero, extrae los siguientes datos clave. Si un dato no está presente, usa null.
      -   nombreCompleto: El nombre más prominente del candidato.
      -   email: El correo electrónico más profesional que encuentres.
      -   telefono: El número de teléfono principal, priorizando móviles.
      **PASO 2: Sistema de Calificación Ponderado (Puntuación de 0 a 100).**
      Calcularás la nota final siguiendo este sistema de puntos que refleja las prioridades del reclutador. La nota final será la suma de los puntos de las siguientes 3 categorías.
      **A. CONDICIONES INDISPENSABLES (Ponderación: 50 Puntos Máximo)**
         - Este es el factor más importante. Comienza la evaluación de esta categoría con 0 puntos.
         - Analiza CADA condición indispensable. Por CADA una que el candidato CUMPLE (ya sea explícitamente o si su experiencia lo sugiere fuertemente), suma la cantidad de puntos correspondiente (50 Puntos / Total de Condiciones Indispensables).
         - **Regla de Penalización Clave:** Si un candidato no cumple con todas las condiciones, su puntaje aquí será menor a 50. Esto impactará significativamente su nota final, reflejando que es un perfil a considerar con reservas.
      **B. CONDICIONES DESEABLES (Ponderación: 25 Puntos Máximo)**
         - Comienza con 0 puntos para esta categoría.
         - Por CADA condición deseable que el candidato CUMPLE, suma la cantidad de puntos correspondiente (25 Puntos / Total de Condiciones Deseables). Sé estricto; si solo cumple parcialmente, otorga la mitad de los puntos para esa condición.
      **C. ANÁLISIS DE EXPERIENCIA Y MATCH GENERAL (Ponderación: 25 Puntos Máximo)**
         - Comienza con 0 puntos para esta categoría.
         - Evalúa la calidad y relevancia de la experiencia laboral del candidato en relación con la descripción general del puesto.
         - **Coincidencia de Rol y Funciones (hasta 15 puntos):** ¿La experiencia es en un puesto con un título y funciones idénticos o muy similares al del aviso? Un match perfecto (mismo rol, mismas tareas) otorga los 15 puntos. Un match parcial (rol diferente pero con tareas transferibles) otorga entre 5 y 10 puntos.
         - **Calidad del Perfil (hasta 10 puntos):** Evalúa la calidad general del CV. ¿Muestra una progresión de carrera lógica? ¿Es estable laboralmente? ¿Presenta logros cuantificables (ej: "aumenté ventas 15%") en lugar de solo listar tareas? Un CV con logros claros y buena estabilidad obtiene más puntos.
      **PASO 3: Elaboración de la Justificación Profesional.**
      Redacta un párrafo único y conciso que resuma tu dictamen, justificando la nota final basándote en el sistema de puntos.
         - **Veredicto Inicial:** Comienza con una afirmación clara sobre el nivel de "match".
         - **Argumento Central:** Justifica la nota mencionando explícitamente el cumplimiento de las condiciones y la calidad de la experiencia. (Ej: "El candidato cumple con casi todas las condiciones indispensables, además de presentar varios de los requisitos deseables. Su experiencia muestra un match fuerte con la descripción del puesto...").
         - **Conclusión y Recomendación:** Cierra con la nota final calculada y una recomendación clara. (Ej: "...alcanzando una calificación final de 67/100. Se recomienda una entrevista secundaria." o "...alcanzando una calificación de 92/100. Es un candidato prioritario.").
      **Formato de Salida (JSON estricto):**
      Devuelve un objeto JSON con 5 claves: "nombreCompleto", "email", "telefono", "calificacion" (el número entero final calculado) y "justificacion" (el string de texto).`;
    
    const { data, error } = await supabase.functions.invoke('openaiv2', { body: { query: prompt } });
    if (error) throw new Error("No se pudo conectar con la IA.");
    try {
        const content = JSON.parse(data.message);
        return {
            nombreCompleto: content.nombreCompleto || 'No especificado',
            email: content.email || 'No especificado',
            telefono: content.telefono || 'No especificado',
            calificacion: content.calificacion === undefined ? 0 : content.calificacion,
            justificacion: content.justificacion || "Sin justificación."
        };
    } catch (e) { throw new Error("La IA devolvió una respuesta inesperada."); }
}

// --- RENDERIZADO Y UI ---
function renderizarTablaCompleta() {
    resumenesListBody.innerHTML = '';
    postulacionesCache.sort((a, b) => (b.calificacion ?? 101) - (a.calificacion ?? 101));
    if (postulacionesCache.length === 0) {
        resumenesListBody.innerHTML = `<tr><td colspan="7" style="text-align: center;">Nadie se ha postulado todavía.</td></tr>`;
        return;
    }
    postulacionesCache.forEach(postulacion => {
        resumenesListBody.appendChild(crearFila(postulacion));
    });
}

function actualizarFilaEnVista(postulacionId, datosActualizados) {
    const index = postulacionesCache.findIndex(p => p.id === postulacionId);
    if (index > -1) {
        postulacionesCache[index] = { ...postulacionesCache[index], ...datosActualizados };
        renderizarTablaCompleta();
    }
}

function crearFila(postulacion) {
    const row = document.createElement('tr');
    const candidato = postulacion.v2_candidatos;
    row.dataset.id = postulacion.id;
    row.dataset.candidateId = candidato?.id;

    let calificacionHTML = '<em>Analizando...</em>';
    if(postulacion.calificacion === -1) { calificacionHTML = `<strong style="color: var(--danger-color);">Error</strong>`; }
    else if (typeof postulacion.calificacion === 'number') { calificacionHTML = `<strong>${postulacion.calificacion} / 100</strong>`; }
    
    const nombre = candidato?.nombre_candidato || postulacion.nombre_candidato_snapshot || 'Analizando...';
    const email = candidato?.email || postulacion.email_snapshot || 'N/A';
    const telefono = candidato?.telefono || postulacion.telefono_snapshot || 'N/A';
    const tieneNota = postulacion.notas && postulacion.notas.trim() !== '';

    row.innerHTML = `
        <td><input type="checkbox" class="postulacion-checkbox" data-id="${postulacion.id}"></td>
        <td>
            <strong>${nombre} ${tieneNota ? '<i class="fa-solid fa-note-sticky text-light"></i>' : ''}</strong>
            <div class="text-light" style="font-size: 0.8rem;">${postulacion.nombre_archivo_especifico || 'No Identificado'}</div>
        </td>
        <td>
            <div style="white-space: normal; overflow: visible;">${email}</div>
            <div class="text-light">${telefono}</div>
        </td>
        <td>${calificacionHTML}</td>
        <td><button class="btn btn-secondary btn-sm" data-action="ver-resumen" ${!postulacion.resumen ? 'disabled' : ''}>Análisis</button></td>
        <td>
            <div class="actions-group">
                <button class="btn btn-secondary btn-sm" data-action="ver-notas" title="Notas"><i class="fa-solid fa-note-sticky"></i></button>
                <button class="btn btn-primary btn-sm" data-action="ver-cv" title="Descargar CV General"><i class="fa-solid fa-download"></i></button>
            </div>
        </td>
    `;
    
    row.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.matches('input[type="checkbox"]')) return;
        const checkbox = row.querySelector('.postulacion-checkbox');
        checkbox.checked = !checkbox.checked;
        updateBulkActionsVisibility();
    });
    row.querySelector('.postulacion-checkbox').addEventListener('change', updateBulkActionsVisibility);
    row.querySelector('[data-action="ver-resumen"]').addEventListener('click', () => abrirModalResumen(postulacion));
    row.querySelector('[data-action="ver-notas"]').addEventListener('click', () => abrirModalNotas(postulacion));
    
    const downloadBtn = row.querySelector('[data-action="ver-cv"]');
    downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        descargarCV(candidato, downloadBtn);
    });

    return row;
}

// --- ACCIONES Y FUNCIONALIDADES ---
async function descargarCV(candidato, button) {
    if (!candidato) return alert('Datos del candidato no disponibles.');
    const originalHTML = button.innerHTML;
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    button.disabled = true;
    try {
        const { data, error } = await supabase.from('v2_candidatos').select('base64_general, nombre_archivo_general').eq('id', candidato.id).single();
        if (error || !data) throw new Error('No se encontró el CV en la base de talentos.');
        
        const link = document.createElement('a');
        link.href = data.base64_general;
        link.download = data.nombre_archivo_general || 'cv.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (err) {
        alert('Error al descargar el CV.');
    } finally {
        button.innerHTML = originalHTML;
        button.disabled = false;
    }
}

uploadCvBtn.addEventListener('click', () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/pdf';
    fileInput.multiple = true;
    fileInput.onchange = async (e) => {
        const files = e.target.files;
        if (files.length === 0) return;
        uploadCvBtn.disabled = true;
        
        for (const [index, file] of Array.from(files).entries()) {
            uploadCvBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Subiendo ${index + 1}/${files.length}`;
            try {
                const base64 = await fileToBase64(file);
                const textoCV = await extraerTextoDePDF(file);
                const iaData = await extraerDatosConIA(textoCV);
                await procesarCandidatoYPostulacion(iaData, base64, textoCV, file.name, avisoActivo.id);
            } catch (error) {
                alert(`Error al subir el CV ${file.name}: ${error.message}`);
            }
        }
        
        await cargarPostulantes(avisoActivo.id);
        await analizarPostulantesPendientes();
        
        uploadCvBtn.disabled = false;
        uploadCvBtn.innerHTML = `<i class="fa-solid fa-upload"></i> Cargar CVs`;
    };
    fileInput.click();
});

function getSelectedPostulacionIds() {
    return Array.from(resumenesListBody.querySelectorAll('.postulacion-checkbox:checked')).map(cb => cb.dataset.id);
}

function updateBulkActionsVisibility() {
    const selectedIds = getSelectedPostulacionIds();
    bulkActionsContainer.classList.toggle('hidden', selectedIds.length === 0);

    if (bulkActionsCount) {
        bulkActionsCount.textContent = `${selectedIds.length} seleccionados`;
    }
}

selectAllCheckbox.addEventListener('change', (e) => {
    resumenesListBody.querySelectorAll('.postulacion-checkbox').forEach(cb => cb.checked = e.target.checked);
    updateBulkActionsVisibility();
});

bulkDeleteBtn.addEventListener('click', async () => {
    const idsToDelete = getSelectedPostulacionIds();
    if (idsToDelete.length === 0) return;
    if (confirm(`¿Eliminar ${idsToDelete.length} postulación(es) de esta búsqueda?`)) {
        const { error } = await supabase.from('v2_postulaciones').delete().in('id', idsToDelete);
        if (error) {
            alert('Error al eliminar las postulaciones.');
        } else {
            postulacionesCache = postulacionesCache.filter(p => !idsToDelete.includes(p.id.toString()));
            renderizarTablaCompleta();
            updateBulkActionsVisibility();
        }
    }
});

// --- MODALES ---
function abrirModalResumen(postulacion) {
    const nombre = postulacion.v2_candidatos?.nombre_candidato || postulacion.nombre_candidato_snapshot;
    modalTitle.textContent = `Análisis de ${nombre}`;
    
    modalResumenContent.innerHTML = `<h4>Calificación: ${postulacion.calificacion}/100</h4><p>${postulacion.resumen || 'No hay análisis.'}</p>`;
    modalResumenContent.classList.remove('hidden');
    modalNotasTextarea.classList.add('hidden');
    
    modalSaveNotesBtn.classList.add('hidden');
    showModal('modal-container');
}

function abrirModalNotas(postulacion) {
    const nombre = postulacion.v2_candidatos?.nombre_candidato || postulacion.nombre_candidato_snapshot;
    modalTitle.textContent = `Notas sobre ${nombre}`;
    
    modalNotasTextarea.value = postulacion.notas || '';
    modalNotasTextarea.classList.remove('hidden');
    modalResumenContent.classList.add('hidden');
    
    modalSaveNotesBtn.classList.remove('hidden');
    modalSaveNotesBtn.onclick = async () => {
        const nuevasNotas = modalNotasTextarea.value;
        const { error } = await supabase.from('v2_postulaciones').update({ notas: nuevasNotas }).eq('id', postulacion.id);

        if (error) {
            alert('No se pudo guardar la nota.');
            console.error(error);
        } else {
            // Actualiza la cache y re-renderiza la tabla para mostrar el ícono
            actualizarFilaEnVista(postulacion.id, { notas: nuevasNotas });
        }
        
        hideModal('modal-container');
    };
    showModal('modal-container');
}

// --- FUNCIONES AUXILIARES ---
async function procesarCandidatoYPostulacion(iaData, base64, textoCV, nombreArchivo, avisoId) {
    let nombreFormateado = toTitleCase(iaData.nombreCompleto) || `N/A ${Date.now().toString().slice(-4)}`;
    const { data: candidato, error: upsertError } = await supabase.from('v2_candidatos').upsert({
        nombre_candidato: nombreFormateado,
        email: iaData.email || `no-extraido-${Date.now()}@dominio.com`,
        telefono: iaData.telefono,
        base64_general: base64,
        texto_cv_general: textoCV,
        nombre_archivo_general: nombreArchivo,
        updated_at: new Date()
    }, { onConflict: 'nombre_candidato' }).select('id').single();
    if (upsertError) throw new Error(`Error al procesar candidato: ${upsertError.message}`);
    const { error: postulaError } = await supabase.from('v2_postulaciones').insert({
        candidato_id: candidato.id,
        aviso_id: avisoId,
        base64_cv_especifico: base64,
        texto_cv_especifico: textoCV,
        nombre_archivo_especifico: nombreArchivo
    });
    if (postulaError && postulaError.code !== '23505') { throw new Error(`Error: ${postulaError.message}`); }
}
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}
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
    } catch (error) { console.warn("Extracción nativa fallida, intentando OCR.", error); }
    try {
        const { data: { text } } = await Tesseract.recognize(file, 'spa');
        return text || "Texto no legible por OCR";
    } catch (error) {
        return "Contenido no legible.";
    }
}
async function extraerDatosConIA(texto) {
    const prompt = `Actúa como RRHH. Extrae nombre, email y teléfono. Texto: """${texto.substring(0,4000)}""" Responde solo JSON con claves "nombreCompleto", "email", y "telefono". Si no encuentras, usa null.`;
    try {
        const { data, error } = await supabase.functions.invoke('openaiv2', { body: { query: prompt } });
        if (error) throw error;
        return JSON.parse(data.message);
    } catch (e) {
        return { nombreCompleto: null, email: null, telefono: null };
    }
}
