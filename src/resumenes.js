// src/resumenes.js

import { supabase } from './supabaseClient.js';
import { toTitleCase, showModal, hideModal } from './utils.js';

// --- SELECTORES DEL DOM ---
const panelTitle = document.getElementById('panel-title');
const processingStatus = document.getElementById('processing-status');
const postulantesCountDisplay = document.getElementById('postulantes-count-display');
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
const filtroInput = document.getElementById('filtro-candidatos');
const sortSelect = document.getElementById('sort-select');
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

    document.body.addEventListener('click', (e) => {
        if (e.target.matches('.modal-close-btn')) {
            const modal = e.target.closest('.modal-overlay');
            if (modal) {
                hideModal(modal.id);
            }
        }
    });
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

// --- FILTRADO Y BÚSQUEDA ---
let searchTimeout;
filtroInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(applyFiltersAndSort, 300);
});

sortSelect.addEventListener('change', applyFiltersAndSort);

function applyFiltersAndSort() {
    let data = [...postulacionesCache];
    const searchTerm = filtroInput.value.toLowerCase().trim();
    const sortValue = sortSelect.value;

    // 1. Aplicar filtro de búsqueda si hay un término de búsqueda
    if (searchTerm) {
        data = data.filter(postulacion => {
            const candidato = postulacion.v2_candidatos;
            if (!candidato) return false;
            const nombre = (candidato.nombre_candidato || '').toLowerCase();
            const email = (candidato.email || '').toLowerCase();
            const telefono = (candidato.telefono || '').toLowerCase();
            return nombre.includes(searchTerm) || email.includes(searchTerm) || telefono.includes(searchTerm);
        });
    }

    // 2. Aplicar ordenamiento
    const [sortColumn, sortOrder] = sortValue.split('-');
    const sortAscending = sortOrder === 'asc';

    data.sort((a, b) => {
        if (sortColumn === 'nombre_candidato') {
            const nameA = a.v2_candidatos?.nombre_candidato || '';
            const nameB = b.v2_candidatos?.nombre_candidato || '';
            return sortAscending ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
        }
        
        if (sortColumn === 'calificacion') {
            const scoreA = a.calificacion ?? -1;
            const scoreB = b.calificacion ?? -1;
            return sortAscending ? scoreA - scoreB : scoreB - scoreA;
        }

        // Default to created_at
        const dateA = new Date(a.created_at || 0);
        const dateB = new Date(b.created_at || 0);
        return sortAscending ? dateA - dateB : dateB - dateA;
    });

    renderizarTabla(data);
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

        // Establecer el contador estático
        const maxCv = avisoActivo.max_cv || 'Ilimitados';
        postulantesCountDisplay.innerHTML = `Total de postulantes: <strong>${avisoActivo.postulaciones_count} / ${maxCv}</strong>`;


        await cargarPostulantes(avisoId);
        await analizarPostulantesPendientes();

    } catch (error) {
        console.error("Error al cargar datos iniciales:", error);
        panelTitle.textContent = 'Error de Carga';
    }
}

// --- LÓGICA DE CARGA Y ANÁLISIS ---
async function cargarPostulantes(avisoId) {
    processingStatus.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Cargando todos los postulantes...`;
    
    const { data, error } = await supabase
        .from('v2_postulaciones')
        .select(`
            id, calificacion, resumen, notas, nombre_archivo_especifico, created_at,
            v2_candidatos (id, nombre_candidato, email, telefono, nombre_archivo_general)
        `)
        .eq('aviso_id', avisoId);

    if (error) {
        console.error("Error al cargar postulantes:", error);
        processingStatus.textContent = 'Error al cargar postulantes.';
        return;
    }
    
    postulacionesCache = data || [];
    applyFiltersAndSort(); // Aplicar filtros y orden inicial
    processingStatus.innerHTML = ''; // Limpiar después de la carga inicial
}

async function analizarUnaPostulacion(postulacion) {
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
    const postulacionesNuevas = postulacionesCache.filter(p => p.calificacion === null || p.calificacion === -1);
    const totalNuevas = postulacionesNuevas.length;

    if (totalNuevas === 0) {
        processingStatus.textContent = '';
        return;
    }

    processingStatus.innerHTML = `<i class="fa-solid fa-sync fa-spin"></i> Preparando análisis para ${totalNuevas} candidatos...`;

    const CONCURRENCY_LIMIT = 15;
    let currentIndex = 0;

    const procesarLote = async () => {
        const lote = postulacionesNuevas.slice(currentIndex, currentIndex + CONCURRENCY_LIMIT);
        if (lote.length === 0) {
            if (currentIndex >= totalNuevas) {
                processingStatus.textContent = `¡Análisis completado! Se han procesado ${totalNuevas} nuevos candidatos.`;
            }
            return;
        }

        const start = currentIndex + 1;
        const end = Math.min(currentIndex + lote.length, totalNuevas);
        processingStatus.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Analizando candidatos ${start}-${end} de ${totalNuevas}...`;

        const promesas = lote.map(postulacion => analizarUnaPostulacion(postulacion));
        await Promise.all(promesas);

        currentIndex += lote.length;
        await procesarLote(); // Llamada recursiva para el siguiente lote
    };

    await procesarLote();
}

