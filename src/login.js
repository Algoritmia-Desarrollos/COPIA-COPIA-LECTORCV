// src/login.js

import { supabase } from './supabaseClient.js';

// --- SELECTORES DEL DOM ---
const authForm = document.getElementById('auth-form');
const authBtn = document.getElementById('auth-btn');
const authBtnText = authBtn.querySelector('span');
const emailInput = document.getElementById('email-input');
const passwordInput = document.getElementById('password-input');
const errorMessage = document.getElementById('error-message');
const successView = document.getElementById('success-view');
const authView = document.getElementById('auth-view');
const formTitle = document.getElementById('form-title');

// --- LÓGICA DE AUTENTICACIÓN ---

// 1. Verificar si el usuario ya tiene una sesión activa
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        window.location.href = 'lista-avisos.html';
    }
});

// 2. Manejar el envío del formulario (para login o registro)
authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    if (!email || !password) {
        showError("Por favor, completa todos los campos.");
        return;
    }

    authBtn.disabled = true;
    authBtnText.textContent = 'Procesando...';
    hideError();

    try {
        // --- LÓGICA DE INICIO DE SESIÓN ---
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Si el inicio de sesión es exitoso, redirigir al panel
        window.location.href = 'lista-avisos.html';
    } catch (error) {
        console.error('Error de autenticación:', error.message);
        showError(getFriendlyErrorMessage(error));
        authBtn.disabled = false;
        authBtnText.textContent = 'Iniciar Sesión'; // Restaurar el texto del botón
    }
});

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
}

function hideError() {
    errorMessage.classList.add('hidden');
}

function getFriendlyErrorMessage(error) {
    if (error.message.includes('Invalid login credentials')) {
        return 'Email o contraseña incorrectos.';
    }
    return 'Ocurrió un error. Por favor, inténtalo de nuevo.';
}
