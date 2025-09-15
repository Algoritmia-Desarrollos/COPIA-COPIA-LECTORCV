// supabase/functions/v2-process-cv/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { OpenAI } from "https://deno.land/x/openai/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Se crea un cliente de Supabase con permisos de administrador para poder interactuar con la DB
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Se inicializa el cliente de OpenAI
const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

function toTitleCase(str: string | null): string | null {
  if (!str || typeof str !== 'string') return null;
  return str.toLowerCase().trim().replace(/\s+/g, ' ').split(' ').map(word => {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { record: postulacion } = await req.json();
    const { id: postulacionId, aviso_id, texto_cv_especifico } = postulacion;

    if (!postulacionId || !aviso_id || !texto_cv_especifico) {
      return new Response(JSON.stringify({ error: "Faltan datos clave (postulacionId, aviso_id, o texto_cv)." }), { status: 400, headers: corsHeaders });
    }

    // 1. Obtener los detalles del aviso para construir el prompt
    const { data: aviso, error: avisoError } = await supabaseAdmin
      .from("v2_avisos")
      .select("titulo, descripcion, condiciones_necesarias, condiciones_deseables")
      .eq("id", aviso_id)
      .single();

    if (avisoError) throw new Error(`Error al obtener el aviso: ${avisoError.message}`);

    const condicionesNecesariasTexto = (aviso.condiciones_necesarias || []).map((req, i) => `${i + 1}. ${req}`).join('\n');
    const condicionesDeseablesTexto = (aviso.condiciones_deseables || []).map((req, i) => `${i + 1}. ${req}`).join('\n');
    const contextoAviso = `Puesto: ${aviso.titulo}\nDescripción: ${aviso.descripcion}\n\nCondiciones Necesarias:\n${condicionesNecesariasTexto}\n\nCondiciones Deseables:\n${condicionesDeseablesTexto}`;
    
    // 2. Construir el prompt avanzado (el mismo que tenías en el frontend)
    const prompt = `
    Eres un analista de RRHH experto. Tu misión es analizar el CV y compararlo con el aviso para devolver UN ÚNICO OBJETO JSON válido.

    ### Lógica de Evaluación de Requisitos
    Sigue esta jerarquía estricta:
    A) Estado: Cumple: Se usa si hay evidencia directa o una inferencia lógica fuerte (ej. inferir género por nombre como "Priscila"). Esta regla anula la omisión de texto.
    B) Estado: Parcial: Se usa para proximidad o cumplimiento incompleto (ej. pide 5 años de exp, tiene 4).
    C) Estado: No Cumple: Se usa SOLO si no se puede aplicar "Cumple" o "Parcial".

    ### ENTRADAS
    JOB DESCRIPTION:
    ${contextoAviso}

    CV (texto extraído):
    """${texto_cv_especifico.substring(0, 12000)}"""

    ### FORMATO DE SALIDA (JSON ÚNICO)
    {
      "nombreCompleto": "string o null",
      "email": "string o null",
      "telefono": "string o null",
      "desglose_indispensables": [{ "requisito": "string", "estado": "Cumple|Parcial|No Cumple", "justificacion": "string" }],
      "desglose_deseables": [{ "competencia": "string", "estado": "cumplido|parcial|no cumplido", "justificacion": "string" }],
      "justificacion_template": {
        "conclusion": "Recomendar|Considerar|Descartar",
        "alineamiento_items": {
            "funciones": { "valor": "Alta|Media|Baja", "justificacion": "string" },
            "experiencia": { "valor": ">3 años|1-3 años|<1 año", "justificacion": "string" },
            "logros": { "valor": "Sí|No", "justificacion": "string" }
        }
      }
    }`;

    // 3. Llamar a la API de OpenAI
    const chatCompletion = await openai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
    });

    const content = JSON.parse(chatCompletion.choices[0].message.content!);

    // 4. Calcular el puntaje (misma lógica que tenías en el frontend)
    const desglose_indispensables = content.desglose_indispensables || [];
    let p_indispensables = 0;
    const estados_indispensables = desglose_indispensables.map(item => item.estado);

    if (estados_indispensables.includes("No Cumple")) {
        p_indispensables = 0;
    } else {
        const parciales = estados_indispensables.filter(e => e === "Parcial").length;
        if (parciales === 0) p_indispensables = 50; else if (parciales <= 2) p_indispensables = 40 - (parciales-1)*10; else p_indispensables = 0;
    }

    const desglose_deseables = content.desglose_deseables || [];
    let p_deseables = 0;
    if (desglose_deseables.length > 0) {
        const peso = 30 / desglose_deseables.length;
        p_deseables = desglose_deseables.reduce((total, item) => {
            if (item.estado === 'cumplido') return total + peso;
            if (item.estado === 'parcial') return total + (peso * 0.5);
            return total;
        }, 0);
    }
    
    const al_items = content.justificacion_template?.alineamiento_items || {};
    const puntos_funciones = al_items.funciones?.valor === 'Alta' ? 8 : (al_items.funciones?.valor === 'Media' ? 4 : 0);
    const puntos_experiencia = al_items.experiencia?.valor === '>3 años' ? 8 : (al_items.experiencia?.valor === '1-3 años' ? 4 : 0);
    const puntos_logros = al_items.logros?.valor === 'Sí' ? 4 : 0;
    const p_alineamiento = puntos_funciones + puntos_experiencia + puntos_logros;
    
    const calificacion_final = Math.round(p_indispensables + p_deseables + p_alineamiento);

    // 5. Construir el resumen final
    const getEmoji = (estado) => (estado?.toLowerCase() === "cumple" || estado?.toLowerCase() === "cumplido") ? '✅' : (estado?.toLowerCase() === "parcial" ? '🟠' : '❌');
    const indispensales_html = desglose_indispensables.map(item => `${getEmoji(item.estado)} ${item.requisito}: ${item.estado}. ${item.justificacion || ''}`).join('\n');
    const deseables_html = desglose_deseables.map(item => `${getEmoji(item.estado)} ${item.competencia}: ${item.estado}. ${item.justificacion || ''}`).join('\n');
    const conclusion = content.justificacion_template?.conclusion || (calificacion_final >= 50 ? "Recomendar" : "Descartar");

    const justificacionFinal = `CONCLUSIÓN: ${conclusion} - Puntaje: ${calificacion_final}/100\n---\nA) Requisitos Indispensables (${p_indispensables}/50 pts)\n${indispensales_html}\n\nB) Competencias Deseables (${p_deseables.toFixed(0)}/30 pts)\n${deseables_html}\n\nC) Alineamiento (${p_alineamiento}/20 pts)`;
    
    // 6. Actualizar la postulación en la base de datos
    const { error: updateError } = await supabaseAdmin
      .from("v2_postulaciones")
      .update({
        calificacion: calificacion_final,
        resumen: justificacionFinal,
        nombre_candidato_snapshot: toTitleCase(content.nombreCompleto),
        email_snapshot: content.email,
        telefono_snapshot: content.telefono,
      })
      .eq("id", postulacionId);

    if (updateError) throw new Error(`Error al actualizar la postulación: ${updateError.message}`);

    return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json", ...corsHeaders }});

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders }});
  }
});