async function calificarCVConIA(textoCV, aviso) {
    const textoCVOptimizado = textoCV.substring(0, 12000);
    const condicionesNecesariasTexto = aviso.condiciones_necesarias
        .map((req, index) => `${index + 1}. ${req}`)
        .join('\n');

    const condicionesDeseablesTexto = aviso.condiciones_deseables
        .map((req, index) => `${index + 1}. ${req}`)
        .join('\n');

    const contextoAviso = `
Puesto: ${aviso.titulo}
Descripción: ${aviso.descripcion}

Condiciones Necesarias (INDISPENSABLES):
${condicionesNecesariasTexto}

Condiciones Deseables:
${condicionesDeseablesTexto}
    `;

    const prompt = `
    Eres un analista de RRHH experto, pragmático y muy hábil para interpretar CVs cuyo texto ha sido extraído de un PDF y puede estar desordenado. Tu misión es analizar el CV con inteligencia contextual y compararlo con el aviso de trabajo para devolver UN ÚNICO OBJETO JSON válido.

### PRINCIPIOS GUÍA

1.  **Principio de Evidencia Razonable (Más importante)**: Tu objetivo NO es la coincidencia literal, sino encontrar **evidencia fuerte y razonable** en el CV. Si el aviso pide "2 años de experiencia como operador" y el CV dice "Empresa X - Operador (2021-2024)", DEBES considerar el requisito como "cumplido" porque la evidencia (3 años en el rol) es clara.
2.  **Interpretación Contextual**: El texto del CV puede estar fragmentado. Debes conectar la información. Por ejemplo, un puesto listado en una sección puede estar detallado con fechas en otra parte del documento. Asume que la información puede no estar junta.
3.  **Regla de Contención Geográfica**: Si un requisito de ubicación (ej: "vivir en Timbúes") no se cumple de forma exacta, pero el CV indica una localidad más grande que la contiene (ej: "vivo en San Lorenzo", y Timbúes es parte de San Lorenzo), debes marcarlo como **"Parcial"**. Esto se debe a que el candidato podría vivir en la localidad requerida, pero solo mencionó el área general.
4.  **Regla de Ambigüedad y Omisión**: Si un requisito no se menciona explícitamente en el CV y no aplica la regla de proximidad, pero tampoco hay evidencia que lo contradiga, debes marcarlo como **"Parcial"**. Esto indica que no hay información suficiente para confirmarlo o negarlo.

### ENTRADAS

**JOB DESCRIPTION:**
${contextoAviso}

**CV (texto extraído):**
"""${textoCVOptimizado}"""

### SISTEMA DE PUNTAJE (Lógica en Código)

#### A) REQUISITOS INDISPENSABLES (Análisis)
Tu tarea es analizar cada requisito indispensable y determinar su estado. Devuelve un array de objetos en \`desglose_indispensables\`.

-   **Para cada requisito**, busca "evidencia razonable" en el CV para determinar si está:
    -   \`"Cumple"\`: Hay evidencia clara de que se satisface.
    -   \`"Parcial"\`: No hay evidencia clara, pero hay indicios o no se contradice.
    -   \`"No Cumple"\`: Hay evidencia de que NO se satisface.

#### B) COMPETENCIAS DESEABLES (Análisis)
Tu tarea es analizar cada competencia deseable. Devuelve un array de objetos en \`desglose_deseables\`.

-   **Para cada competencia**, determina su estado:
    -   \`"cumplido"\`: Evidencia clara.
    -   \`"parcial"\`: Evidencia parcial (ej: pide "inglés avanzado", CV dice "inglés intermedio").
    -   \`"no cumplido"\`: Sin evidencia o se contradice.

#### C) ALINEAMIENTO (Análisis)
Tu tarea es analizar cada ítem de alineamiento y determinar su valor.

-   **funciones**: Determina si la coincidencia de funciones es "Alta", "Media" o "Baja".
-   **experiencia**: Determina si la experiencia es ">3 años", "1-3 años" o "<1 año".
-   **logros**: Determina si hay logros cuantificables ("Sí" o "No").

### FORMATO DE SALIDA (JSON ÚNICO)

Devuelve **solo** el objeto JSON. La justificación debe ser un borrador que el código usará como plantilla.

{
  "nombreCompleto": "string o null",
  "email": "string o null",
  "telefono": "string o null",
  "desglose_indispensables": [
    { "requisito": "nombre del requisito", "estado": "Cumple", "justificacion": "breve explicación" }
  ],
  "desglose_deseables": [
    { "competencia": "nombre de la competencia", "estado": "cumplido", "justificacion": "breve explicación" }
  ],
  "justificacion_template": {
    "conclusion": "Recomendar",
    "alineamiento_items": {
        "funciones": { "valor": "Alta", "justificacion": "Las tareas descritas coinciden con el puesto." },
        "experiencia": { "valor": ">3 años", "justificacion": "Suma 5 años en roles similares." },
        "logros": { "valor": "Sí", "justificacion": "Menciona una reducción de costos del 15%." }
    }
  }
}
`;

    // --- LLAMADA A LA IA ---
    const { data, error } = await supabase.functions.invoke('openaiv2', { body: { query: prompt } });
    if (error) {
        throw new Error("No se pudo conectar con la IA.");
    }

    try {
        const content = JSON.parse(data.message);

        // --- LÓGICA DE CÁLCULO 100% EN JAVASCRIPT ---

        // 1. Calcular p_indispensables
        const desglose_indispensables = content.desglose_indispensables || [];
        let p_indispensables = 0;
        const estados_indispensables = desglose_indispensables.map(item => item.estado);

        if (estados_indispensables.includes("No Cumple")) {
            p_indispensables = 0;
        } else {
            const parciales = estados_indispensables.filter(e => e === "Parcial").length;
            if (parciales === 0) p_indispensables = 50;
            else if (parciales === 1) p_indispensables = 40;
            else if (parciales === 2) p_indispensables = 30;
            else p_indispensables = 0; // Más de 2 parciales
        }

        // 2. Calcular p_deseables
        const desglose_deseables = content.desglose_deseables || [];
        let p_deseables = 0;
        if (desglose_deseables.length > 0) {
            const peso_unitario = 30 / desglose_deseables.length;
            p_deseables = desglose_deseables.reduce((total, item) => {
                const estado = (item.estado || '').toLowerCase();
                if (estado === 'cumplido') {
                    return total + peso_unitario;
                }
                if (estado === 'parcial') {
                    return total + (peso_unitario * 0.5);
                }
                return total;
            }, 0);
        }
        p_deseables = parseFloat(p_deseables.toFixed(2));

        // 3. Calcular p_alineamiento
        const al_items_calc = content.justificacion_template?.alineamiento_items || {};
        let p_alineamiento = 0;
        let puntos_funciones = 0;
        let puntos_experiencia = 0;
        let puntos_logros = 0;

        if (al_items_calc.funciones?.valor === 'Alta') {
            puntos_funciones = 8;
        } else if (al_items_calc.funciones?.valor === 'Media') {
            puntos_funciones = 4;
        }

        if (al_items_calc.experiencia?.valor === '>3 años') {
            puntos_experiencia = 8;
        } else if (al_items_calc.experiencia?.valor === '1-3 años') {
            puntos_experiencia = 4;
        }

        if (al_items_calc.logros?.valor === 'Sí') {
            puntos_logros = 4;
        }

        p_alineamiento = puntos_funciones + puntos_experiencia + puntos_logros;

        // 4. Calcular Calificación Final
        const suma_total = p_indispensables + p_deseables + p_alineamiento;
        const calificacion_final = Math.round(Math.max(0, Math.min(100, suma_total)));

        // 5. Construir la Justificación Final a partir del template
        const template = content.justificacion_template || {};
        const conclusion = toTitleCase(template.conclusion) || (calificacion_final >= 50 ? "Recomendar" : "Descartar");
        
        const getEmoji = (estado) => {
            const lowerEstado = (estado || '').toLowerCase();
            if (lowerEstado === "cumple" || lowerEstado === "cumplido") return '✅';
            if (lowerEstado === "parcial") return '🟠';
            return '❌';
        };

        const indispensales_html = desglose_indispensables.map(item => {
            const requisito = (item.requisito || '').replace(/\*/g, '');
            const estado = toTitleCase(item.estado || '');
            return `${getEmoji(item.estado)} ${requisito}: ${estado}. ${item.justificacion || ''}`;
        }).join('\n');

        const deseables_html = desglose_deseables.map(item => {
            const competencia = (item.competencia || '').replace(/\*/g, '');
            const estado = toTitleCase(item.estado || '');
            return `${getEmoji(item.estado)} ${competencia}: ${estado}. ${item.justificacion || ''}`;
        }).join('\n');
        
        const al_items = template.alineamiento_items || {};
        const formatAlineamientoItem = (label, data, points, maxPoints, positiveValue, partialValue) => {
            const item = data || {};
            const emoji = item.valor === positiveValue ? '✅' : (item.valor === partialValue ? '🟠' : '❌');
            return `${emoji} ${label} (${points}/${maxPoints} pts): ${item.valor || 'N/A'}. ${item.justificacion || ''}`;
        };

        const alineamiento_html = [
            formatAlineamientoItem('Funciones', al_items.funciones, puntos_funciones, 8, 'Alta', 'Media'),
            formatAlineamientoItem('Experiencia', al_items.experiencia, puntos_experiencia, 8, '>3 años', '1-3 años'),
            formatAlineamientoItem('Logros', al_items.logros, puntos_logros, 4, 'Sí')
        ].join('\n');

        const justificacionFinal = `
CONCLUSIÓN: ${conclusion} - Puntaje: ${calificacion_final}/100
---
A) Requisitos Indispensables (${p_indispensables}/50 pts)
${indispensales_html}

B) Competencias Deseables (${p_deseables}/30 pts)
${deseables_html}

C) Alineamiento (${p_alineamiento}/20 pts)
${alineamiento_html}
        `.trim();

        return {
            nombreCompleto: content.nombreCompleto || 'No especificado',
            email: content.email || 'No especificado',
            telefono: content.telefono || 'No especificado',
            calificacion: calificacion_final,
            justificacion: justificacionFinal
        };
    } catch (e) {
        console.error("Error al parsear la respuesta de la IA o en el cálculo:", e);
        throw new Error("La IA devolvió una respuesta con un formato inesperado.");
    }
}

