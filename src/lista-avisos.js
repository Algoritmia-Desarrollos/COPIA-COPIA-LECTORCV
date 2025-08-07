// src/lista-avisos.js

import { supabase } from './supabaseClient.js';

// --- SELECTORES DEL DOM ---
const avisoListBody = document.getElementById('aviso-list-body');

// --- LÓGICA PRINCIPAL ---

// Al cargar la página, se ejecuta la función para cargar los avisos.
window.addEventListener('DOMContentLoaded', loadAvisos);

/**
 * Obtiene los datos de los avisos y las postulaciones desde Supabase
 * y luego llama a la función para renderizar la tabla.
 */
async function loadAvisos() {
    if (!avisoListBody) return;

    try {
        // Hacemos una única consulta que trae los datos del aviso, incluyendo el contador.
        const { data: avisos, error } = await supabase
            .from('v2_avisos')
            .select('id, titulo, valido_hasta, max_cv, postulaciones_count')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Si la consulta es exitosa, renderizamos la tabla
        renderizarTabla(avisos);

    } catch (error) {
        console.error("Error al cargar los avisos:", error);
        avisoListBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger-color);">Error al cargar los avisos.</td></tr>`;
    }
}

/**
 * Dibuja las filas de la tabla con los datos de los avisos y el conteo de postulaciones.
 * @param {Array} avisos - El array de objetos de avisos desde Supabase.
 * @param {Array} postulaciones - El array de objetos de postulaciones para contar.
 */
function renderizarTabla(avisos) {
    // Si no hay avisos, mostrar un mensaje amigable.
    if (!avisos || avisos.length === 0) {
        avisoListBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem;">Aún no has creado ninguna búsqueda laboral.</td></tr>';
        return;
    }

    // Limpiar el estado de "Cargando..."
    avisoListBody.innerHTML = '';

    // Iteramos sobre cada aviso para crear su fila en la tabla.
    avisos.forEach(aviso => {
        // El conteo ahora viene directamente en la columna `postulaciones_count`.
        const postulacionesCount = aviso.postulaciones_count;
        
        // Formateamos la fecha para que sea más legible.
        const validoHasta = new Date(aviso.valido_hasta).toLocaleDateString('es-AR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'UTC' // Importante para evitar problemas con la zona horaria del navegador
        });

        const row = document.createElement('tr');
        row.style.cursor = 'pointer';
        row.dataset.avisoId = aviso.id;

        row.innerHTML = `
            <td>${aviso.id}</td>
            <td><strong>${aviso.titulo}</strong></td>
            <td>${postulacionesCount} / ${aviso.max_cv || 'Ilimitados'}</td>
            <td>${validoHasta}</td>
            <td>
                <div class="actions-group">
                    <a href="resumenes.html?avisoId=${aviso.id}" class="btn btn-secondary">Ver Postulantes</a>
                    <a href="detalles-aviso.html?id=${aviso.id}&count=${postulacionesCount}" class="btn btn-secondary">Detalles</a>
                </div>
            </td>
        `;

        row.addEventListener('click', (e) => {
            // Si el clic fue en un botón o un enlace dentro de la fila, no hacer nada.
            if (e.target.closest('a, button')) {
                return;
            }
            // Si no, navegar a la página de postulantes.
            window.location.href = `resumenes.html?avisoId=${aviso.id}`;
        });

        avisoListBody.appendChild(row);
    });
}
