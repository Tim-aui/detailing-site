-- Уведомления владельцу в Telegram (FIXES.md, 2.1 / 2.3 / 4.2).
--
-- Как работает:
--   1. Владелец в кабинете жмёт «Подключить Telegram» → owner_telegram_link
--      выдаёт одноразовый токен → ссылка t.me/<бот>?start=<токен>.
--   2. Бот (Edge Function telegram) получает /start <токен> и вызывает
--      telegram_bind: chat id привязывается к студии.
--   3. Триггер на bookings (новая запись, отмена клиентом) через pg_net
--      дёргает ту же функцию; она шлёт сообщение с кнопками
--      «Подтвердить» / «Отменить».
--   4. Кнопка → telegram_set_status (проверяет, что нажали из чата этой
--      студии, и подпись кнопки).
--
-- Почему chat id не в tenants.config / tenant_settings.patch: patch отдаётся
-- посетителям через studio_patch, config — копия файла из git. Здесь —
-- отдельная таблица без доступа извне.
--
-- Адрес функции и общий секрет лежат в Vault (имена ниже). Пока их нет,
-- триггер молча ничего не отправляет — запись это не ломает.
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/telegram', 'telegram_notify_url');
--   select vault.create_secret('<тот же NOTIFY_SECRET, что в секретах функции>', 'telegram_notify_secret');

do $$
begin
  create extension if not exists pg_net;
exception when others then
  -- Локальный Postgres без pg_net: уведомления просто не отправляются.
  raise notice 'pg_net недоступен: %', sqlerrm;
end;
$$;

create table if not exists public.tenant_notify (
  tenant_slug        text primary key references public.tenants(slug) on delete cascade on update cascade,
  telegram_chat_id   bigint,
  telegram_linked_at timestamptz,
  link_token         text unique,
  link_expires_at    timestamptz,
  updated_at         timestamptz not null default now()
);
alter table public.tenant_notify enable row level security;
revoke all on table public.tenant_notify from anon, authenticated;

drop trigger if exists tenant_notify_touch on public.tenant_notify;
create trigger tenant_notify_touch before update on public.tenant_notify
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Кабинет
-- ---------------------------------------------------------------------------