// --- RENDERIZADO Y UI ---
function renderizarTabla(postulaciones) {
    resumenesListBody.innerHTML = '';
    
    if (postulaciones.length === 0) {
        resumenesListBody.innerHTML = `<tr><td colspan="7" style="text-align: center;">No se encontraron candidatos que coincidan con la búsqueda.</td></tr>`;
        return;
    }

    postulaciones.forEach(postulacion => {
        resumenesListBody.appendChild(crearFila(postulacion));
    });
}

function actualizarFilaEnVista(postulacionId, datosActualizados) {
    const index = postulacionesCache.findIndex(p => p.id === postulacionId);
    if (index > -1) {
        // Actualiza la caché de datos en memoria
        postulacionesCache[index] = { ...postulacionesCache[index], ...datosActualizados };
        
        // Busca la fila existente en el DOM
        const oldRow = resumenesListBody.querySelector(`tr[data-id='${postulacionId}']`);
        if (oldRow) {
            // Crea la nueva fila con los datos actualizados
            const newRow = crearFila(postulacionesCache[index]);
            // Reemplaza la fila antigua por la nueva para actualizar la vista sin reordenar
            oldRow.replaceWith(newRow);
        }
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
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        uploadCvBtn.disabled = true;
        uploadCvBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Preparando subida...`;

        const existingFileNames = new Set(postulacionesCache.map(p => p.nombre_archivo_especifico));
        const newFiles = files.filter(file => !existingFileNames.has(file.name));
        const archivosOmitidos = files.length - newFiles.length;

        const CONCURRENCY_LIMIT = 15;
        let currentIndex = 0;
        const errors = [];

        const processFile = async (file) => {
            try {
                const base64 = await fileToBase64(file);
                const textoCV = await extraerTextoDePDF(file);
                const iaData = await extraerDatosConIA(textoCV);
                await procesarCandidatoYPostulacion(iaData, base64, textoCV, file.name, avisoActivo.id);
            } catch (error) {
                console.error(`Error procesando ${file.name}:`, error);
                errors.push(`${file.name}: ${error.message}`);
            }
        };

        while (currentIndex < newFiles.length) {
            const lote = newFiles.slice(currentIndex, currentIndex + CONCURRENCY_LIMIT);
            const start = currentIndex + 1;
            const end = currentIndex + lote.length;
            uploadCvBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Subiendo y procesando ${start}-${end} de ${newFiles.length}`;
            
            const promesas = lote.map(file => processFile(file));
            await Promise.all(promesas);
            
            currentIndex += lote.length;
        }

        if (archivosOmitidos > 0) {
            alert(`${archivosOmitidos} archivo(s) fueron omitidos porque ya existían en esta búsqueda.`);
        }
        if (errors.length > 0) {
            alert(`Ocurrieron errores al procesar ${errors.length} archivos:\n- ${errors.join('\n- ')}`);
        }
        
        await cargarPostulantes(avisoActivo.id);
        analizarPostulantesPendientes(); // Inicia el análisis completo en segundo plano
        
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
            renderizarTabla(postulacionesCache);
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
    const fileArrayBuffer = await file.arrayBuffer();
    let pdf;

    // Cargar el documento PDF una sola vez
    try {
        pdf = await pdfjsLib.getDocument(fileArrayBuffer).promise;
    } catch (error) {
        console.error("Error al cargar el documento PDF:", error);
        throw new Error("No se pudo cargar el archivo PDF, puede estar corrupto.");
    }

    // --- INTENTO 1: Extracción de texto nativo ---
    try {
        let textoFinal = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            textoFinal += textContent.items.map(item => item.str).join(' ');
        }
        if (textoFinal.trim().length > 50) {
            return textoFinal.trim().replace(/\x00/g, '');
        }
        console.warn("El texto nativo es muy corto, intentando OCR.");
    } catch (error) {
        console.warn("Extracción nativa fallida, se procederá con OCR.", error);
    }

    // --- INTENTO 2: OCR con Tesseract ---
    try {
        const worker = await Tesseract.createWorker('spa');
        let textoCompleto = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: context, viewport: viewport }).promise;
            
            const { data: { text } } = await worker.recognize(canvas.toDataURL());
            textoCompleto += text + '\n';
        }

        await worker.terminate();
        if (textoCompleto.trim()) return textoCompleto;

    } catch (ocrError) {
        console.error("El proceso de OCR falló catastróficamente:", ocrError);
        throw new Error("No se pudo procesar el PDF ni con OCR.");
    }

    throw new Error("El PDF parece estar vacío o no es legible.");
}
async function extraerDatosConIA(texto) {
    const textoLimpio = texto.replace(/\s+/g, ' ').trim();
    const prompt = `
Actúa como un asistente de extracción de datos altamente preciso. Tu única tarea es analizar el siguiente texto de un CV y extraer el nombre completo, la dirección de email y el número de teléfono.

**Instrucciones Clave:**
1.  **Nombre Completo:** Busca el nombre más prominente, usualmente ubicado al principio del documento.
2.  **Email:** Busca un texto que siga el formato de un correo electrónico (ej: texto@dominio.com). Sé flexible con los espacios que puedan haberse colado (ej: texto @ dominio . com).
3.  **Teléfono:** Busca secuencias de números que parezcan un número de teléfono. Pueden incluir prefijos (+54), paréntesis, guiones o espacios. Prioriza números de móvil si hay varios.

**Texto del CV a Analizar:**
"""
${textoLimpio.substring(0, 4000)}
"""

**Formato de Salida Obligatorio:**
Responde únicamente con un objeto JSON válido con las claves "nombreCompleto", "email" y "telefono". Si no puedes encontrar un dato de forma confiable, usa el valor \`null\`. No incluyas ninguna otra explicación o texto fuera del JSON.
`;
    try {
        const { data, error } = await supabase.functions.invoke('openaiv2', { body: { query: prompt } });
        if (error) throw error;
        return JSON.parse(data.message);
    } catch (e) {
        console.error("Error al contactar o parsear la respuesta de la IA:", e);
        return { nombreCompleto: null, email: null, telefono: null };
    }
}
