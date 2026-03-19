// src/resumenes.js

import { supabase } from './supabaseClient.js';
import { toTitleCase, showModal, hideModal, formatRelativeDate } from './utils.js';

// --- SELECTORES DEL DOM ---
const reanalizeBtn = document.getElementById('reanalize-btn');
const panelTitle = document.getElementById('panel-title');
const processingStatus = document.getElementById('processing-status');
const postulantesCountDisplay = document.getElementById('postulantes-count-display');
const resumenesListBody = document.getElementById('resumenes-list');
const detailsLinkBtn = document.getElementById('details-link-btn');
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
const minScoreSelect = document.getElementById('min-score-select');
const pipelineFilterSelect = document.getElementById('pipeline-filter-select');
const exportCsvBtn = document.getElementById('export-csv-btn');
// --- ESTADO DE LA APLICACIÓN ---
let avisoActivo = null;
let postulacionesCache = [];
let estadoPipelineEnabled = true; // Siempre habilitado

// --- INICIALIZACIÓN ---
window.addEventListener('DOMContentLoaded', async () => {
    // --- LÓGICA PARA EL BOTÓN DE REANÁLISIS ---
    if (reanalizeBtn) {
        reanalizeBtn.addEventListener('click', async () => {
            if (!avisoActivo) return;

            // Primera confirmación
            if (!confirm("¿Estás seguro de que quieres re-analizar TODOS los candidatos de este aviso? Se borrarán las calificaciones y análisis actuales.")) {
                return;
            }

            // Segunda confirmación
            const confirmationText = prompt("Esta acción es irreversible. Escribe 'ANALIZAR' para confirmar.");
            if (confirmationText !== 'ANALIZAR') {
                alert("Confirmación incorrecta. La operación ha sido cancelada.");
                return;
            }

            reanalizeBtn.disabled = true;
            reanalizeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Reiniciando...';
            try {
                // Poner en null las calificaciones y resúmenes de todas las postulaciones de este aviso
                const { error } = await supabase
                    .from('v2_postulaciones')
                    .update({ calificacion: null, resumen: null })
                    .eq('aviso_id', avisoActivo.id);
                if (error) throw error;
                // Volver a cargar y procesar todo desde cero
                await cargarPostulantes(avisoActivo.id);
                await analizarPostulantesPendientes();
            } catch (error) {
                console.error("Error durante el reanálisis:", error);
                alert("Ocurrió un error al intentar reiniciar los análisis.");
            } finally {
                reanalizeBtn.disabled = false;
                reanalizeBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Reanálisis';
            }
        });
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

    if (minScoreSelect) minScoreSelect.addEventListener('change', applyFiltersAndSort);
    if (pipelineFilterSelect) pipelineFilterSelect.addEventListener('change', applyFiltersAndSort);
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportarCSV);
    document.getElementById('compare-btn')?.addEventListener('click', abrirModalComparacion);

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

// cargarAvisos() eliminado — la sidebar de avisos fue removida del layout

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
    const minScore = parseInt(minScoreSelect?.value || '0', 10);
    const pipelineFilter = pipelineFilterSelect?.value || 'all';

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

    if (minScore > 0) {
        data = data.filter(p => typeof p.calificacion === 'number' && p.calificacion >= minScore);
    }

    if (pipelineFilter !== 'all') {
        data = data.filter(p => {
            const estado = p.estado_postulacion || 'sin_revisar';
            return estado === pipelineFilter;
        });
    }

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
    
    // Try with estado_postulacion; falls back gracefully if column doesn't exist
    let { data, error } = await supabase
        .from('v2_postulaciones')
        .select(`
            id, calificacion, resumen, notas, nombre_archivo_especifico, created_at, estado_postulacion,
            v2_candidatos (id, nombre_candidato, email, telefono, nombre_archivo_general, read)
        `)
        .eq('aviso_id', avisoId);

    if (error && (error.message?.includes('estado_postulacion') || error.code === '42703')) {
        // Columna no existe en DB — cargar sin ella (UI igual muestra el select)
        ({ data, error } = await supabase
            .from('v2_postulaciones')
            .select(`
                id, calificacion, resumen, notas, nombre_archivo_especifico, created_at,
                v2_candidatos (id, nombre_candidato, email, telefono, nombre_archivo_general, read)
            `)
            .eq('aviso_id', avisoId));
    }

    if (error) {
        console.error("Error al cargar postulantes:", error);
        processingStatus.textContent = 'Error al cargar postulantes.';
        return;
    }
    
    postulacionesCache = data || [];
    applyFiltersAndSort(); // Aplicar filtros y orden inicial
    renderStatsBar();
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
        
        if (lote.length > 0) {
            const start = currentIndex + 1;
            const end = Math.min(currentIndex + lote.length, totalNuevas);
            processingStatus.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Analizando candidatos ${start}-${end} de ${totalNuevas}...`;

            const promesas = lote.map(postulacion => analizarUnaPostulacion(postulacion));
            await Promise.all(promesas);

            currentIndex += lote.length;
            
            // Ceder el control al navegador antes de procesar el siguiente lote
            setTimeout(procesarLote, 0); 
        } else {
            processingStatus.textContent = `¡Análisis completado! Se han procesado ${totalNuevas} nuevos candidatos.`;
        }
    };

    // Iniciar el primer lote
    setTimeout(procesarLote, 0);
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
5.  **Regla de Inferencia Lógica**: Debes inferir información que es de conocimiento común o se deduce lógicamente del contexto.
    * **Ejemplo Clave (Género)**: Si un requisito es "Sexo Femenino" y el nombre del candidato es "Sofía Rodríguez", debes marcarlo como **"Cumple"**. Es una inferencia lógica y razonable basada en el nombre. No lo marques como "No Cumple" o "Parcial" solo porque el CV no dice explícitamente "Género: Femenino".
    * **Ejemplo (Título Profesional)**: Si el nombre es "Lic. Juan Pérez", infiere que tiene una licenciatura.
    * 
6. Regla de Evaluación de Evidencia (Definición de Estados)

Para determinar el estado de cada requisito (Cumple, Parcial, No Cumple), utiliza la siguiente jerarquía de evidencia:

### Lógica de Evaluación de Requisitos

Para determinar el estado de cada requisito ("Cumple", "Parcial", "No Cumple"), sigue esta jerarquía estricta:

A) Estado: Cumple
Se usa EXCLUSIVAMENTE cuando hay evidencia clara, ya sea directa o por una inferencia lógica fuerte.
* Evidencia Directa:** El CV contiene texto que satisface el requisito.
    Ejemplo:* Aviso pide "Licenciatura en Administración". CV dice "Título: Lic. en Administración". -> **Cumple**.
* Inferencia Lógica Fuerte (Más importante que la omisión):** Debes inferir activamente información obvia. ESTA REGLA ANULA LA OMISIÓN DE TEXTO.
    Ejemplo Clave:* Aviso pide "Sexo Femenino". El nombre del candidato es "Priscila Solis" o "Maria López". -> **Cumple**. Justificación: "Se infiere el cumplimiento por el nombre del candidato." No lo marques como "No Cumple" solo porque el CV no dice "género: femenino".
    Ejemplo de Título:* El candidato firma como "Lic. Juan Pérez". -> **Cumple** el requisito de tener una licenciatura.

B) Estado: Parcial
Se usa cuando el CV muestra una proximidad o cumplimiento incompleto. El candidato está cerca, pero no al 100%.
* Proximidad de Competencia:** Demuestra una habilidad muy similar.
    Ejemplo:* Aviso pide "Experiencia en SAP". CV dice "Manejo de Oracle ERP". -> **Parcial**.
* Cumplimiento Cuantitativo Incompleto:** Cumple una parte significativa del requisito numérico.
    Ejemplo:* Aviso pide "5 años de experiencia". CV demuestra 3.5 años. -> **Parcial**.

C) Estado: No Cumple
Se usa **SOLO SI** no se puede aplicar "Cumple" (ni por evidencia ni por inferencia) o "Parcial".
* Omisión Total SIN Inferencia Posible:** El CV no menciona el requisito y no hay ninguna pista para inferirlo.
    *Ejemplo:* Aviso pide "Carnet de conducir". El CV no lo menciona en ninguna parte. -> **No Cumple**.
* Contradicción Directa:** El CV presenta información que choca frontalmente con el requisito.
    * *Ejemplo:* Aviso pide "Residir en Rosario". CV dice "Residencia actual: Córdoba Capital". -> **No Cumple**.

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
if (error) {
    console.error("🔥 ERROR REAL SUPABASE:", error); // Muestra el error en la consola (F12)
    throw new Error(`Error IA: ${JSON.stringify(error)}`); // Muestra el error en la pantalla
}    }

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
            else if (parciales === 3) p_indispensables = 20;
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
    renderStatsBar();
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
    const isLeido = candidato?.read === true;
    const fechaPostulacion = formatRelativeDate(postulacion.created_at);

    if (!isLeido) row.classList.add('unread');

    const telefonoWA = telefono.replace(/\D/g, '');
    const msgWA = encodeURIComponent(`Hola ${nombre}, te contactamos en relación a tu postulación.`);
    const waBtnHTML = telefonoWA ? `<a href="https://wa.me/${telefonoWA}?text=${msgWA}" target="wa_window" rel="noopener noreferrer" class="btn btn-secondary btn-sm" title="Enviar WhatsApp" style="display:inline-flex;align-items:center;"><i class="fa-brands fa-whatsapp" style="color:#25d366; font-size:1rem;"></i></a>` : '';

    const estadoPipeline = postulacion.estado_postulacion || 'sin_revisar';
    const pipelineClass = {
        en_proceso: 'ps-en-proceso',
        entrevistado: 'ps-entrevistado',
        descartado: 'ps-descartado',
        contratado: 'ps-contratado'
    }[estadoPipeline] || '';

    row.innerHTML = `
        <td><input type="checkbox" class="postulacion-checkbox" data-id="${postulacion.id}"></td>
        <td>
            <strong class="candidate-name">${nombre} ${tieneNota ? '<i class="fa-solid fa-note-sticky text-light" style="font-size:0.75rem;"></i>' : ''}</strong>
            <div class="candidate-filename">${postulacion.nombre_archivo_especifico || 'No Identificado'}</div>
        </td>
        <td>
            <div style="white-space: normal; overflow: visible; font-size:0.8rem;">${email}</div>
            <div style="display:flex; align-items:center; gap:0.3rem; flex-wrap:wrap;">
                <span class="text-light" style="font-size:0.75rem;">${telefono}</span>
                ${waBtnHTML}
            </div>
        </td>
        <td style="font-size: 0.78rem; color: var(--text-light); white-space: nowrap;" title="${postulacion.created_at ? new Date(postulacion.created_at).toLocaleDateString('es-AR') : ''}">${fechaPostulacion}</td>
        <td>${calificacionHTML}</td>
        <td>
            <select class="pipeline-select ${pipelineClass}" data-action="set-pipeline">
                <option value="sin_revisar" ${estadoPipeline === 'sin_revisar' ? 'selected' : ''}>Sin estado</option>
                <option value="en_proceso" ${estadoPipeline === 'en_proceso' ? 'selected' : ''}>En proceso</option>
                <option value="entrevistado" ${estadoPipeline === 'entrevistado' ? 'selected' : ''}>Entrevistado</option>
                <option value="descartado" ${estadoPipeline === 'descartado' ? 'selected' : ''}>Descartado</option>
                <option value="contratado" ${estadoPipeline === 'contratado' ? 'selected' : ''}>Contratado</option>
            </select>
        </td>
        <td style="text-align:right;">
            <div class="actions-group" style="justify-content:flex-end;">
                <button class="btn btn-secondary btn-sm" data-action="ver-resumen" title="Ver análisis" ${!postulacion.resumen ? 'disabled' : ''}><i class="fa-solid fa-chart-bar"></i></button>
                <button class="btn btn-secondary btn-sm" data-action="ver-notas" title="${tieneNota ? 'Ver notas' : 'Agregar nota'}" style="${tieneNota ? 'color: var(--primary-color);' : 'opacity:0.45;'}"><i class="fa-solid fa-note-sticky"></i></button>
                <button class="btn btn-secondary btn-sm" data-action="toggle-leido" title="${isLeido ? 'Marcar no leído' : 'Marcar leído'}"><i class="fa-solid ${isLeido ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                <button class="btn btn-primary btn-sm" data-action="ver-cv" title="Descargar CV"><i class="fa-solid fa-download"></i></button>
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
    row.querySelector('[data-action="ver-resumen"]').addEventListener('click', () => {
        marcarComoLeido(postulacion, row);
        abrirModalResumen(postulacion);
    });
    row.querySelector('[data-action="ver-notas"]').addEventListener('click', () => toggleInlineNotas(postulacion, row));

    const pipelineSel = row.querySelector('[data-action="set-pipeline"]');
    if (pipelineSel) {
        pipelineSel.addEventListener('change', () => {
            const nuevoEstado = pipelineSel.value;
            // Update class
            pipelineSel.className = 'pipeline-select';
            if (nuevoEstado !== 'sin_revisar') pipelineSel.classList.add(`ps-${nuevoEstado}`);
            updateEstadoPipeline(postulacion.id, nuevoEstado);
            postulacion.estado_postulacion = nuevoEstado;
        });
    }
    row.querySelector('[data-action="toggle-leido"]').addEventListener('click', () => toggleLeido(postulacion, row));
    
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

    const compareBtn = document.getElementById('compare-btn');
    if (compareBtn) {
        compareBtn.classList.toggle('hidden', selectedIds.length < 2 || selectedIds.length > 3);
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

// --- MODAL RICO DE ANÁLISIS ---
function abrirModalResumen(postulacion) {
    const candidato = postulacion.v2_candidatos;
    const nombre = candidato?.nombre_candidato || postulacion.nombre_candidato_snapshot || 'N/A';
    const email = candidato?.email || '';
    const telefono = candidato?.telefono || '';
    const score = postulacion.calificacion ?? 0;
    modalTitle.textContent = nombre;

    const scoreColor = score >= 70 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
    const initials = nombre.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

    modalResumenContent.innerHTML = `
        <div class="modal-candidate-header">
            <div class="modal-avatar">${initials}</div>
            <div class="modal-contact-links">
                ${email ? `<a href="mailto:${email}" class="contact-link"><i class="fa-solid fa-envelope"></i> ${email}</a>` : ''}
                ${telefono ? `<a href="tel:${telefono}" class="contact-link"><i class="fa-solid fa-phone"></i> ${telefono}</a>` : ''}
            </div>
        </div>
        <div class="modal-score-section">
            <div class="score-label">Calificación: <strong style="color:${scoreColor}">${score}/100</strong></div>
            <div class="score-bar-container">
                <div class="score-bar-fill" style="width:${score}%; background-color:${scoreColor};"></div>
            </div>
        </div>
        ${renderResumenEstructurado(postulacion.resumen)}
    `;

    showModal('modal-container');
}

function renderResumenEstructurado(resumen) {
    if (!resumen) return '<p style="color:var(--text-light);">No hay análisis disponible.</p>';
    const lines = resumen.split('\n').map(l => l.trim()).filter(l => l);
    const sections = [];
    let current = null;
    lines.forEach(line => {
        if (line === '---' || line.startsWith('CONCLUSIÓN:')) return;
        if (/^[A-C]\)/.test(line)) {
            if (current) sections.push(current);
            current = { title: line, items: [] };
        } else if (current && /^[✅🟠❌]/.test(line)) {
            current.items.push(line);
        }
    });
    if (current) sections.push(current);

    return sections.map(sec => {
        const itemsHTML = sec.items.map(item => {
            const emoji = [...item][0];
            const badgeClass = emoji === '✅' ? 'badge-success' : emoji === '🟠' ? 'badge-warning' : 'badge-danger';
            const badgeText = emoji === '✅' ? 'Cumple' : emoji === '🟠' ? 'Parcial' : 'No Cumple';
            const text = item.replace(/^.\s*/, '');
            const colonIdx = text.indexOf(':');
            let label = text, justif = '';
            if (colonIdx > -1) {
                label = text.substring(0, colonIdx).trim();
                justif = text.substring(colonIdx + 1).trim()
                    .replace(/^(Cumple|Parcial|No Cumple|Cumplido|No Cumplido|Alta|Media|Baja|Sí|No|>3 años|1-3 años|<1 año)\.\s*/i, '');
            }
            return `<div class="analysis-item">
                <span class="analysis-item-label">${label}</span>
                <span class="badge ${badgeClass}">${badgeText}</span>
                ${justif ? `<span class="analysis-item-justif">${justif}</span>` : ''}
            </div>`;
        }).join('');
        return `<div class="analysis-section">
            <div class="analysis-section-title">${sec.title}</div>
            <div class="analysis-items">${itemsHTML}</div>
        </div>`;
    }).join('');
}

// --- NOTAS INLINE ---
function toggleInlineNotas(postulacion, row) {
    const existingRow = document.getElementById(`notas-row-${postulacion.id}`);
    if (existingRow) { existingRow.remove(); return; }
    document.querySelectorAll('.inline-notes-row').forEach(r => r.remove());

    const notasRow = document.createElement('tr');
    notasRow.id = `notas-row-${postulacion.id}`;
    notasRow.className = 'inline-notes-row';
    notasRow.innerHTML = `
        <td colspan="7">
            <div class="inline-notes-container">
                <textarea class="inline-notes-textarea form-control" placeholder="Escribe una nota sobre este candidato...">${postulacion.notas || ''}</textarea>
                <div class="inline-notes-actions">
                    <button class="btn btn-primary btn-sm" data-action="save-notas-inline">Guardar</button>
                    <button class="btn btn-secondary btn-sm" data-action="cancel-notas-inline">Cancelar</button>
                </div>
            </div>
        </td>
    `;
    row.insertAdjacentElement('afterend', notasRow);
    notasRow.querySelector('textarea').focus();
    notasRow.querySelector('[data-action="save-notas-inline"]').addEventListener('click', async () => {
        const nuevasNotas = notasRow.querySelector('textarea').value;
        const { error } = await supabase.from('v2_postulaciones').update({ notas: nuevasNotas }).eq('id', postulacion.id);
        if (!error) {
            actualizarFilaEnVista(postulacion.id, { notas: nuevasNotas });
            notasRow.remove();
        }
    });
    notasRow.querySelector('[data-action="cancel-notas-inline"]').addEventListener('click', () => notasRow.remove());
}

// --- STATS BAR ---
function renderStatsBar() {
    const container = document.getElementById('aviso-stats-bar');
    if (!container) return;
    if (!postulacionesCache.length) { container.innerHTML = ''; return; }

    const conScore = postulacionesCache.filter(p => typeof p.calificacion === 'number' && p.calificacion >= 0);
    const avgScore = conScore.length ? Math.round(conScore.reduce((s, p) => s + p.calificacion, 0) / conScore.length) : 0;
    const altos = conScore.filter(p => p.calificacion >= 70).length;
    const medios = conScore.filter(p => p.calificacion >= 40 && p.calificacion < 70).length;
    const bajos = conScore.filter(p => p.calificacion < 40).length;

    const estados = { sin_revisar: 0, en_proceso: 0, entrevistado: 0, descartado: 0, contratado: 0 };
    postulacionesCache.forEach(p => {
        const e = p.estado_postulacion || 'sin_revisar';
        if (e in estados) estados[e]++;
    });

    container.innerHTML = `
        <div class="stats-bar">
            <div class="stat-item"><span class="stat-value">${postulacionesCache.length}</span><span class="stat-label">Total</span></div>
            <div class="stat-item"><span class="stat-value">${avgScore}</span><span class="stat-label">Prom.</span></div>
            <div class="stat-item stat-success"><span class="stat-value">${altos}</span><span class="stat-label">≥70</span></div>
            <div class="stat-item stat-warning"><span class="stat-value">${medios}</span><span class="stat-label">40-69</span></div>
            <div class="stat-item stat-danger"><span class="stat-value">${bajos}</span><span class="stat-label">&lt;40</span></div>
            <div class="stat-divider"></div>
            <div class="stat-item"><span class="stat-value">${estados.en_proceso}</span><span class="stat-label">En proceso</span></div>
            <div class="stat-item"><span class="stat-value">${estados.entrevistado}</span><span class="stat-label">Entrevist.</span></div>
            <div class="stat-item"><span class="stat-value">${estados.contratado}</span><span class="stat-label">Contratado</span></div>
            <div class="stat-item"><span class="stat-value">${estados.descartado}</span><span class="stat-label">Descartado</span></div>
        </div>
    `;
}

// --- COMPARACIÓN DE CANDIDATOS ---
function abrirModalComparacion() {
    const selectedIds = getSelectedPostulacionIds().slice(0, 3);
    const candidatos = postulacionesCache.filter(p => selectedIds.includes(p.id.toString()));
    if (candidatos.length < 2) return;

    const compareBody = document.getElementById('compare-modal-body');
    compareBody.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(${candidatos.length}, 1fr); gap: 1rem; align-items: start;">
            ${candidatos.map(p => {
                const c = p.v2_candidatos;
                const nombre = c?.nombre_candidato || 'N/A';
                const email = c?.email || '';
                const telefono = c?.telefono || '';
                const score = p.calificacion ?? 0;
                const scoreColor = score >= 70 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
                const initials = nombre.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
                return `
                    <div style="border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1rem;">
                        <div style="display:flex; align-items:center; gap:0.75rem; margin-bottom:0.75rem;">
                            <div class="modal-avatar" style="width:38px;height:38px;font-size:0.9rem;flex-shrink:0;">${initials}</div>
                            <div>
                                <div style="font-weight:600; font-size:0.9rem;">${nombre}</div>
                                ${email ? `<div style="font-size:0.75rem; color:var(--text-light);">${email}</div>` : ''}
                                ${telefono ? `<div style="font-size:0.75rem; color:var(--text-light);">${telefono}</div>` : ''}
                            </div>
                        </div>
                        <div class="score-bar-container" style="margin-bottom:0.5rem;">
                            <div class="score-bar-fill" style="width:${score}%; background-color:${scoreColor};"></div>
                        </div>
                        <div style="font-weight:700; color:${scoreColor}; margin-bottom:0.75rem;">${score}/100</div>
                        <div style="font-size:0.8rem;">${renderResumenEstructurado(p.resumen)}</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
    showModal('compare-modal-container');
}

// --- ESTADO PIPELINE ---
async function updateEstadoPipeline(postulacionId, estado) {
    const { error } = await supabase.from('v2_postulaciones').update({ estado_postulacion: estado }).eq('id', postulacionId);
    if (error) console.error('Error actualizando estado pipeline:', error);
}

// --- EXPORT XLSX (todos los candidatos del aviso, estético) ---
async function exportarCSV() {
    if (!postulacionesCache.length) return;
    const aviso = avisoActivo?.titulo || 'candidatos';

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Selecta CV';
    const ws = wb.addWorksheet('Candidatos', { views: [{ state: 'frozen', ySplit: 1 }] });

    ws.columns = [
        { header: 'Nombre Candidato',   key: 'nombre',    width: 32 },
        { header: 'Email',              key: 'email',     width: 36 },
        { header: 'Teléfono',           key: 'telefono',  width: 18 },
        { header: 'Calificación',       key: 'score',     width: 14 },
        { header: 'Estado Pipeline',    key: 'pipeline',  width: 18 },
        { header: 'Notas',              key: 'notas',     width: 40 },
        { header: 'Fecha Postulación',  key: 'fecha',     width: 18 },
        { header: 'Archivo CV',         key: 'archivo',   width: 36 },
    ];

    // Header row styling
    const headerRow = ws.getRow(1);
    headerRow.height = 28;
    headerRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
        cell.border = { bottom: { style: 'medium', color: { argb: 'FF3730A3' } } };
    });

    // Data rows
    postulacionesCache.forEach((p, i) => {
        const c = p.v2_candidatos;
        const score = p.calificacion;
        const row = ws.addRow({
            nombre:   c?.nombre_candidato || '',
            email:    c?.email || '',
            telefono: c?.telefono || '',
            score:    typeof score === 'number' ? score : '',
            pipeline: p.estado_postulacion || 'sin_revisar',
            notas:    p.notas || '',
            fecha:    p.created_at ? new Date(p.created_at).toLocaleDateString('es-AR') : '',
            archivo:  p.nombre_archivo_especifico || '',
        });
        row.height = 20;

        const bgColor = i % 2 === 0 ? 'FFF5F5FF' : 'FFFFFFFF';
        row.eachCell({ includeEmpty: true }, cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
            cell.alignment = { vertical: 'middle' };
            cell.font = { size: 10, name: 'Calibri' };
            cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
        });

        // Color-code score cell
        const scoreCell = row.getCell('score');
        if (typeof score === 'number') {
            const scoreColor = score >= 70 ? 'FF16A34A' : score >= 50 ? 'FFD97706' : 'FFDC2626';
            scoreCell.font = { bold: true, color: { argb: scoreColor }, size: 10 };
            scoreCell.alignment = { horizontal: 'center', vertical: 'middle' };
        }

        // Color-code pipeline cell
        const pipelineCell = row.getCell('pipeline');
        const pColors = { en_proceso: 'FF1D4ED8', entrevistado: 'FF6D28D9', descartado: 'FFB91C1C', contratado: 'FF15803D' };
        const pc = pColors[p.estado_postulacion];
        if (pc) pipelineCell.font = { bold: true, color: { argb: pc }, size: 10 };
    });

    ws.autoFilter = { from: 'A1', to: 'H1' };

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${aviso.replace(/[^a-zA-Z0-9]/g, '_')}_candidatos.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
}

// --- LEÍDO / NO LEÍDO ---
async function marcarComoLeido(postulacion, row) {
    const candidato = postulacion.v2_candidatos;
    if (!candidato || candidato.read) return;
    await supabase.from('v2_candidatos').update({ read: true }).eq('id', candidato.id);
    candidato.read = true;
    row.classList.remove('unread');
    const btn = row.querySelector('[data-action="toggle-leido"]');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
}

async function toggleLeido(postulacion, row) {
    const candidato = postulacion.v2_candidatos;
    if (!candidato) return;
    const nuevoEstado = !candidato.read;
    await supabase.from('v2_candidatos').update({ read: nuevoEstado }).eq('id', candidato.id);
    candidato.read = nuevoEstado;
    row.classList.toggle('unread', !nuevoEstado);
    const btn = row.querySelector('[data-action="toggle-leido"]');
    if (btn) {
        btn.innerHTML = `<i class="fa-solid ${nuevoEstado ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
        btn.title = nuevoEstado ? 'Marcar no leído' : 'Marcar leído';
    }
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
        read: false,
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