create or replace function public.owner_notify_status(p_tenant_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  n public.tenant_notify%rowtype;
begin
  if not public.is_tenant_owner(p_tenant_slug) then
    raise exception 'Настройки уведомлений доступны только владельцу' using errcode = '42501';
  end if;
  select * into n from public.tenant_notify where tenant_slug = p_tenant_slug;
  return jsonb_build_object(
    'telegramLinked', coalesce(n.telegram_chat_id is not null, false),
    'telegramLinkedAt', n.telegram_linked_at
  );
end;
$$;

-- Одноразовый токен для ссылки t.me/<бот>?start=<токен>. Живёт час.
create or replace function public.owner_telegram_link(p_tenant_slug text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_token text := encode(gen_random_bytes(16), 'hex');
begin
  if not public.is_tenant_owner(p_tenant_slug) then
    raise exception 'Подключить уведомления может только владелец' using errcode = '42501';
  end if;
  insert into public.tenant_notify (tenant_slug, link_token, link_expires_at)
  values (p_tenant_slug, v_token, now() + interval '1 hour')
  on conflict (tenant_slug) do update
    set link_token = excluded.link_token, link_expires_at = excluded.link_expires_at;
  return jsonb_build_object('token', v_token, 'expiresAt', now() + interval '1 hour');
end;
$$;

create or replace function public.owner_telegram_unlink(p_tenant_slug text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_tenant_owner(p_tenant_slug) then
    raise exception 'Отключить уведомления может только владелец' using errcode = '42501';
  end if;
  update public.tenant_notify
  set telegram_chat_id = null, telegram_linked_at = null, link_token = null, link_expires_at = null
  where tenant_slug = p_tenant_slug;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Бот (только service_role)
-- ---------------------------------------------------------------------------

create or replace function public.telegram_bind(p_token text, p_chat_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug text;
begin
  update public.tenant_notify
  set telegram_chat_id = p_chat_id,
      telegram_linked_at = now(),
      link_token = null,
      link_expires_at = null
  where link_token = p_token and link_expires_at > now()
  returning tenant_slug into v_slug;

  if v_slug is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'slug', v_slug,
    'name', coalesce(public.studio_config_any(v_slug) ->> 'name', v_slug));
end;
$$;

-- Всё, что нужно для текста сообщения о записи.
create or replace function public.telegram_booking(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', b.id, 'code', b.code, 'tenantSlug', b.tenant_slug,
    'serviceName', b.service_name, 'startsAt', b.starts_at, 'endsAt', b.ends_at,
    'status', b.status, 'price', b.price, 'source', b.source,
    'name', b.contact_name, 'phone', b.contact_phone, 'car', b.car, 'comment', b.comment,
    'studioName', coalesce(c.cfg ->> 'name', b.tenant_slug),
    'timezone', coalesce(c.cfg ->> 'timezone', 'Europe/Moscow'),
    'chatId', n.telegram_chat_id
  )
  from public.bookings b
  cross join lateral (select public.studio_config_any(b.tenant_slug) as cfg) c
  left join public.tenant_notify n on n.tenant_slug = b.tenant_slug
  where b.id = p_booking_id;
$$;

-- Кнопка в Telegram. Принимаем только из чата, привязанного к студии.
create or replace function public.telegram_set_status(
  p_booking_id uuid,
  p_chat_id    bigint,
  p_status     public.booking_status
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  b public.bookings%rowtype;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'Запись не найдена');
  end if;
  if not exists (
    select 1 from public.tenant_notify n
    where n.tenant_slug = b.tenant_slug and n.telegram_chat_id = p_chat_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'Этот чат не подключён к студии');
  end if;

  if p_status = 'confirmed' and b.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'Запись уже не ожидает подтверждения', 'status', b.status);
  end if;
  if p_status = 'cancelled' and b.status not in ('pending', 'confirmed') then
    return jsonb_build_object('ok', false, 'reason', 'Эту запись уже нельзя отменить', 'status', b.status);
  end if;
  if p_status not in ('confirmed', 'cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'Недопустимое действие');
  end if;

  -- Изменение пришло из Telegram — о нём не нужно уведомлять тот же чат.
  perform set_config('app.notify_skip', 'on', true);
  update public.bookings set status = p_status where id = b.id;
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Триггер: новая запись и отмена клиентом → Telegram
-- ---------------------------------------------------------------------------

create or replace function public.bookings_notify_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event  text;
  v_url    text;
  v_secret text;
begin
  -- Изменение пришло из Telegram или из служебного скрипта (демо-данные).
  if coalesce(current_setting('app.notify_skip', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_event := 'created';
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled'
        -- Отменил сам владелец/мастер в кабинете — он и так знает.
        and auth.uid() is null then
    v_event := 'cancelled';
  else
    return null;
  end if;

  -- Без привязанного чата не тратим запрос.
  if not exists (
    select 1 from public.tenant_notify n
    where n.tenant_slug = new.tenant_slug and n.telegram_chat_id is not null
  ) then
    return null;
  end if;

  begin
    execute $q$select
        (select decrypted_secret from vault.decrypted_secrets where name = 'telegram_notify_url' limit 1),
        (select decrypted_secret from vault.decrypted_secrets where name = 'telegram_notify_secret' limit 1)$q$
      into v_url, v_secret;

    if v_url is null or v_secret is null then
      return null;
    end if;

    -- pg_net асинхронный: запрос уйдёт после коммита, запись не ждёт Telegram.
    execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
      using v_url,
            jsonb_build_object('event', v_event, 'bookingId', new.id),
            jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret);
  exception when others then
    -- Уведомление не должно мешать записи ни при каких условиях.
    raise warning 'Уведомление владельцу не отправлено: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists bookings_notify_owner on public.bookings;
create trigger bookings_notify_owner
  after insert or update of status on public.bookings
  for each row execute function public.bookings_notify_owner();

-- ---------------------------------------------------------------------------
-- Права
-- ---------------------------------------------------------------------------

revoke execute on function public.owner_notify_status(text)     from public, anon, authenticated;
revoke execute on function public.owner_telegram_link(text)     from public, anon, authenticated;
revoke execute on function public.owner_telegram_unlink(text)   from public, anon, authenticated;
revoke execute on function public.telegram_bind(text, bigint)   from public, anon, authenticated;
revoke execute on function public.telegram_booking(uuid)        from public, anon, authenticated;
revoke execute on function public.telegram_set_status(uuid, bigint, public.booking_status) from public, anon, authenticated;
revoke execute on function public.bookings_notify_owner()       from public, anon, authenticated;

grant execute on function public.owner_notify_status(text)      to authenticated;
grant execute on function public.owner_telegram_link(text)      to authenticated;
grant execute on function public.owner_telegram_unlink(text)    to authenticated;
grant execute on function public.telegram_bind(text, bigint)    to service_role;
grant execute on function public.telegram_booking(uuid)         to service_role;
grant execute on function public.telegram_set_status(uuid, bigint, public.booking_status) to service_role;
