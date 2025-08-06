// supabase/functions/v2-process-cv/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from "https://esm.sh/@google/generative-ai";

// Cliente de Supabase con permisos de administrador para poder escribir en la base de datos.
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
const genAI = new GoogleGenerativeAI(geminiApiKey!);

// Función para estandarizar nombres a formato "Nombre Apellido".
function toTitleCase(str: string | null): string | null {
  if (!str || typeof str !== 'string') return null;
  // Limpia espacios extra, convierte a minúsculas y luego capitaliza cada palabra.
  return str.toLowerCase().trim().replace(/\s+/g, ' ').split(' ').map(word => {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

// El prompt de IA no necesita cambios, ya que su única función es extraer los datos crudos.
const HEADHUNTER_PROMPT_V2 = `
    Actúa como un experto en RRHH y reclutamiento. Analiza el siguiente CV y califícalo de 1 a 100 según la calidad general, experiencia y adecuación para un rol profesional.
    Además, extrae el nombre completo, email y teléfono. Finalmente, escribe una justificación de 3 o 4 líneas explicando la calificación y resumiendo el perfil.
    CV: """{CONTEXTO}"""
    Responde únicamente con un objeto JSON con las claves "calificacion" (number), "justificacion" (string), "nombreCompleto" (string), "email" (string) y "telefono" (string).
    Si un dato no se encuentra, usa null. La justificación debe ser concisa y profesional.
`;

async function processCV(cvText: string, jobRequirements: string) {
  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY no está configurada en las variables de entorno.");
  }

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const generationConfig = {
    temperature: 0.2,
    topP: 1,
    topK: 1,
    maxOutputTokens: 8192,
    responseMimeType: "application/json",
  };

  const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  ];

  const prompt = `
    Analiza el siguiente CV en texto plano y compáralo con los requisitos del puesto.
    Extrae la información solicitada y devuelve el resultado únicamente en formato JSON.

    CV del candidato:
    ---
    ${cvText}
    ---

    Requisitos del puesto:
    ---
    ${jobRequirements}
    ---

    Basado en el CV y los requisitos, proporciona la siguiente información en un objeto JSON con las siguientes claves:
    - "nombre": El nombre completo del candidato.
    - "email": El correo electrónico del candidato.
    - "telefono": El número de teléfono del candidato.
    - "resumen": Un resumen conciso (máximo 200 palabras) de la experiencia y habilidades del candidato, destacando la relevancia para el puesto.
    - "calificacion": Una calificación numérica del 1 al 100 sobre qué tan bien el perfil del candidato se ajusta a los requisitos del puesto. Considera la experiencia, habilidades y educación. Una calificación más alta significa un mejor ajuste.

    Asegúrate de que la salida sea solo un objeto JSON válido, sin texto adicional antes o después.
    Ejemplo de formato de salida:
    {
      "nombre": "Juan Pérez",
      "email": "juan.perez@example.com",
      "telefono": "+123456789",
      "resumen": "Juan es un desarrollador de software con 5 años de experiencia en...",
      "calificacion": 85
    }
  `;

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig,
    safetySettings,
  });

  try {
    const responseText = result.response.text();
    const parsedResult = JSON.parse(responseText);
    return {
      nombre: parsedResult.nombre || null,
      email: parsedResult.email || null,
      telefono: parsedResult.telefono || null,
      resumen: parsedResult.resumen || "No se pudo generar un resumen.",
      calificacion: parsedResult.calificacion || 0,
    };
  } catch (error) {
    console.error("Error al analizar la respuesta de la IA:", error);
    console.error("Respuesta recibida de la IA:", result.response.text());
    throw new Error("No se pudo analizar la respuesta de la IA. La respuesta no es un JSON válido.");
  }
}

serve(async (req) => {
  try {
    const { record } = await req.json();
    const {
      id: postulacionId,
      aviso_id,
      base64_cv_especifico,
      texto_cv_especifico,
    } = record;

    if (!postulacionId || !aviso_id) {
      return new Response("Faltan postulacionId o aviso_id", { status: 400 });
    }

    // 1. Obtener los detalles del aviso
    const { data: aviso, error: avisoError } = await supabase
      .from("v2_avisos")
      .select("titulo, descripcion, condiciones_necesarias, condiciones_deseables")
      .eq("id", aviso_id)
      .single();

    if (avisoError) {
      console.error("Error al obtener el aviso:", avisoError);
      throw new Error(`Error al obtener el aviso: ${avisoError.message}`);
    }

    const jobRequirements = `
      Título: ${aviso.titulo}
      Descripción: ${aviso.descripcion}
      Condiciones Necesarias: ${aviso.condiciones_necesarias?.join(", ")}
      Condiciones Deseables: ${aviso.condiciones_deseables?.join(", ")}
    `;

    let cvText = texto_cv_especifico;

    // 2. Si no hay texto de CV, decodificar de base64
    if (!cvText && base64_cv_especifico) {
      // Esta es una simulación. Deberías tener una función 'extract-text' que funcione.
      // Por ahora, asumimos que el base64 es texto plano para fines de prueba.
      try {
        cvText = atob(base64_cv_especifico);
      } catch (e) {
         console.error("Error decodificando base64, puede que no sea texto plano:", e)
         // En un caso real, aquí invocarías la función que extrae texto de PDF/DOCX
         // const { data: textData, error: textError } = await supabase.functions.invoke(
         //   "extract-text",
         //   { body: { base64: base64_cv_especifico } },
         // );
         // if (textError) throw textError;
         cvText = "Error: No se pudo decodificar el CV desde base64. La función 'extract-text' debe ser implementada.";
      }
    }

    if (!cvText) {
      return new Response("No se pudo obtener el texto del CV", { status: 400 });
    }

    // 3. Procesar el CV con Gemini AI
    const analysisResult = await processCV(cvText, jobRequirements);

    // 4. Actualizar la tabla de postulaciones con el resultado
    const { data: updateData, error: updateError } = await supabase
      .from("v2_postulaciones")
      .update({
        calificacion: analysisResult.calificacion,
        resumen: analysisResult.resumen,
        nombre_candidato_snapshot: analysisResult.nombre,
        email_snapshot: analysisResult.email,
        telefono_snapshot: analysisResult.telefono,
        texto_cv_especifico: cvText, // Guardar el texto extraído
      })
      .eq("id", postulacionId);

    if (updateError) {
      console.error("Error al actualizar la postulación:", updateError);
      throw new Error(
        `Error al actualizar la postulación: ${updateError.message}`,
      );
    }

    return new Response(JSON.stringify({ success: true, data: updateData }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error en el servidor:", error);
    return new Response(error.message, { status: 500 });
  }
});
