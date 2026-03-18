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

// Si el script llega hasta aquí, significa que hay una sesión activa.

// Manejar el botón de logout en todas las páginas protegidas
document.addEventListener('DOMContentLoaded', () => {
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

    // Badge de no leídos en "Base de datos"
    try {
        const { count: unreadCount } = await supabase
            .from('v2_candidatos')
            .select('id', { count: 'exact', head: true })
            .eq('read', false);
        if (unreadCount > 0) {
            const dbLink = document.querySelector('.nav-menu a[href="base-talentos.html"]');
            if (dbLink) {
                const badge = document.createElement('span');
                badge.className = 'nav-badge';
                badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                dbLink.appendChild(badge);
            }
        }
    } catch (e) { /* silencioso */ }
});