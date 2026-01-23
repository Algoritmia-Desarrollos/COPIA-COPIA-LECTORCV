import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import OpenAI from 'npm:openai'

Deno.serve(async (req) => {
  // Configuración de CORS (Permisos de acceso)
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    const { query } = await req.json()

    // Inicializamos la IA
    const openai = new OpenAI({
      apiKey: Deno.env.get("OPENAI_API_KEY"),
    })

    // Solicitamos respuesta a OpenAI
    const chatCompletion = await openai.chat.completions.create({
      messages: [
        // ESTA LINEA EVITA EL ERROR 400: Le decimos explícitamente que use JSON
        { role: "system", content: "You are a helpful assistant. You must always respond in valid JSON format." },
        { role: "user", content: query || "Hola" }
      ],
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
    })

    const data = {
      message: chatCompletion.choices[0].message.content,
    }

    return new Response(
      JSON.stringify(data),
      { 
        headers: { 
          "Content-Type": "application/json",
          'Access-Control-Allow-Origin': '*',
        } 
      },
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json", 'Access-Control-Allow-Origin': '*' },
      status: 500,
    })
  }
})