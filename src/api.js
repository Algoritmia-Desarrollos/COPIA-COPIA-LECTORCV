// src/api.js

import { supabase } from './supabaseClient.js';

const BUCKET_CVS = 'selectacv-cvs';

/**
 * Llama a una acción de la función `selectacv` (backend de la app).
 * Devuelve la respuesta o lanza un Error con el mensaje que mandó el servidor.
 */
export async function llamarFuncion(accion, datos = {}) {
    const { data, error } = await supabase.functions.invoke('selectacv', { body: { accion, ...datos } });
    if (error) {
        let mensaje = error.message;
        try {
            const cuerpo = await error.context?.json();
            if (cuerpo?.error) mensaje = cuerpo.error;
        } catch (_) { /* la respuesta no era JSON */ }
        throw new Error(mensaje);
    }
    return data;
}

/**
 * Trae todas las filas de una consulta. La API devuelve como máximo 1000 filas
 * por pedido, así que se pagina. `construirConsulta` debe ordenar por una columna única.
 */
export async function traerTodas(construirConsulta, tamanio = 1000) {
    // El primer pedido trae además el total, así el resto de las páginas se piden en paralelo.
    const { data, error, count } = await construirConsulta({ count: 'exact' }).range(0, tamanio - 1);
    if (error) throw error;
    if (count === null || count <= data.length) return data;

    const paginas = [];
    for (let desde = tamanio; desde < count; desde += tamanio) {
        paginas.push(construirConsulta().range(desde, desde + tamanio - 1));
    }
    const resultados = await Promise.all(paginas);
    const filas = [...data];
    for (const r of resultados) {
        if (r.error) throw r.error;
        filas.push(...r.data);
    }
    return filas;
}

/** Divide una lista en lotes (para no armar URLs gigantes con filtros `in`). */
export function enLotes(lista, tamanio = 300) {
    const lotes = [];
    for (let i = 0; i < lista.length; i += tamanio) lotes.push(lista.slice(i, i + tamanio));
    return lotes;
}

/**
 * Descarga el CV original de un candidato.
 * Los CVs están en Storage; los que todavía no se migraron siguen en base64.
 */
export async function descargarCvCandidato(candidatoId) {
    const { data, error } = await supabase
        .from('v2_candidatos')
        .select('cv_path, nombre_archivo_general')
        .eq('id', candidatoId)
        .single();
    if (error || !data) throw new Error('No se encontró el candidato.');

    const nombre = data.nombre_archivo_general || 'cv.pdf';
    if (data.cv_path) {
        const { data: firmada, error: errUrl } = await supabase.storage
            .from(BUCKET_CVS)
            .createSignedUrl(data.cv_path, 120, { download: nombre });
        if (errUrl) throw new Error('No se pudo generar el link de descarga.');
        dispararDescarga(firmada.signedUrl, nombre);
        return;
    }

    const { data: viejo, error: errViejo } = await supabase
        .from('v2_candidatos')
        .select('base64_general')
        .eq('id', candidatoId)
        .single();
    if (errViejo || !viejo?.base64_general) throw new Error('Este candidato no tiene CV guardado.');
    dispararDescarga(viejo.base64_general, nombre);
}

function dispararDescarga(href, nombre) {
    const link = document.createElement('a');
    link.href = href;
    link.download = nombre;
    document.body.appendChild(link);
    link.click();
    link.remove();
}
