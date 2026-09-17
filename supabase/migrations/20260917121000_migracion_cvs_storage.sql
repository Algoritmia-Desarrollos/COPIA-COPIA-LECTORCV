-- Apoyo temporal para mover los CVs guardados en base64 a Storage por lotes.
-- La función selectacv (acción migrar-cvs) la usa con la clave secreta.
create or replace function public.v2_ids_sin_migrar(p_tabla text, p_limite int, p_modulo int, p_resto int)
returns table (id bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tabla = 'v2_candidatos' then
    return query
      select c.id from public.v2_candidatos c
      where c.cv_path is null and c.base64_general is not null and c.id % p_modulo = p_resto
      order by c.id limit p_limite;
  elsif p_tabla = 'v2_postulaciones' then
    return query
      select p.id from public.v2_postulaciones p
      where p.cv_path is null and p.base64_cv_especifico is not null and p.id % p_modulo = p_resto
      order by p.id limit p_limite;
  end if;
end;
$$;
revoke execute on function public.v2_ids_sin_migrar(text, int, int, int) from public, anon, authenticated;
