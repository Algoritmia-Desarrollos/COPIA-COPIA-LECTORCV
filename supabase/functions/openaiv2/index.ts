import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import OpenAI from 'npm:openai'

Deno.serve(async (req) => {
  // CONFIGURACIÓN DE CORS (Para que el navegador no bloquee)
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }

  // Si el navegador pregunta "¿puedo pasar?", le decimos que SÍ.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const query = body.query || "Analiza este CV y responde en JSON"

    // INICIALIZAMOS OPENAI
    const openai = new OpenAI({
      apiKey: Deno.env.get("OPENAI_API_KEY"),
    })

    // LA LLAMADA BLINDADA
    const chatCompletion = await openai.chat.completions.create({
      messages: [
        { 
          role: "system", 
          content: "Eres un asistente útil. IMPORTANTE: Debes responder siempre en formato JSON válido." 
        },
        { 
          role: "user", 
          // Aquí concatenamos la instrucción JSON por si acaso el usuario se olvidó
          content: query + " (Responde en formato JSON)" 
        }
      ],
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
    })

    const result = {
      message: chatCompletion.choices[0].message.content,
    }

    // RESPUESTA EXITOSA
    return new Response(JSON.stringify(result), { 
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  } catch (error) {
    // CAPTURA DE ERROR PARA QUE NO SALGA "FunctionsFetchError"
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500, // Devolvemos 500 pero con CORS, para ver el mensaje real
    })
  }
})