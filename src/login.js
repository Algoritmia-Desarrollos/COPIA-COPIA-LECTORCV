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
const toggleModeBtn = document.getElementById('toggle-auth-mode');
const formTitle = document.getElementById('form-title');

// --- LÓGICA DE AUTENTICACIÓN ---

let isLoginMode = true;

// 1. Verificar si el usuario ya tiene una sesión activa
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        window.location.href = 'lista-avisos.html';
    }
});

// 1.5. Manejar el modo de autenticación
if (toggleModeBtn) {
    toggleModeBtn.addEventListener('click', () => {
        isLoginMode = !isLoginMode;
        if (isLoginMode) {
            formTitle.textContent = 'Acceso al Panel';
            authBtnText.textContent = 'Iniciar Sesión';
            authBtn.querySelector('i').className = 'fa-solid fa-right-to-bracket';
            toggleModeBtn.textContent = '¿No tienes cuenta? Regístrate aquí';
        } else {
            formTitle.textContent = 'Crear Nueva Cuenta';
            authBtnText.textContent = 'Registrarse';
            authBtn.querySelector('i').className = 'fa-solid fa-user-plus';
            toggleModeBtn.textContent = '¿Ya tienes cuenta? Inicia sesión aquí';
        }
        hideError();
    });
}

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
        if (isLoginMode) {
            // --- LÓGICA DE INICIO DE SESIÓN ---
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            // Si el inicio de sesión es exitoso, redirigir al panel
            window.location.href = 'lista-avisos.html';
        } else {
            // --- LÓGICA DE REGISTRO ---
            const { error } = await supabase.auth.signUp({ email, password });
            if (error) throw error;
            // Si el registro requiere confirmación (por defecto en supabase)
            authView.classList.add('hidden');
            successView.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Error de autenticación:', error.message);
        showError(getFriendlyErrorMessage(error));
        authBtn.disabled = false;
        authBtnText.textContent = isLoginMode ? 'Iniciar Sesión' : 'Registrarse'; // Restaurar el texto del botón
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
    if (error.message.includes('User already registered')) {
        return 'El usuario ya está registrado, por favor inicia sesión.';
    }
    if (error.message.includes('Password should be at least')) {
        return 'La contraseña debe tener al menos 6 caracteres.';
    }
    return error.message || 'Ocurrió un error. Por favor, inténtalo de nuevo.';
}
