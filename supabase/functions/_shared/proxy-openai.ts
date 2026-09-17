// Proxy de OpenAI de la versión anterior de SelectaCV ({ query } -> { message }).
// La app nueva usa la función selectacv; esto queda solo para miembros logueados,
// así nadie puede gastar el saldo de OpenAI con la clave pública.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getSecretKey(): string {
  const nuevas = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (nuevas) {
    try {
      const parsed = JSON.parse(nuevas);
      if (parsed?.default) return parsed.default;
    } catch (_) { /* formato inesperado, seguimos con los fallbacks */ }
  }
  return Deno.env.get("APP_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

const admin = createClient(Deno.env.get("SUPABASE_URL")!, getSecretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

function respuesta(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function esMiembro(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token.startsWith("eyJ")) return false;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return false;
  const { data: miembro } = await admin.from("v2_miembros").select("user_id").eq("user_id", data.user.id).maybeSingle();
  return Boolean(miembro);
}

export async function proxyOpenAI(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!(await esMiembro(req))) return respuesta({ error: "No autorizado." }, 401);

    const body = await req.json();
    const query = String(body.query || "Analiza este CV y responde en JSON").slice(0, 60_000);

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Eres un asistente útil. IMPORTANTE: Debes responder siempre en formato JSON válido." },
          { role: "user", content: query + " (Responde en formato JSON)" },
        ],
        response_format: { type: "json_object" },
      }),
    });
    const json = await r.json();
    if (!r.ok) return respuesta({ error: json?.error?.message ?? `OpenAI respondió ${r.status}` }, 500);
    return respuesta({ message: json.choices[0].message.content });
  } catch (error) {
    return respuesta({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
