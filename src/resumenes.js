import { supabase } from './supabaseClient.js';
import { showSpinner, hideSpinner } from './utils.js';

// --- SELECTORES ---
const resumenesList = document.getElementById('resumenes-list');
const modalContainer = document.getElementById('modal-container');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalCloseBtn = document.getElementById('modal-close');
const panelTitle = document.getElementById('panel-title');
const processingStatus = document.getElementById('processing-status');
const filtroContainer = document.getElementById('filtro-container');
const filtroNombre = document.getElementById('filtro-candidatos');
const modalSaveNotesBtn = document.getElementById('modal-save-notes');
const modalCancelBtn = document.getElementById('modal-cancel');
const uploadCvBtn = document.getElementById('cargar-cv-btn');
const showPublicLinkBtn = document.getElementById('link-postulantes-btn');
const fileInputResumenes = document.createElement('input');
fileInputResumenes.type = 'file';
fileInputResumenes.multiple = true;
fileInputResumenes.style.display = 'none';
document.body.appendChild(fileInputResumenes);
const selectAllCheckbox = document.getElementById('select-all-checkbox');
const bulkActionsContainer = document.getElementById('bulk-actions-container');
const bulkDeleteBtn = document.getElementById('bulk-delete-btn');

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let archivosCache = [];
let avisoActivo = null;

// --- LÓGICA PRINCIPAL ---
window.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const avisoId = parseInt(urlParams.get('avisoId'), 10);

    if (!avisoId) {
        panelTitle.textContent = 'Error';
        resumenesList.innerHTML = '<tr><td colspan="7">No se ha especificado una búsqueda.</td></tr>';
        return;
    }

    try {
        avisoActivo = await getAvisoById(avisoId);
        panelTitle.textContent = `Candidatos para: ${avisoActivo.titulo}`;
        if (showPublicLinkBtn) {
            const publicLink = `${window.location.origin}/index.html?avisoId=${avisoActivo.id}`;
            showPublicLinkBtn.href = publicLink;
        }
        await cargarYProcesarCandidatos(avisoId);
    } catch (error) {
        console.error("Error al cargar datos iniciales:", error);
        panelTitle.textContent = 'Error de Carga';
        resumenesList.innerHTML = `<tr><td colspan="7">No se pudo cargar el aviso.</td></tr>`;
    }
});

