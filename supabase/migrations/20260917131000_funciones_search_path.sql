-- Alertas del asesor de seguridad de Supabase sobre funciones de SelectaCV.

-- search_path fijo: evita que un objeto con el mismo nombre en otro esquema
-- cambie lo que hace la función.
alter function public.get_folder_counts() set search_path = public;
alter function public.get_candidate_counts_by_folder() set search_path = public;
alter function public.get_candidatos_with_folder_path() set search_path = public;
alter function public.update_postulaciones_count() set search_path = public;
alter function public.increment_postulaciones_count() set search_path = public;

-- Función de trigger que no está enganchada a ninguna tabla: nadie la llama por la API.
revoke execute on function public.increment_postulaciones_count() from public, anon, authenticated;

-- Cada usuario puede ver únicamente su propia fila de miembro.
drop policy if exists "cada usuario ve su membresia" on public.v2_miembros;
create policy "cada usuario ve su membresia" on public.v2_miembros
  for select to authenticated
  using (user_id = (select auth.uid()));
