CREATE TABLE public.v2_carpetas (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  nombre text NOT NULL,
  parent_id bigint,
  CONSTRAINT v2_carpetas_pkey PRIMARY KEY (id),
  CONSTRAINT v2_carpetas_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.v2_carpetas(id)
);

CREATE TABLE public.v2_candidatos (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  email text NOT NULL,
  nombre_candidato text UNIQUE,
  telefono text,
  nombre_archivo_general text,
  base64_general text,
  texto_cv_general text,
  carpeta_id bigint,
  cv_url text,
  notas text,
  estado text,
  ubicacion text,
  CONSTRAINT v2_candidatos_pkey PRIMARY KEY (id),
  CONSTRAINT v2_candidatos_carpeta_id_fkey FOREIGN KEY (carpeta_id) REFERENCES public.v2_carpetas(id)
);

CREATE TABLE public.v2_avisos (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  titulo text NOT NULL,
  descripcion text,
  max_cv integer,
  valido_hasta date,
  condiciones_necesarias text[],
  condiciones_deseables text[],
  postulaciones_count integer NOT NULL DEFAULT 0,
  CONSTRAINT v2_avisos_pkey PRIMARY KEY (id)
);

CREATE TABLE public.v2_postulaciones (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  candidato_id bigint,
  aviso_id bigint NOT NULL,
  calificacion integer,
  resumen text,
  notas text,
  base64_cv_especifico text,
  texto_cv_especifico text,
  nombre_candidato_snapshot text,
  email_snapshot text,
  telefono_snapshot text,
  nombre_archivo_especifico text,
  CONSTRAINT v2_postulaciones_pkey PRIMARY KEY (id),
  CONSTRAINT v2_postulaciones_candidato_id_fkey_setnull FOREIGN KEY (candidato_id) REFERENCES public.v2_candidatos(id),
  CONSTRAINT v2_postulaciones_aviso_id_fkey FOREIGN KEY (aviso_id) REFERENCES public.v2_avisos(id)
);
