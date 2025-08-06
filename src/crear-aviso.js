// src/crear-aviso.js

import { supabase } from './supabaseClient.js';

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
            <span>${condicion}</span>
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

    const prompt = `
      Actúa como un experto en RRHH. Crea el contenido para una búsqueda laboral con el título: "${puesto}".
      Tu respuesta DEBE SER únicamente un objeto JSON con 3 claves: "descripcion" (un párrafo de 80-150 palabras), "condiciones_necesarias" (un array de 4 strings), y "condiciones_deseables" (un array de 3 strings).
    `;

    try {
        const { data, error } = await supabase.functions.invoke('openai', {
            body: { query: prompt },
        });

        if (error) throw error;

        const iaResult = JSON.parse(data.message);

        descripcionTextarea.value = iaResult.descripcion || '';
        condicionesNecesarias = iaResult.condiciones_necesarias || [];
        condicionesDeseables = iaResult.condiciones_deseables || [];

        renderizarCondiciones(necesariasList, condicionesNecesarias, 'necesaria');
        renderizarCondiciones(deseablesList, condicionesDeseables, 'deseable');

    } catch (error) {
        console.error("Error al generar con IA:", error);
        alert("Hubo un error al contactar con la IA. Por favor, inténtalo de nuevo.");
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
        // El user_id se asignará automáticamente gracias a la política de RLS y el valor por defecto en la DB.
    };

    // Insertamos en la nueva tabla v2_avisos
    const { error } = await supabase.from('v2_avisos').insert(nuevoAviso);

    if (error) {
        console.error('Error al guardar el aviso:', error);
        errorMessage.textContent = `Error al guardar: ${error.message}`;
        errorMessage.classList.remove('hidden');
        submitButton.disabled = false;
        submitButton.textContent = 'Guardar y Publicar Aviso';
        return;
    }

    successMessage.classList.remove('hidden');
    
    // Opcional: Limpiar el formulario y redirigir
    setTimeout(() => {
        window.location.href = 'lista-avisos.html'; // Redirigimos a la lista de búsquedas
    }, 2000);
});