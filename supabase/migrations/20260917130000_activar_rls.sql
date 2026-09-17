-- SelectaCV: activa la seguridad por filas en todas las tablas de la app.
-- Solo los miembros (v2_miembros) leen y escriben. Los links públicos pasan por
-- la función selectacv, que usa la clave secreta, así que anon no necesita nada.

-- Políticas viejas: estaban escritas pero la RLS estaba apagada, y algunas
-- dejaban insertar a cualquiera.
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('v2_avisos', 'v2_candidatos', 'v2_carpetas', 'v2_notas_historial', 'v2_postulaciones')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.v2_avisos enable row level security;
alter table public.v2_candidatos enable row level security;
alter table public.v2_carpetas enable row level security;
alter table public.v2_notas_historial enable row level security;
alter table public.v2_postulaciones enable row level security;

create policy "miembros gestionan avisos" on public.v2_avisos
  for all to authenticated
  using ((select public.v2_es_miembro())) with check ((select public.v2_es_miembro()));
create policy "miembros gestionan candidatos" on public.v2_candidatos
  for all to authenticated
  using ((select public.v2_es_miembro())) with check ((select public.v2_es_miembro()));
create policy "miembros gestionan carpetas" on public.v2_carpetas
  for all to authenticated
  using ((select public.v2_es_miembro())) with check ((select public.v2_es_miembro()));
create policy "miembros gestionan notas" on public.v2_notas_historial
  for all to authenticated
  using ((select public.v2_es_miembro())) with check ((select public.v2_es_miembro()));
create policy "miembros gestionan postulaciones" on public.v2_postulaciones
  for all to authenticated
  using ((select public.v2_es_miembro())) with check ((select public.v2_es_miembro()));

-- Sin permisos para visitantes anónimos, y sin TRUNCATE para nadie desde la API.
revoke all on public.v2_avisos, public.v2_candidatos, public.v2_carpetas,
              public.v2_notas_historial, public.v2_postulaciones from anon;
revoke truncate, references, trigger on public.v2_avisos, public.v2_candidatos, public.v2_carpetas,
              public.v2_notas_historial, public.v2_postulaciones from authenticated;

-- Funciones que leen candidatos: solo usuarios logueados (y la RLS filtra igual).
revoke execute on function public.get_folder_counts() from public, anon;
grant execute on function public.get_folder_counts() to authenticated;
revoke execute on function public.get_candidate_counts_by_folder() from public, anon;
grant execute on function public.get_candidate_counts_by_folder() to authenticated;
revoke execute on function public.get_candidatos_with_folder_path() from public, anon;
grant execute on function public.get_candidatos_with_folder_path() to authenticated;
