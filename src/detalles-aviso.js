// src/detalles-aviso.js

import { supabase } from './supabaseClient.js';

// --- SELECTORES DE ELEMENTOS DEL DOM ---
const avisoTitulo = document.getElementById('aviso-titulo');
const avisoDescripcion = document.getElementById('aviso-descripcion');
const necesariasList = document.getElementById('necesarias-list');
const deseablesList = document.getElementById('deseables-list');
const avisoIdSpan = document.getElementById('aviso-id');
const avisoMaxCvSpan = document.getElementById('aviso-max-cv');
const avisoValidoHastaSpan = document.getElementById('aviso-valido-hasta');
const linkPostulanteInput = document.getElementById('link-postulante');
const copiarLinkBtn = document.getElementById('copiar-link-btn');
const abrirLinkBtn = document.getElementById('abrir-link-btn');
const qrCanvas = document.getElementById('qr-canvas');
const deleteAvisoBtn = document.getElementById('delete-aviso-btn');
const reprocesarBtn = document.getElementById('reprocesar-btn');
const postulacionesTableBody = document.getElementById('postulaciones-table-body');
const spinner = document.getElementById('spinner');

let avisoActivo = null;
let postulaciones = [];

// --- LÓGICA PRINCIPAL AL CARGAR LA PÁGINA ---
window.addEventListener('DOMContentLoaded', async () => {
    // Obtenemos el ID del aviso de los parámetros de la URL
    const params = new URLSearchParams(window.location.search);
    const avisoId = params.get('id');

    // Si no hay ID, redirigimos a la lista de avisos
    if (!avisoId) {
        window.location.href = 'lista-avisos.html';
        return;
    }

    // Cargamos los detalles del aviso y las postulaciones
    spinner.style.display = 'block';
    await loadAvisoDetails(avisoId);
    await loadPostulaciones(avisoId);
    spinner.style.display = 'none';
});

/**
 * Carga los detalles de un aviso específico desde Supabase y puebla la UI.
 * @param {string} id - El ID del aviso a cargar.
 */
async function loadAvisoDetails(id) {
    // Consultamos la nueva tabla v2_avisos
    const { data, error } = await supabase
        .from('v2_avisos')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        console.error('Error cargando los detalles del aviso:', error);
        document.body.innerHTML = `
            <div class="panel-container" style="text-align: center; margin: 2rem auto; max-width: 600px;">
                <h1>Error</h1>
                <p>No se pudo cargar el aviso. Es posible que haya sido eliminado.</p>
                <a href="lista-avisos.html" class="btn btn-primary">Volver a la lista</a>
            </div>`;
        return;
    }

    avisoActivo = data;
    populateUI(avisoActivo);
}

/**
 * Carga las postulaciones asociadas a un aviso.
 * @param {string} avisoId - El ID del aviso.
 */
async function loadPostulaciones(avisoId) {
    const { data, error } = await supabase
        .from('v2_postulaciones')
        .select('*')
        .eq('aviso_id', avisoId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error cargando postulaciones:', error);
        return;
    }
    postulaciones = data;
    renderPostulaciones(postulaciones);
}

/**
 * Renderiza la tabla de postulaciones.
 * @param {Array<object>} postulacionesData - Los datos de las postulaciones.
 */
