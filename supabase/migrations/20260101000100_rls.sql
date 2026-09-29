-- Права доступа.
--
-- Правило простое: клиент не читает таблицу записей вообще. Все операции
-- идут через функции с проверкой прав — так нельзя случайно вылить чужие
-- записи, даже если забыть условие в запросе.

-- ---------------------------------------------------------------------------
-- Вспомогательные функции
-- ---------------------------------------------------------------------------

create or replace function public.is_tenant_owner(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_slug = p_slug and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_tenant_staff(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_members s
    where s.tenant_slug = p_slug and s.user_id = auth.uid()
  );
$$;

comment on function public.is_tenant_owner(text) is
  'Владелец студии. SECURITY DEFINER, чтобы политики не зависели от прав на tenant_members.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.tenants          enable row level security;
alter table public.tenant_settings  enable row level security;
alter table public.bookings         enable row level security;
alter table public.tenant_members   enable row level security;
alter table public.staff_members    enable row level security;
alter table public.assistant_usage  enable row level security;

-- Студия: все видят опубликованные, владелец ещё и свою черновиковую.
drop policy if exists tenants_read on public.tenants;
create policy tenants_read on public.tenants
  for select
  using (is_published or public.is_tenant_owner(slug));

drop policy if exists tenants_owner_write on public.tenants;
create policy tenants_owner_write on public.tenants
  for all
  using (public.is_tenant_owner(slug))
  with check (public.is_tenant_owner(slug));

-- Настройки: прочитать должен любой (иначе правки владельца не видно
-- посетителям), изменить — только владелец.
drop policy if exists tenant_settings_read on public.tenant_settings;
create policy tenant_settings_read on public.tenant_settings
  for select
  using (
    exists (
      select 1 from public.tenants t
      where t.slug = tenant_slug and (t.is_published or public.is_tenant_owner(t.slug))
    )
  );

drop policy if exists tenant_settings_owner_write on public.tenant_settings;
create policy tenant_settings_owner_write on public.tenant_settings
  for all
  using (public.is_tenant_owner(tenant_slug))
  with check (public.is_tenant_owner(tenant_slug));

-- Записи: прямого до нет ни у кого, кроме владельца и мастера.
-- Клиент ходит только через create_booking / my_bookings / cancel_booking.
drop policy if exists bookings_staff_read on public.bookings;
create policy bookings_staff_read on public.bookings
  for select
  using (public.is_tenant_owner(tenant_slug) or public.is_tenant_staff(tenant_slug));

drop policy if exists bookings_staff_update on public.bookings;
create policy bookings_staff_update on public.bookings
  for update
  using (public.is_tenant_owner(tenant_slug) or public.is_tenant_staff(tenant_slug))
  with check (public.is_tenant_owner(tenant_slug) or public.is_tenant_staff(tenant_slug));

-- Сотрудники и владельцы
drop policy if exists tenant_members_owner on public.tenant_members;
create policy tenant_members_owner on public.tenant_members
  for all
  using (public.is_tenant_owner(tenant_slug))
  with check (public.is_tenant_owner(tenant_slug));

drop policy if exists staff_members_manage on public.staff_members;
create policy staff_members_manage on public.staff_members
  for all
  using (public.is_tenant_owner(tenant_slug))
  with check (public.is_tenant_owner(tenant_slug));

drop policy if exists staff_members_self_read on public.staff_members;
create policy staff_members_self_read on public.staff_members
  for select
  using (user_id = auth.uid());

-- Учёт помощника виден только владельцу студии.
drop policy if exists assistant_usage_owner_read on public.assistant_usage;
create policy assistant_usage_owner_read on public.assistant_usage
  for select
  using (public.is_tenant_owner(tenant_slug));
