// src/auth-guard.js

import { supabase } from './supabaseClient.js';

// Verificamos la sesión del usuario inmediatamente.
const { data: { session } } = await supabase.auth.getSession();

if (!session) {
    window.location.replace('login.html');
} else {
    await verificarMiembro(session.user.id);
}

// Los usuarios del proyecto son compartidos con otras apps: además de tener
// sesión, el usuario tiene que estar habilitado para SelectaCV.
async function verificarMiembro(userId) {
    const clave = `selectacv-miembro-${userId}`;
    try {
        if (sessionStorage.getItem(clave) === '1') return;
    } catch (_) { /* almacenamiento no disponible */ }

    const { data: esMiembro, error } = await supabase.rpc('v2_es_miembro');
    if (error) return; // sin conexión: las consultas igual quedan protegidas por la base
    if (!esMiembro) {
        await supabase.auth.signOut();
        window.location.replace('login.html?sinacceso=1');
        return;
    }
    try {
        sessionStorage.setItem(clave, '1');
    } catch (_) { /* almacenamiento no disponible */ }
}

const initUI = async () => {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await supabase.auth.signOut();
            window.location.href = 'login.html';
        });
    }

    // Setear el item activo del navbar según la página actual
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-menu a').forEach(link => {
        link.classList.remove('active');
        const linkPage = link.getAttribute('href').split('/').pop();
        // resumenes.html, crear-aviso.html y detalles-aviso.html pertenecen a "Mis Búsquedas"
        const isMisBusquedas = ['lista-avisos.html','resumenes.html','crear-aviso.html','detalles-aviso.html'].includes(currentPage);
        if (linkPage === currentPage || (isMisBusquedas && linkPage === 'lista-avisos.html')) {
            link.classList.add('active');
        }
    });
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
} else {
    initUI();
}