function renderPostulaciones(postulacionesData) {
    postulacionesTableBody.innerHTML = '';
    if (!postulacionesData || postulacionesData.length === 0) {
        postulacionesTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No hay postulaciones para este aviso.</td></tr>';
        return;
    }

    postulacionesData.forEach(postulacion => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${postulacion.nombre_candidato_snapshot || 'N/A'}</td>
            <td>${postulacion.email_snapshot || 'N/A'}</td>
            <td>${postulacion.telefono_snapshot || 'N/A'}</td>
            <td><span class="calificacion calificacion-${postulacion.calificacion}">${getCalificacionTexto(postulacion.calificacion)}</span></td>
            <td>
                <button class="btn-icon" data-id="${postulacion.id}" title="Ver Resumen"><i class="fa-solid fa-file-alt"></i></button>
                <button class="btn-icon" data-id="${postulacion.id}" title="Ver CV"><i class="fa-solid fa-eye"></i></button>
            </td>
        `;
        postulacionesTableBody.appendChild(tr);
    });
}

function getCalificacionTexto(calificacion) {
    switch (calificacion) {
        case -2: return 'Pendiente';
        case -1: return 'Error';
        case 0: return 'No Cumple';
        case 1: return 'Bajo';
        case 2: return 'Medio';
        case 3: return 'Alto';
        case 4: return 'Muy Alto';
        case 5: return 'Ideal';
        default: return 'N/A';
    }
}

/**
 * Rellena todos los elementos de la página con los datos del aviso.
 * @param {object} aviso - El objeto del aviso obtenido de Supabase.
 */
function populateUI(aviso) {
// ...existing code...
    new QRious({
        element: qrCanvas,
        value: publicLink,
        size: 150,
        padding: 10
    });
}

/**
 * Renderiza una lista de condiciones (necesarias o deseables).
// ...existing code...
        li.style.color = 'var(--text-light)';
        listElement.appendChild(li);
    }
}

// --- ANÁLISIS DE CV CON IA ---

async function analizarCV(textoCV, aviso) {
    const prompt = `
      Analiza el siguiente CV para una posición de "${aviso.titulo}".
      Descripción del puesto: ${aviso.descripcion}.
      Condiciones necesarias: ${aviso.condiciones_necesarias.join(', ')}.
      Condiciones deseables: ${aviso.condiciones_deseables.join(', ')}.

      Extrae la siguiente información en formato JSON:
      - nombre_candidato: Nombre completo del candidato.
      - email: Correo electrónico del candidato.
      - telefono: Teléfono de contacto.
      - resumen: Un resumen de 2 o 3 párrafos sobre la experiencia y habilidades del candidato en relación al puesto.
      - calificacion: Un número del 0 al 5 basado en qué tan bien el candidato cumple con los requisitos (0=no cumple, 1=bajo, 2=medio, 3=alto, 4=muy alto, 5=ideal).

      CV:
      ---
      ${textoCV}
      ---
    `;

    try {
        const { data, error } = await supabase.functions.invoke('openaiv2', {
            body: { query: prompt },
        });

        if (error) {
            throw new Error(`Error al invocar la función de IA: ${error.message}`);
        }
        
        // La respuesta de la función es una cadena JSON, necesitamos analizarla dos veces.
        const messageContent = JSON.parse(data.message);
        return messageContent;

    } catch (e) {
        console.error("Error en el análisis con IA:", e);
        return null;
    }
}


// --- LISTENERS DE BOTONES ---

// Copiar link al portapapeles
copiarLinkBtn.addEventListener('click', () => {
// ...existing code...
    setTimeout(() => {
        copiarLinkBtn.innerHTML = '<i class="fa-solid fa-copy"></i>';
    }, 2000);
});

// Reprocesar todas las postulaciones pendientes
reprocesarBtn.addEventListener('click', async () => {
    const pendientes = postulaciones.filter(p => p.calificacion === -2 && p.texto_cv_especifico);
    if (pendientes.length === 0) {
        alert('No hay postulaciones pendientes para procesar.');
        return;
    }

    const confirmation = confirm(`Se procesarán ${pendientes.length} postulaciones pendientes. ¿Continuar?`);
    if (!confirmation) return;

    reprocesarBtn.disabled = true;
    reprocesarBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Procesando... (0/${pendientes.length})`;

    let procesados = 0;
    for (const postulacion of pendientes) {
        try {
            const resultadoIA = await analizarCV(postulacion.texto_cv_especifico, avisoActivo);

            if (resultadoIA) {
                const { data, error } = await supabase
                    .from('v2_postulaciones')
                    .update({
                        calificacion: resultadoIA.calificacion,
                        resumen: resultadoIA.resumen,
                        nombre_candidato_snapshot: resultadoIA.nombre_candidato,
                        email_snapshot: resultadoIA.email,
                        telefono_snapshot: resultadoIA.telefono,
                    })
                    .eq('id', postulacion.id);

                if (error) throw error;
            } else {
                 await supabase.from('v2_postulaciones').update({ calificacion: -1 }).eq('id', postulacion.id);
            }
        } catch (error) {
            console.error(`Error procesando postulación ${postulacion.id}:`, error);
            await supabase.from('v2_postulaciones').update({ calificacion: -1 }).eq('id', postulacion.id);
        }
        procesados++;
        reprocesarBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Procesando... (${procesados}/${pendientes.length})`;
    }

    reprocesarBtn.disabled = false;
    reprocesarBtn.textContent = 'Reprocesar Pendientes';
    alert('Procesamiento completado.');
    await loadPostulaciones(avisoActivo.id); // Recargar la lista
});


// Eliminar el aviso
deleteAvisoBtn.addEventListener('click', async () => {
// ...existing code...*/