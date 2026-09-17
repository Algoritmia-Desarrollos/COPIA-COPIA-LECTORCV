-- SelectaCV: miembros autorizados, CVs en Storage, control de análisis e índices.
-- Todo es aditivo: la app vieja sigue funcionando con este esquema.

-- 1) Miembros autorizados.
-- El proyecto de Supabase comparte los usuarios con otras apps, así que
-- "estar logueado" no alcanza: solo entran los usuarios de esta tabla.
create table if not exists public.v2_miembros (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);
alter table public.v2_miembros enable row level security;
revoke all on public.v2_miembros from anon, authenticated;

create or replace function public.v2_es_miembro()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.v2_miembros where user_id = auth.uid());
$$;
revoke execute on function public.v2_es_miembro() from public, anon;
grant execute on function public.v2_es_miembro() to authenticated;

insert into public.v2_miembros (user_id, email)
select id, email from auth.users
where email in ('admin@gmail.com', 'lucagazze1@gmail.com')
on conflict (user_id) do nothing;

-- 2) CVs en Storage (bucket privado) en lugar de base64 dentro de las tablas.
alter table public.v2_candidatos add column if not exists cv_path text;
alter table public.v2_postulaciones add column if not exists cv_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('selectacv-cvs', 'selectacv-cvs', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "selectacv: miembros leen CVs" on storage.objects;
create policy "selectacv: miembros leen CVs" on storage.objects
  for select to authenticated
  using (bucket_id = 'selectacv-cvs' and (select public.v2_es_miembro()));

-- 3) Análisis en el servidor: marca de "en curso" para que dos procesos
-- no califiquen la misma postulación a la vez.
alter table public.v2_postulaciones add column if not exists analisis_iniciado_at timestamptz;

create or replace function public.v2_reclamar_analisis(p_postulacion_id bigint)
returns table (id bigint, aviso_id bigint, texto_cv_especifico text)
language sql
security definer
set search_path = ''
as $$
  update public.v2_postulaciones p
     set analisis_iniciado_at = now()
   where p.id = p_postulacion_id
     and (p.calificacion is null or p.calificacion = -1)
     and (p.analisis_iniciado_at is null or p.analisis_iniciado_at < now() - interval '3 minutes')
  returning p.id, p.aviso_id, p.texto_cv_especifico;
$$;
revoke execute on function public.v2_reclamar_analisis(bigint) from public, anon, authenticated;

-- 4) Índices para las consultas de la app.
create extension if not exists pg_trgm with schema extensions;
create index if not exists v2_postulaciones_aviso_id_idx on public.v2_postulaciones (aviso_id);
create index if not exists v2_notas_historial_candidato_id_idx on public.v2_notas_historial (candidato_id);
create index if not exists v2_candidatos_carpeta_id_idx on public.v2_candidatos (carpeta_id);
create index if not exists v2_candidatos_created_at_idx on public.v2_candidatos (created_at desc);
create index if not exists v2_carpetas_parent_id_idx on public.v2_carpetas (parent_id);
create index if not exists v2_candidatos_nombre_trgm_idx on public.v2_candidatos using gin (nombre_candidato extensions.gin_trgm_ops);
create index if not exists v2_candidatos_email_trgm_idx on public.v2_candidatos using gin (email extensions.gin_trgm_ops);
create index if not exists v2_candidatos_telefono_trgm_idx on public.v2_candidatos using gin (telefono extensions.gin_trgm_ops);
