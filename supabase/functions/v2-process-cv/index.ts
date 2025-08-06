// supabase/functions/v2-process-cv/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { OpenAI } from "https://deno.land/x/openai/mod.ts";

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// --- ¡NUEVO PROMPT MEJORADO! ---
const HEADHUNTER_PROMPT_V2 = `
Actúa como un Headhunter y Especialista Senior en Reclutamiento y Selección para una consultora de élite. Tu criterio es agudo, analítico y está orientado a resultados. Tu misión es realizar un análisis forense de un CV contra una búsqueda laboral, culminando en una calificación precisa y diferenciada, y una justificación profesional.

**Contexto de la Búsqueda (Job Description):**
{CONTEXTO_AVISO}

**Texto del CV a Analizar:**
"""{TEXTO_CV}"""

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


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
  }

  try {
    const { record: postulacion } = await req.json();
    const textoCV = postulacion.texto_cv_especifico;

    const { data: aviso, error: avisoError } = await supabaseAdmin
      .from('v2_avisos').select('*').eq('id', postulacion.aviso_id).single();
    if (avisoError) throw new Error(`Error al obtener aviso: ${avisoError.message}`);

    const contextoAviso = `
      - Puesto: ${aviso.titulo}
      - Descripción: ${aviso.descripcion}
      - Condiciones Necesarias: ${aviso.condiciones_necesarias.join(', ') || 'No especificadas'}
      - Condiciones Deseables: ${aviso.condiciones_deseables.join(', ') || 'No especificadas'}
    `;
    const finalPrompt = HEADHUNTER_PROMPT_V2
      .replace('{CONTEXTO_AVISO}', contextoAviso)
      .replace('{TEXTO_CV}', textoCV.substring(0, 12000));

    const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! });
    const chatCompletion = await openai.chat.completions.create({
      messages: [{ role: "user", content: finalPrompt }],
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
    });
    
    const iaResult = JSON.parse(chatCompletion.choices[0].message.content);

    // --- ¡LÓGICA ACTUALIZADA! ---
    // Ahora hacemos dos actualizaciones en paralelo para mayor eficiencia.
    await Promise.all([
      // 1. Actualizar la postulación con la calificación y el resumen.
      supabaseAdmin
        .from('v2_postulaciones')
        .update({
          calificacion: iaResult.calificacion,
          resumen: iaResult.justificacion
        })
        .eq('id', postulacion.id),
      
      // 2. Actualizar el perfil del candidato con los datos de contacto extraídos.
      supabaseAdmin
        .from('v2_candidatos')
        .update({
          nombre_candidato: iaResult.nombreCompleto,
          email: iaResult.email, // Actualiza el email si la IA encuentra uno mejor formateado
          telefono: iaResult.telefono,
          updated_at: new Date()
        })
        .eq('id', postulacion.candidato_id)
    ]);
    
    return new Response(JSON.stringify({ success: true, message: `Postulación ${postulacion.id} procesada.` }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Error en la función v2-process-cv:', error.message);
    const { record } = await req.json().catch(() => ({ record: {} }));
    if (record?.id) {
        await supabaseAdmin
            .from('v2_postulaciones')
            .update({ calificacion: -1, resumen: `Error en análisis: ${error.message}` })
            .eq('id', record.id);
    }
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});