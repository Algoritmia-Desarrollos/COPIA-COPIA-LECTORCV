// src/lista-avisos.js

import { supabase } from './supabaseClient.js';
import { escapeHtml } from './utils.js';

// --- SELECTORES DEL DOM ---
const avisoListBody = document.getElementById('aviso-list-body');

// --- LÓGICA PRINCIPAL ---

// Al cargar la página, se ejecuta la función para cargar los avisos.
window.addEventListener('DOMContentLoaded', loadAvisos);

/**
 * Obtiene los avisos desde Supabase y los dibuja en la tabla.
 * Todos los miembros de SelectaCV ven todas las búsquedas: el acceso lo controla la base.
 */
async function loadAvisos() {
    if (!avisoListBody) return;

    try {
        const { data: avisos, error } = await supabase
            .from('v2_avisos')
            .select('id, titulo, valido_hasta, max_cv, postulaciones_count')
            .order('created_at', { ascending: false });

        if (error) throw error;

        renderizarTabla(avisos);

    } catch (error) {
        console.error("Error al cargar los avisos:", error);
        avisoListBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger-color);">Error al cargar los avisos.</td></tr>`;
    }
}

/**
 * Dibuja las filas de la tabla con los datos de los avisos y el conteo de postulaciones.
 * @param {Array} avisos - El array de objetos de avisos desde Supabase.
 */
function renderizarTabla(avisos) {
    // Si no hay avisos, mostrar un mensaje amigable.
    if (!avisos || avisos.length === 0) {
        avisoListBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem;">Aún no has creado ninguna búsqueda laboral.</td></tr>';
        return;
    }

    const filas = document.createDocumentFragment();

    avisos.forEach(aviso => {
        // El conteo viene directamente en la columna `postulaciones_count`.
        const postulacionesCount = aviso.postulaciones_count;

        // Formateamos la fecha para que sea más legible.
        const validoHasta = aviso.valido_hasta
            ? new Date(aviso.valido_hasta).toLocaleDateString('es-AR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                timeZone: 'UTC' // Importante para evitar problemas con la zona horaria del navegador
            })
            : '—';

        const row = document.createElement('tr');
        row.style.cursor = 'pointer';
        row.dataset.avisoId = aviso.id;

        row.innerHTML = `
            <td>${aviso.id}</td>
            <td><strong>${escapeHtml(aviso.titulo)}</strong></td>
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

        filas.appendChild(row);
    });

    avisoListBody.replaceChildren(filas);
}
