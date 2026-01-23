import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./env.js";

// AGREGA ESTA LÍNEA PARA VER LA CLAVE EN LA CONSOLA:
console.log("🔑 CLAVE USADA:", SUPABASE_ANON_KEY);

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);