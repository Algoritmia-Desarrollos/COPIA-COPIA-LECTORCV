-- v2_es_miembro ya no necesita permisos elevados: cada usuario puede leer su
-- propia fila de v2_miembros (política "cada usuario ve su membresia").
grant select on public.v2_miembros to authenticated;

create or replace function public.v2_es_miembro()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from public.v2_miembros where user_id = (select auth.uid()));
$$;
