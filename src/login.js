// src/login.js

import { supabase } from './supabaseClient.js';

// --- SELECTORES DEL DOM ---
const authForm = document.getElementById('auth-form');
const authBtn = document.getElementById('auth-btn');
const authBtnText = authBtn.querySelector('span');
const emailInput = document.getElementById('email-input');
const passwordInput = document.getElementById('password-input');
const errorMessage = document.getElementById('error-message');

const MENSAJE_SIN_ACCESO = 'Tu usuario no tiene acceso a SelectaCV. Pedí el alta al administrador.';

// 1. Verificar si el usuario ya tiene una sesión activa
document.addEventListener('DOMContentLoaded', async () => {
    if (new URLSearchParams(window.location.search).has('sinacceso')) {
        showError(MENSAJE_SIN_ACCESO);
        return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        window.location.href = 'lista-avisos.html';
    }
});

// 2. Manejar el envío del formulario
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
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const { data: esMiembro, error: errorMiembro } = await supabase.rpc('v2_es_miembro');
        if (errorMiembro) throw errorMiembro;
        if (!esMiembro) {
            await supabase.auth.signOut();
            throw new Error(MENSAJE_SIN_ACCESO);
        }
        window.location.href = 'lista-avisos.html';
    } catch (error) {
        console.error('Error de autenticación:', error.message);
        showError(getFriendlyErrorMessage(error));
        authBtn.disabled = false;
        authBtnText.textContent = 'Iniciar Sesión';
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
    if (error.message.includes('Email not confirmed')) {
        return 'Tu email todavía no fue confirmado.';
    }
    return error.message || 'Ocurrió un error. Por favor, inténtalo de nuevo.';
}
