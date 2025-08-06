// src/login.js

import { supabase } from './supabaseClient.js';

// --- SELECTORES DEL DOM ---
const loginForm = document.getElementById('login-form');
const loginBtn = document.getElementById('login-btn');
const loginBtnText = loginBtn.querySelector('span');
const emailInput = document.getElementById('email-input');
const loginView = document.getElementById('login-view');
const successView = document.getElementById('success-view');

// --- LÓGICA DE AUTENTICACIÓN ---

// 1. Verificar si el usuario ya tiene una sesión activa al cargar la página
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        // Si hay una sesión, redirigir al panel principal
        window.location.href = 'lista-avisos.html';
    }
});

// 2. Manejar el envío del formulario de login
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) return;

    // Deshabilitar el botón y mostrar estado de carga
    loginBtn.disabled = true;
    loginBtnText.textContent = 'Enviando...';

    try {
        // Usamos el método de "Magic Link" (One-Time Password) de Supabase
        const { error } = await supabase.auth.signInWithOtp({
            email: email,
            options: {
                // Opcional: A dónde redirigir al usuario después de hacer clic en el link del email.
                // Si no se especifica, Supabase usará la URL del sitio configurada en tu proyecto.
                emailRedirectTo: `${window.location.origin}/lista-avisos.html`,
            },
        });

        if (error) {
            throw error; // Lanzar el error para que sea capturado por el bloque catch
        }

        // Si el envío fue exitoso, mostrar la vista de éxito
        loginView.classList.add('hidden');
        successView.classList.remove('hidden');

    } catch (error) {
        console.error('Error al iniciar sesión:', error);
        alert(`No se pudo enviar el link de acceso: ${error.message}`);
        // Reactivar el botón en caso de error
        loginBtn.disabled = false;
        loginBtnText.textContent = 'Enviar Link Mágico';
    }
});