async function cargarYProcesarCandidatos(avisoId) {
    processingStatus.classList.remove('hidden');
    
    const evaluaciones = await getCandidatosByAvisoId(avisoId);
    archivosCache = evaluaciones;

    if (evaluaciones.length === 0) {
        processingStatus.textContent = "Aún no hay candidatos para esta búsqueda.";
        resumenesList.innerHTML = `<tr><td colspan="7" style="text-align: center;">Nadie se ha postulado todavía.</td></tr>`;
    } else {
        actualizarVistaCandidatos();
    }
    
    filtroContainer.classList.remove('hidden');

    const nuevasEvaluaciones = evaluaciones.filter(ev => ev.calificacion === null || ev.calificacion === -1);
    
    if (nuevasEvaluaciones.length > 0) {
        processingStatus.innerHTML = `<p>Analizando ${nuevasEvaluaciones.length} nuevos CVs...</p>`;
        
        for (const [index, evaluacion] of nuevasEvaluaciones.entries()) {
            processingStatus.textContent = `Procesando ${index + 1} de ${nuevasEvaluaciones.length}... (${evaluacion.nombre_archivo})`;
            
            if (evaluacion.calificacion === -1) {
                evaluacion.calificacion = null;
                actualizarFilaEnVista(evaluacion.id);
            }

            try {
                if (!evaluacion.base64) {
                    const { data: candidatoConBase64, error } = await supabase.from('candidatos').select('base64').eq('id', evaluacion.id).single();
                    if (error || !candidatoConBase64) throw new Error("No se pudo obtener el contenido del CV para análisis.");
                    evaluacion.base64 = candidatoConBase64.base64;
                }

                const textoCV = evaluacion.texto_cv || await extraerTextoDePDF(evaluacion.base64);
                if (!textoCV || textoCV.trim().length < 50) throw new Error("PDF vacío o con texto ilegible.");

                const iaData = await calificarCVConIA(textoCV, avisoActivo);
                
                await supabase.from('v2_postulaciones').update({
                    texto_cv_especifico: textoCV,
                    nombre_candidato_snapshot: iaData.nombreCompleto,
                    email_snapshot: iaData.email,
                    telefono_snapshot: iaData.telefono,
                    calificacion: iaData.calificacion,
                    resumen: iaData.justificacion
                }).eq('id', evaluacion.id);

                // Actualizar el objeto en la caché principal
                const cacheIndex = archivosCache.findIndex(c => c.id === evaluacion.id);
                if (cacheIndex > -1) {
                    archivosCache[cacheIndex].nombre_candidato = iaData.nombreCompleto;
                    archivosCache[cacheIndex].email = iaData.email;
                    archivosCache[cacheIndex].telefono = iaData.telefono;
                    archivosCache[cacheIndex].calificacion = iaData.calificacion;
                    archivosCache[cacheIndex].resumen = iaData.justificacion;
                }
                
            } catch (error) {
                console.error(`Falló el procesamiento para el CV ${evaluacion.id}:`, error);
                await supabase.from('v2_postulaciones').update({
                    calificacion: -1,
                    resumen: `Error de análisis: ${error.message}`
                }).eq('id', evaluacion.id);
                evaluacion.calificacion = -1;
            }
            actualizarFilaEnVista(evaluacion.id);
        }
        processingStatus.textContent = "Análisis completado.";
    } else {
        processingStatus.textContent = "Todos los candidatos están calificados.";
    }
}

if (uploadCvBtn) {
    uploadCvBtn.addEventListener('click', () => {
        fileInputResumenes.click();
    });
}

if (fileInputResumenes) {
    fileInputResumenes.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files.length || !avisoActivo) return;

        uploadCvBtn.disabled = true;
        uploadCvBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Cargando...';
        
        for (const file of files) {
            try {
                const base64 = await fileToBase64(file);
                
                const { data: postulacion, error: postulacionError } = await supabase
                    .from('v2_postulaciones')
                    .insert({ 
                        aviso_id: avisoActivo.id, 
                        base64_cv_especifico: base64,
                        calificacion: null // Marcar para procesar
                    })
                    .select().single();

                if (postulacionError) throw postulacionError;

            } catch (error) {
                console.error(`Error al subir el archivo ${file.name}:`, error);
                alert(`No se pudo subir el archivo: ${file.name}. Detalles: ${error.message}`);
            }
        }
        
        await cargarYProcesarCandidatos(avisoActivo.id); 
        uploadCvBtn.disabled = false;
        uploadCvBtn.innerHTML = '<i class="fa-solid fa-upload"></i> Cargar CV';
        fileInputResumenes.value = '';
    });
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

async function getAvisoById(id) {
    const { data, error } = await supabase.from('v2_avisos').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
}

async function getCandidatosByAvisoId(avisoId) {
    const { data, error } = await supabase
        .from('v2_postulaciones')
        .select(`
            id, calificacion, resumen, notas, base64_cv_especifico, texto_cv_especifico, nombre_candidato_snapshot, email_snapshot, telefono_snapshot
        `)
        .eq('aviso_id', avisoId);

    if (error) throw error;

    return data.map(postulacion => ({
        id: postulacion.id, // Usamos el ID de la postulación como identificador único
        evaluacion_id: postulacion.id, // Mantenemos la referencia
        calificacion: postulacion.calificacion,
        resumen: postulacion.resumen,
        notas: postulacion.notas,
        base64: postulacion.base64_cv_especifico,
        texto_cv: postulacion.texto_cv_especifico,
        nombre_candidato: postulacion.nombre_candidato_snapshot,
        email: postulacion.email_snapshot,
        telefono: postulacion.telefono_snapshot,
        nombre_archivo: postulacion.nombre_candidato_snapshot ? `${postulacion.nombre_candidato_snapshot}.pdf` : 'CV.pdf'
    }));
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
    } catch (e) { console.warn("Extracción nativa fallida, intentando OCR", e); }
    
    console.log("Recurriendo a OCR...");
    textoFinal = '';
    const canvas = document.createElement('canvas');
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        const result = await Tesseract.recognize(canvas, 'spa');
        textoFinal += result.data.text;
    }
    return textoFinal.replace(/\x00/g, '');
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
   - Analiza CADA condición indispensable. Por CADA una que el candidato CUMPLE (ya sea explícitamente o si su experiencia lo sugiere fuertemente), suma la cantidad de puntos correspondiente (**50 Puntos / Total de Condiciones Indispensables**).
   - **Regla de Penalización Clave:** Si un candidato no cumple con todas las condiciones, su puntaje aquí será menor a 50. Esto impactará significativamente su nota final, reflejando que es un perfil a considerar con reservas.

