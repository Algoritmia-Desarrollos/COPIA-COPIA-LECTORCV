// src/crear-aviso.js

import { supabase } from './supabaseClient.js';
import { llamarFuncion } from './api.js';
import { escapeHtml } from './utils.js';

// --- SELECTORES DE ELEMENTOS DEL DOM ---
const avisoForm = document.getElementById('aviso-form');
const generarDescripcionBtn = document.getElementById('generar-descripcion-btn');
const puestoInput = document.getElementById('puesto-trabajo');
const descripcionTextarea = document.getElementById('descripcion-trabajo');
const successMessage = document.getElementById('success-message');
const errorMessage = document.getElementById('error-message');

// Selectores para las condiciones de la IA
const necesariaInput = document.getElementById('necesaria-input');
const deseableInput = document.getElementById('deseable-input');
const addNecesariaBtn = document.getElementById('add-necesaria-btn');
const addDeseableBtn = document.getElementById('add-deseable-btn');
const necesariasList = document.getElementById('necesarias-list');
const deseablesList = document.getElementById('deseables-list');

// --- ESTADO LOCAL PARA LAS CONDICIONES ---
let condicionesNecesarias = [];
let condicionesDeseables = [];

// --- MANEJO DINÁMICO DE CONDICIONES ---

// Función para renderizar las etiquetas de condiciones en la UI
function renderizarCondiciones(listaElemento, arrayDeCondiciones, tipo) {
    listaElemento.innerHTML = ''; // Limpiar la lista actual
    arrayDeCondiciones.forEach((condicion, index) => {
        const item = document.createElement('div');
        item.className = 'condition-item'; // Usaremos una clase para darle estilo
        item.innerHTML = `
            <span>${escapeHtml(condicion)}</span>
            <button type="button" class="remove-btn" data-index="${index}" data-tipo="${tipo}">&times;</button>
        `;
        listaElemento.appendChild(item);
    });
}

// Listeners para los botones de añadir (+)
addNecesariaBtn.addEventListener('click', () => {
    if (necesariaInput.value.trim()) {
        condicionesNecesarias.push(necesariaInput.value.trim());
        necesariaInput.value = '';
        renderizarCondiciones(necesariasList, condicionesNecesarias, 'necesaria');
    }
});

addDeseableBtn.addEventListener('click', () => {
    if (deseableInput.value.trim()) {
        condicionesDeseables.push(deseableInput.value.trim());
        deseableInput.value = '';
        renderizarCondiciones(deseablesList, condicionesDeseables, 'deseable');
    }
});

// Listener para eliminar condiciones (usando delegación de eventos)
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-btn')) {
        const index = parseInt(e.target.dataset.index, 10);
        const tipo = e.target.dataset.tipo;

        if (tipo === 'necesaria') {
            condicionesNecesarias.splice(index, 1);
            renderizarCondiciones(necesariasList, condicionesNecesarias, 'necesaria');
        } else if (tipo === 'deseable') {
            condicionesDeseables.splice(index, 1);
            renderizarCondiciones(deseablesList, condicionesDeseables, 'deseable');
        }
    }
});

// --- GENERACIÓN CON INTELIGENCIA ARTIFICIAL ---
generarDescripcionBtn.addEventListener('click', async () => {
    const puesto = puestoInput.value.trim();
    if (!puesto) {
        alert("Por favor, primero escribe un título para el puesto.");
        return;
    }

    generarDescripcionBtn.disabled = true;
    generarDescripcionBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Generando...`;

    try {
        const iaResult = await llamarFuncion('generar-aviso', { titulo: puesto });

        descripcionTextarea.value = iaResult.descripcion || '';
        condicionesNecesarias = iaResult.condiciones_necesarias || [];
        condicionesDeseables = iaResult.condiciones_deseables || [];

        renderizarCondiciones(necesariasList, condicionesNecesarias, 'necesaria');
        renderizarCondiciones(deseablesList, condicionesDeseables, 'deseable');

    } catch (error) {
        console.error("Error al generar con IA:", error);
        alert(`Hubo un error al contactar con la IA: ${error.message}`);
    } finally {
        generarDescripcionBtn.disabled = false;
        generarDescripcionBtn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Generar con IA`;
    }
});

// --- ENVÍO DEL FORMULARIO PARA CREAR EL AVISO ---
avisoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitButton = e.target.querySelector('button[type="submit"]');

    successMessage.classList.add('hidden');
    errorMessage.classList.add('hidden');

    submitButton.disabled = true;
    submitButton.textContent = 'Guardando...';

    const nuevoAviso = {
        titulo: puestoInput.value,
        descripcion: descripcionTextarea.value,
        max_cv: parseInt(document.getElementById('max-cv').value, 10),
        valido_hasta: document.getElementById('valido-hasta').value,
        condiciones_necesarias: condicionesNecesarias,
        condiciones_deseables: condicionesDeseables
        // El user_id se asigna automáticamente con el valor por defecto de la base.
    };

    const { error } = await supabase.from('v2_avisos').insert(nuevoAviso);

    if (error) {
        console.error('Error al guardar el aviso:', error);
        errorMessage.textContent = `Error al guardar: ${error.message}`;
        errorMessage.classList.remove('hidden');
        submitButton.disabled = false;
        submitButton.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Guardar y Publicar Aviso';
        return;
    }

    successMessage.classList.remove('hidden');

    setTimeout(() => {
        window.location.href = 'lista-avisos.html'; // Redirigimos a la lista de búsquedas
    }, 1500);
});
