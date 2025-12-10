// src/supabaseClient.js

// CAMBIA ESTA LÍNEA (la de jsDelivr está rota actualmente):
// import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// POR ESTA (esm.sh funciona correctamente):
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env.js';

// Creamos y exportamos el cliente de Supabase para usarlo en otros archivos del proyecto.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);