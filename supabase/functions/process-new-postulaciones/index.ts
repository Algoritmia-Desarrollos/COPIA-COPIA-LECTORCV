import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import OpenAI from 'npm:openai'  // <--- USA ESTE
import { toTitleCase } from "https://deno.land/x/to_title_case/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    const { postulaciones } = await req.json();

    processPostulacionesInBackground(postulaciones, supabaseAdmin);
    
    return new Response(JSON.stringify({ message: "Procesamiento iniciado" }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});

async function processPostulacionesInBackground(postulacionIds, supabase) {
    for (const id of postulacionIds) {
        try {
            const { data: post, error: fetchError } = await supabase
                .from('app_saas_postulaciones')
                .select('texto_cv_especifico, aviso:app_saas_avisos(*)')
                .eq('id', id)
                .single();
            if (fetchError) throw fetchError;

            const iaResult = await calificarCVConIA(post.texto_cv_especifico, post.aviso, supabase);

            await supabase
                .from('app_saas_postulaciones')
                .update({ 
                    calificacion: iaResult.calificacion, 
                    resumen: iaResult.justificacion 
                })
                .eq('id', id);

        } catch (error) {
            console.error(`Error procesando postulación ${id}:`, error.message);
            await supabase
                .from('app_saas_postulaciones')
                .update({ calificacion: -1, resumen: `Error de análisis: ${error.message}` })
                .eq('id', id);
        }
    }
}


async function calificarCVConIA(textoCV, aviso, supabase) {
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
    * 6. Regla de Evaluación de Evidencia (Definición de Estados)

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
Tu tarea es analizar TODAS Y CADA UNA de las competencias deseables presentadas en el aviso original. NO OMITAS NINGUNA bajo ninguna circunstancia. Devuelve un array de objetos en \`desglose_deseables\`. Es OBLIGATORIO que haya la misma cantidad de elementos en este array que condiciones deseables provistas.

-   **Para cada competencia deseable**, determina su estado:
    -   \`"cumplido"\`: Evidencia clara.
    -   \`"parcial"\`: Evidencia parcial (ej: pide "inglés avanzado", CV dice "inglés intermedio").
    -   \`"no cumplido"\`: Sin evidencia de ello. DEBES INCLUIRLO indicando "no cumplido".

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

  const openai = new OpenAI({
    apiKey: Deno.env.get("OPENAI_API_KEY"),
  });

  const chatCompletion = await openai.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
  });
  
  const content = JSON.parse(chatCompletion.choices[0].message.content);

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
      else p_indispensables = 0;
  }

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

  const suma_total = p_indispensables + p_deseables + p_alineamiento;
  const calificacion_final = Math.round(Math.max(0, Math.min(100, suma_total)));

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
      calificacion: calificacion_final,
      justificacion: justificacionFinal
  };
}