**B. CONDICIONES DESEABLES (Ponderación: 25 Puntos Máximo)**
   - Comienza con 0 puntos para esta categoría.
   - Por CADA condición deseable que el candidato CUMPLE, suma la cantidad de puntos correspondiente (**25 Puntos / Total de Condiciones Deseables**). Sé estricto; si solo cumple parcialmente, otorga la mitad de los puntos para esa condición.

**C. ANÁLISIS DE EXPERIENCIA Y MATCH GENERAL (Ponderación: 25 Puntos Máximo)**
   - Comienza con 0 puntos para esta categoría.
   - Evalúa la calidad y relevancia de la experiencia laboral del candidato en relación con la descripción general del puesto.
   - **Coincidencia de Rol y Funciones (hasta 15 puntos):** ¿La experiencia es en un puesto con un título y funciones idénticos o muy similares al del aviso? Un match perfecto (mismo rol, mismas tareas) otorga los 15 puntos. Un match parcial (rol diferente pero con tareas transferibles) otorga entre 5 y 10 puntos.
   - **Calidad del Perfil (hasta 10 puntos):** Evalúa la calidad general del CV. ¿Muestra una progresión de carrera lógica? ¿Es estable laboralmente? ¿Presenta logros cuantificables (ej: "aumenté ventas 15%") en lugar de solo listar tareas? Un CV con logros claros y buena estabilidad obtiene más puntos.

**PASO 3: Elaboración de la Justificación Profesional.**
Redacta un párrafo único y conciso que resuma tu dictamen, justificando la nota final basándote en el sistema de puntos.
   - **Veredicto Inicial:** Comienza con una afirmación clara sobre el nivel de "match".
   - **Argumento Central:** Justifica la nota mencionando explícitamente los puntos obtenidos en cada categoría. (Ej: "El candidato obtiene 40/50 en condiciones indispensables al cumplir 4 de 5. Suma 15/25 en deseables y su experiencia tiene un match fuerte con la descripción (+12 pts)...").
   - **Conclusión y Recomendación:** Cierra con la nota final calculada y una recomendación clara. (Ej: "...alcanzando una calificación final de 67/100. Se recomienda una entrevista secundaria." o "...alcanzando una calificación de 92/100. Es un candidato prioritario.").

