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
const toggleAuthModeBtn = document.getElementById('toggle-auth-mode-btn');
const toggleText = document.getElementById('toggle-text');

// --- ESTADO DE LA APLICACIÓN ---
let isLoginMode = true; // Empezamos en modo "Iniciar Sesión"

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
            // Mostrar mensaje para que el usuario confirme su email
            authView.classList.add('hidden');
            successView.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Error de autenticación:', error.message);
        showError(getFriendlyErrorMessage(error));
        authBtn.disabled = false;
        updateAuthFormUI(); // Restaurar el texto del botón
    }
});

// 3. Manejar el cambio entre "Iniciar Sesión" y "Registrarse"
toggleAuthModeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    isLoginMode = !isLoginMode;
    hideError();
    updateAuthFormUI();
});

// --- FUNCIONES AUXILIARES DE UI ---

function updateAuthFormUI() {
    if (isLoginMode) {
        formTitle.textContent = 'Acceso al Panel';
        authBtnText.textContent = 'Iniciar Sesión';
        toggleText.textContent = '¿No tienes una cuenta?';
        toggleAuthModeBtn.textContent = 'Regístrate';
    } else {
        formTitle.textContent = 'Crear Nueva Cuenta';
        authBtnText.textContent = 'Registrarse';
        toggleText.textContent = '¿Ya tienes una cuenta?';
        toggleAuthModeBtn.textContent = 'Inicia Sesión';
    }
}

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
        return 'Ya existe un usuario con este correo electrónico.';
    }
    if (error.message.includes('Password should be at least 6 characters')) {
        return 'La contraseña debe tener al menos 6 caracteres.';
    }
    return 'Ocurrió un error. Por favor, inténtalo de nuevo.';
}