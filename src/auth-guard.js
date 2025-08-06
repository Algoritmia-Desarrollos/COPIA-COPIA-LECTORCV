// src/auth-guard.js

import { supabase } from './supabaseClient.js';

// Verificamos la sesión del usuario inmediatamente.
const { data: { session } } = await supabase.auth.getSession();

if (!session) {
    // Si NO hay sesión, no permitimos que se cargue la página
    // y redirigimos al usuario a la página de login.
    alert("Acceso denegado. Por favor, inicia sesión para continuar.");
    window.location.href = '/login.html';
}

// Si el script llega hasta aquí, significa que hay una sesión activa
// y no hacemos nada, permitiendo que el resto de los scripts de la página se ejecuten.