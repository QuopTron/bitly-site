-- supabase-migrations-opiniones.sql
--
-- Contador de vistas + opiniones con estrellas (nombre libre + 1 a 5 estrellas).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar todo → Run. Es idempotente: se
-- puede correr dos veces sin romper nada.
--
-- Sobre QUIÉN puede escribir: no hay política de INSERT a propósito. El público
-- puede LEER las opiniones aprobadas, pero no puede insertar contra la API ni
-- con la clave publicable. El único camino de escritura es la función de
-- servidor del sitio (`src/server/opiniones.ts`), que usa la clave secreta y
-- además limita los envíos por IP. Sin eso, cualquiera con la clave pública
-- (que es pública por diseño) podría llenar la tabla de basura.

-- ─────────────────────────────────────────────────────────────────────────────
-- Contador de vistas
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists vistas (
  id integer primary key default 1 check (id = 1),
  visitas bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into vistas (id, visitas) values (1, 0)
on conflict (id) do nothing;

alter table vistas enable row level security;

drop policy if exists "Public read vistas" on vistas;
create policy "Public read vistas" on vistas for select using (true);

-- Suma una visita y devuelve el total. Va con `security definer` para que el
-- visitante no necesite permiso de UPDATE (no lo tiene).
create or replace function increment_vista()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare total bigint;
begin
  update vistas set visitas = visitas + 1, updated_at = now() where id = 1
  returning visitas into total;
  return coalesce(total, 0);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Opiniones
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists comentarios (
  id bigserial primary key,
  nombre text not null check (char_length(btrim(nombre)) between 2 and 24),
  estrellas smallint not null check (estrellas between 1 and 5),
  texto text not null check (char_length(btrim(texto)) between 2 and 400),
  -- Publicación inmediata. Si algún día querés moderar antes de publicar:
  --   alter table comentarios alter column aprobado set default false;
  -- y aprobá desde el dashboard (Table editor → comentarios → aprobado).
  aprobado boolean not null default true,
  creado timestamptz not null default now()
);

create index if not exists comentarios_creado_idx on comentarios (creado desc);

alter table comentarios enable row level security;

drop policy if exists "Public read comentarios aprobados" on comentarios;
create policy "Public read comentarios aprobados" on comentarios for select using (aprobado);

-- ─────────────────────────────────────────────────────────────────────────────
-- Resumen para el encabezado: cuántas opiniones, el promedio, las visitas y el
-- reparto de notas. Es un solo viaje a la base en vez de cuatro.
--
-- `reparto` es un arreglo de cinco casillas: cuántas opiniones tienen 1, 2, 3, 4
-- y 5 estrellas (en ese orden). Con eso el sitio dibuja las barras de "cómo se
-- reparten las notas" sin traerse todas las filas.
--
-- Se borra antes de crear porque Postgres no deja cambiar el tipo de retorno de
-- una función existente; sin el `drop`, volver a correr el archivo fallaría si
-- ya se había aplicado una versión anterior.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists resumen_sitio();

create or replace function resumen_sitio()
returns table (opiniones bigint, promedio numeric, vistas bigint, reparto integer[])
language sql
stable
as $$
  select
    (select count(*)::bigint from comentarios where aprobado),
    (select coalesce(round(avg(estrellas)::numeric, 1), 0) from comentarios where aprobado),
    (select v.visitas from vistas v where v.id = 1),
    (select array[
       (count(*) filter (where estrellas = 1))::integer,
       (count(*) filter (where estrellas = 2))::integer,
       (count(*) filter (where estrellas = 3))::integer,
       (count(*) filter (where estrellas = 4))::integer,
       (count(*) filter (where estrellas = 5))::integer
     ] from comentarios where aprobado);
$$;