**Formato de Salida (JSON estricto):**
Devuelve un objeto JSON con 5 claves: "nombreCompleto", "email", "telefono", "calificacion" (el número entero final calculado) y "justificacion" (el string de texto).
`;





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
    } catch (e) {
        throw new Error("La IA devolvió una respuesta inesperada.");
    }
}

function actualizarVistaCandidatos() {
    const filtro = filtroNombre.value.toLowerCase();
    const candidatosFiltrados = archivosCache.filter(cv => 
        (cv.nombre_candidato || '').toLowerCase().includes(filtro) || 
        (cv.nombre_archivo || '').toLowerCase().includes(filtro)
    );
    candidatosFiltrados.sort((a, b) => (b.calificacion || -1) - (a.calificacion || -1));
    
    resumenesList.innerHTML = '';
    if (candidatosFiltrados.length === 0) {
        resumenesList.innerHTML = '<tr><td colspan="7" style="text-align: center;">No se encontraron candidatos.</td></tr>';
    } else {
        candidatosFiltrados.forEach(cv => renderizarFila(cv, true));
    }
    addActionListeners();
}

function actualizarFilaEnVista(cvId) {
    const cv = archivosCache.find(c => c.id === cvId);
    if (cv) {
        renderizarFila(cv, false);
        addActionListeners();
    }
}

function renderizarFila(cv, esNueva) {
    let calificacionMostrada = '<em>Analizando...</em>';
    if (cv.calificacion === -1) {
        calificacionMostrada = `<strong style="color: var(--danger-color);">Error</strong>`;
    } else if (typeof cv.calificacion === 'number') {
        calificacionMostrada = `<strong>${cv.calificacion} / 100</strong>`;
    }
    const notasClass = cv.notas ? 'has-notes' : '';
    
    const nombreMostrado = cv.calificacion === null 
        ? '<em>Analizando...</em>' 
        : `<strong>${cv.nombre_candidato || 'No extraído'}</strong>`;

    const rowHTML = `
        <td><input type="checkbox" class="evaluation-checkbox" data-evaluation-id="${cv.evaluacion_id}"></td>
        <td>${cv.nombre_archivo || 'N/A'}</td>
        <td>${nombreMostrado}</td>
        <td>${calificacionMostrada}</td>
        <td><button class="btn btn-secondary" data-action="ver-resumen" ${cv.calificacion === null || cv.calificacion === -1 ? 'disabled' : ''}>Análisis IA</button></td>
        <td><button class="btn btn-secondary ${notasClass}" data-action="ver-notas">Notas</button></td>
        <td>
            <div class="actions-group">
                <button class="btn btn-primary download-cv-btn" data-id="${cv.id}">Ver CV</button>
                <button class="btn btn-secondary" data-action="ver-contacto" ${cv.calificacion === null || cv.calificacion === -1 ? 'disabled' : ''}>Contacto</button>
            </div>
        </td>
    `;
    if (esNueva) {
        const newRow = document.createElement('tr');
        newRow.dataset.id = cv.id;
        newRow.innerHTML = rowHTML;
        newRow.addEventListener('click', (e) => {
            if (e.target.closest('a') || e.target.closest('button') || e.target.matches('input[type="checkbox"]')) {
                return;
            }
            const checkbox = newRow.querySelector('.evaluation-checkbox');
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                const changeEvent = new Event('change', { bubbles: true });
                checkbox.dispatchEvent(changeEvent);
            }
        });
        resumenesList.appendChild(newRow);
    } else {
        const existingRow = resumenesList.querySelector(`tr[data-id='${cv.id}']`);
        if (existingRow) existingRow.innerHTML = rowHTML;
    }
}

filtroNombre.addEventListener('input', actualizarVistaCandidatos);

resumenesList.addEventListener('click', (e) => {
    const button = e.target.closest('.btn:not(.download-cv-btn)');
    if (!button) return;
    const row = e.target.closest('tr');
    const cvId = parseInt(row.dataset.id, 10);
    const cv = archivosCache.find(c => c.id === cvId);
    if (!cv) return;
    
    switch (button.dataset.action) {
        case 'ver-resumen': abrirModalResumen(cv); break;
        case 'ver-contacto': abrirModalContacto(cv); break;
        case 'ver-notas': abrirModalNotas(cv); break;
    }
});

resumenesList.addEventListener('change', (e) => {
    if (e.target.matches('.evaluation-checkbox')) {
        updateBulkActionsVisibility();
    }
});

selectAllCheckbox.addEventListener('change', () => {
    resumenesList.querySelectorAll('.evaluation-checkbox').forEach(cb => {
        cb.checked = selectAllCheckbox.checked;
    });
    updateBulkActionsVisibility();
});

bulkDeleteBtn.addEventListener('click', deleteSelectedEvaluations);

function addActionListeners() {
    resumenesList.querySelectorAll('.download-cv-btn:not(.listener-added)').forEach(button => {
        button.classList.add('listener-added');
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const btn = e.target.closest('button');
            const cvId = parseInt(btn.dataset.id, 10);
            const cv = archivosCache.find(c => c.id === cvId);

            if (cv && cv.base64) {
                const link = document.createElement('a');
                link.href = cv.base64;
                link.download = cv.nombre_archivo || 'cv.pdf';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } else {
                alert("El CV no está disponible para descargar.");
                console.error("No se encontró el CV en caché o no tiene base64:", cv);
            }
        });
    });
}

function getSelectedEvaluationIds() {
    return Array.from(resumenesList.querySelectorAll('.evaluation-checkbox:checked'))
        .map(cb => parseInt(cb.dataset.evaluationId, 10));
}

function updateBulkActionsVisibility() {
    const selectedCount = getSelectedEvaluationIds().length;
    bulkActionsContainer.classList.toggle('hidden', selectedCount === 0);
}

async function deleteSelectedEvaluations() {
    const idsToDelete = getSelectedEvaluationIds();
    if (idsToDelete.length === 0) return;

    if (confirm(`¿Estás seguro de que quieres eliminar a ${idsToDelete.length} candidato(s) de esta búsqueda? (Los candidatos no se eliminarán de tu base de datos general).`)) {
        const { error } = await supabase
            .from('v2_postulaciones')
            .delete()
            .in('id', idsToDelete);

        if (error) {
            alert("Error al eliminar las evaluaciones.");
            console.error(error);
        } else {
            alert("Candidatos eliminados de la búsqueda exitosamente.");
            await cargarYProcesarCandidatos(avisoActivo.id);
        }
    }
}

function abrirModalResumen(cv) {
    modalTitle.textContent = `Análisis de ${cv.nombre_candidato || 'Candidato'}`;
    modalBody.innerHTML = `<h4>Calificación: ${cv.calificacion}/100</h4><p>${cv.resumen || 'No hay análisis.'}</p>`;
    modalSaveNotesBtn.classList.add('hidden');
    abrirModal();
}

function abrirModalContacto(cv) {
    modalTitle.textContent = `Contacto de ${cv.nombre_candidato || 'Candidato'}`;
    modalBody.innerHTML = `<ul><li><strong>Nombre:</strong> ${cv.nombre_candidato || 'No extraído'}</li><li><strong>Email:</strong> ${cv.email || 'No extraído'}</li><li><strong>Teléfono:</strong> ${cv.telefono || 'No extraído'}</li></ul>`;
    modalSaveNotesBtn.classList.add('hidden');
    abrirModal();
}

async function abrirModalNotas(cv) {
    modalTitle.textContent = `Notas sobre ${cv.nombre_candidato || 'Candidato'}`;
    modalBody.innerHTML = `<textarea id="notas-textarea" placeholder="Escribe tus notas...">${cv.notas || ''}</textarea>`;
    modalSaveNotesBtn.classList.remove('hidden');
    modalSaveNotesBtn.onclick = async () => {
        const nuevasNotas = document.getElementById('notas-textarea').value;
        try {
            await supabase.from('v2_postulaciones').update({ notas: nuevasNotas }).eq('id', cv.evaluacion_id);
            cv.notas = nuevasNotas;
            cerrarModal();
            actualizarFilaEnVista(cv.id);
        } catch (error) {
            alert("No se pudieron guardar las notas.");
        }
    };
    abrirModal();
}

modalCloseBtn.addEventListener('click', cerrarModal);
modalCancelBtn.addEventListener('click', cerrarModal);
modalContainer.addEventListener('click', (e) => {
    if (e.target === modalContainer) cerrarModal();
});

function abrirModal() {
    modalContainer.classList.remove('hidden');
    setTimeout(() => modalContainer.classList.add('visible'), 10);
}

function cerrarModal() {
    modalContainer.classList.remove('visible');
    setTimeout(() => modalContainer.classList.add('hidden'), 300);
}
