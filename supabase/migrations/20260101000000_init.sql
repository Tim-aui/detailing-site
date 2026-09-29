-- Схема данных студии записи.
--
-- Разделение намеренное:
--   * tenants.config      — полные настройки студии одним JSON. Ровно то,
--                           что лежит в tenants/<slug>/studio.json. Файл в
--                           git остаётся источником правды, скрипт
--                           `tenant:push` кладёт сюда копию, чтобы сервер
--                           мог считать занятость и цены.
--   * tenant_settings    — правки владельца, которые он делает из кабинета.
--                           Они накладываются поверх config при чтении.
--   * bookings           — нормализованные записи: их нельзя держать в
--                           JSON, потому что на них действуют ограничения
--                           базы, запрещающие пересечения.
--
-- Записи клиента не читаются напрямую: RLS запрещает SELECT для всех,
-- работают только функции create_booking / my_bookings / cancel_booking.

create extension if not exists pgcrypto;
-- btree_gist нужен для EXCLUDE: сравнение box_id как равенство в GiST-индексе.
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Студии
-- ---------------------------------------------------------------------------

create table if not exists public.tenants (
  slug         text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name         text        not null,
  timezone     text        not null default 'Europe/Moscow',
  -- Полный конфиг студии: услуги, боксы, часы, фото, отмена.
  config       jsonb       not null default '{}'::jsonb,
  is_published boolean     not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on column public.tenants.config is
  'Копия tenants/<slug>/studio.json. Меняется только скриптом tenant:push, вручную не править.';

-- Правки владельца поверх файла. Ключи ограничены приложением
-- (OWNER_EDITABLE_KEYS в src/tenants/schema.ts), здесь — только формат.
create table if not exists public.tenant_settings (
  tenant_slug text        primary key references public.tenants(slug) on delete cascade,
  patch       jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid        references auth.users(id) on delete set null
);

-- ---------------------------------------------------------------------------
-- Записи
-- ---------------------------------------------------------------------------

-- Тип создаём через DO-блок: у CREATE TYPE нет IF NOT EXISTS.
do $$
begin
  create type public.booking_status
    as enum ('pending', 'confirmed', 'in_progress', 'done', 'cancelled');
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.bookings (
  id             uuid primary key default gen_random_uuid(),
  tenant_slug    text        not null references public.tenants(slug) on delete cascade,
  -- Короткий код для телефона: «назовите код оператору».
  code           text        not null,
  service_id     text        not null,
  service_name   text        not null,
  box_id         text        not null,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  -- Границы с учётом буфера между машинами. Именно по ним запрещены
  -- пересечения: без буфера две соседние записи «склеились» бы впритык.
  busy_from      timestamptz not null,
  busy_to        timestamptz not null,
  status         public.booking_status not null default 'pending',
  -- Цена фиксируется на момент записи: услуга может подорожать позже.
  price          integer     not null check (price >= 0),
  contact_name   text        not null,
  contact_phone  text        not null,
  -- Нормализованный номер для поиска «мои записи»: +7 (916) 123-45-67
  -- и 79161234567 должны находить одну и ту же запись.
  phone_key      text        generated always as (regexp_replace(contact_phone, '[^0-9]', '', 'g')) stored,
  car            text        not null default '',
  comment        text        not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint bookings_code_unique unique (tenant_slug, code),
  constraint bookings_time_order check (starts_at < ends_at),
  -- Главная защита от двойной записи. Ограничение на уровне базы: два
  -- параллельных запроса не смогут занять один бокс, даже если оба прошли
  -- проверку занятости в приложении.
  constraint bookings_no_overlap exclude using gist (
    box_id    with =,
    tstzrange(busy_from, busy_to) with &&
  ) where (status in ('pending', 'confirmed', 'in_progress'))
);

comment on constraint bookings_no_overlap on public.bookings is
  'Один бокс не может быть занят двумя активными записями одновременно.';

create index if not exists bookings_tenant_starts_idx
  on public.bookings (tenant_slug, starts_at);

create index if not exists bookings_phone_idx
  on public.bookings (tenant_slug, phone_key);

create index if not exists bookings_open_idx
  on public.bookings (tenant_slug, status)
  where status in ('pending', 'confirmed', 'in_progress');

-- ---------------------------------------------------------------------------
-- Люди
-- ---------------------------------------------------------------------------

-- Владелец студии. Роль одна, но таблица оставляет место мастерам
-- (см. staff_members) и не даёт «зашить» права в код.
create table if not exists public.tenant_members (
  tenant_slug text        not null references public.tenants(slug) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  role        text        not null default 'owner' check (role in ('owner', 'manager')),
  created_at  timestamptz not null default now(),
  primary key (tenant_slug, user_id)
);

-- Мастера студии. Им видна история записей — и только своей студии.
create table if not exists public.staff_members (
  tenant_slug text        not null references public.tenants(slug) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  full_name   text        not null default '',
  created_at  timestamptz not null default now(),
  primary key (tenant_slug, user_id)
);

-- Учёт вопросов помощнику: без него один человек мог бы перебрать
-- лимит за минуту и упереться в лимит проекта.
create table if not exists public.assistant_usage (
  id          uuid primary key default gen_random_uuid(),
  tenant_slug text        not null references public.tenants(slug) on delete cascade,
  -- Для клиента — хеш телефона или IP; для владельца — user_id.
  actor       text        not null,
  -- Снимок вопроса/ответа: нужен, чтобы разобраться, что спросили.
  question    text        not null default '',
  answer      text        not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists assistant_usage_actor_idx
  on public.assistant_usage (tenant_slug, actor, created_at desc);

-- ---------------------------------------------------------------------------
-- Записи об изменениях
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tenants_touch on public.tenants;
create trigger tenants_touch before update on public.tenants
  for each row execute function public.touch_updated_at();

drop trigger if exists tenant_settings_touch on public.tenant_settings;
create trigger tenant_settings_touch before update on public.tenant_settings
  for each row execute function public.touch_updated_at();

drop trigger if exists bookings_touch on public.bookings;
create trigger bookings_touch before update on public.bookings
  for each row execute function public.touch_updated_at();
