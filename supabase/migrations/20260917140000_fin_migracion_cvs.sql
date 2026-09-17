-- Los CVs ya están todos en Storage (verificados por MD5) y el base64 de las
-- tablas se vació. Se borra el apoyo temporal de la migración.
drop function if exists public.v2_ids_sin_migrar(text, int, int, int);

-- Para liberar el disco se compactaron las tablas (fuera de una transacción):
--   vacuum full public.v2_candidatos;
--   vacuum full public.v2_postulaciones;
