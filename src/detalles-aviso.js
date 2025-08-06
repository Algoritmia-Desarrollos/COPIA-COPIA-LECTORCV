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

let avisoActivo = null;

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

    // Cargamos los detalles del aviso desde la base de datos
    await loadAvisoDetails(avisoId);
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
 * Rellena todos los elementos de la página con los datos del aviso.
 * @param {object} aviso - El objeto del aviso obtenido de Supabase.
 */
function populateUI(aviso) {
    // Llenar campos principales
    avisoTitulo.textContent = aviso.titulo;
    avisoDescripcion.textContent = aviso.descripcion;

    // Renderizar listas de condiciones
    renderCondiciones(necesariasList, aviso.condiciones_necesarias, 'No se especificaron condiciones necesarias.');
    renderCondiciones(deseablesList, aviso.condiciones_deseables, 'No se especificaron condiciones deseables.');

    // Llenar panel de información general
    avisoIdSpan.textContent = aviso.id;
    avisoMaxCvSpan.textContent = aviso.max_cv || 'Ilimitados';
    avisoValidoHastaSpan.textContent = new Date(aviso.valido_hasta).toLocaleDateString('es-AR', { timeZone: 'UTC' });

    // Generar y mostrar el link público para postularse
    const publicLink = `${window.location.origin}/index.html?avisoId=${aviso.id}`;
    linkPostulanteInput.value = publicLink;
    abrirLinkBtn.href = publicLink;

    // Generar Código QR
    new QRious({
        element: qrCanvas,
        value: publicLink,
        size: 150,
        padding: 10
    });
}

/**
 * Renderiza una lista de condiciones (necesarias o deseables).
 * @param {HTMLElement} listElement - El elemento <ul> donde se renderizará la lista.
 * @param {Array<string>} condiciones - El array de strings con las condiciones.
 * @param {string} emptyMessage - Mensaje a mostrar si el array está vacío.
 */
function renderCondiciones(listElement, condiciones, emptyMessage) {
    listElement.innerHTML = '';
    if (condiciones && condiciones.length > 0) {
        condiciones.forEach(condicion => {
            const li = document.createElement('li');
            li.textContent = condicion;
            listElement.appendChild(li);
        });
    } else {
        const li = document.createElement('li');
        li.textContent = emptyMessage;
        li.style.color = 'var(--text-light)';
        listElement.appendChild(li);
    }
}

// --- LISTENERS DE BOTONES ---

// Copiar link al portapapeles
copiarLinkBtn.addEventListener('click', () => {
    linkPostulanteInput.select();
    document.execCommand('copy');
    copiarLinkBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
    setTimeout(() => {
        copiarLinkBtn.innerHTML = '<i class="fa-solid fa-copy"></i>';
    }, 2000);
});

// Eliminar el aviso
deleteAvisoBtn.addEventListener('click', async () => {
    if (!avisoActivo) return;

    const confirmation = confirm(`¿Estás seguro de que quieres eliminar el aviso "${avisoActivo.titulo}"? Esta acción no se puede deshacer y borrará todas sus postulaciones asociadas.`);

    if (confirmation) {
        deleteAvisoBtn.disabled = true;
        deleteAvisoBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Eliminando...';

        // Eliminamos de la tabla v2_avisos. Gracias a "ON DELETE CASCADE" en la BD,
        // se borrarán automáticamente todas las postulaciones asociadas.
        const { error } = await supabase
            .from('v2_avisos')
            .delete()
            .eq('id', avisoActivo.id);

        if (error) {
            alert('Error al eliminar el aviso.');
            console.error('Error eliminando aviso:', error);
            deleteAvisoBtn.disabled = false;
            deleteAvisoBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Eliminar Aviso';
        } else {
            alert('Aviso eliminado correctamente.');
            window.location.href = 'lista-avisos.html'; // Redirigir a la lista
        }
    }
});