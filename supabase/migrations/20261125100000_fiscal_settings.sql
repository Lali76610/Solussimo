-- =============================================================================
-- SOLUSSIMO — Migration 017 : paramétrage fiscal (V0.5 Caisse)
--  · profil fiscal par établissement (pays, devise, mentions, mode fiscal)
--    D1 : mode « certified » IMPOSSIBLE en V0.5 (contrainte) — démo / non certifié seulement
--  · taux de TVA datés, non modifiables une fois utilisés
--  · moyens de paiement configurables (dont moyens locaux), catalogue produits
--  · plafonds de remise par rôle (D5), permissions Caisse
-- Montants : entiers en unités mineures (centimes). Taux : points de base (2000 = 20 %).
-- =============================================================================

create type public.fiscal_mode as enum ('demo', 'uncertified', 'certified');
create type public.payment_method_kind as enum ('cash', 'card', 'transfer', 'cheque', 'local');

-- --- Plafonds de remise (D5) ---------------------------------------------------------
alter table public.companies
  add column discount_cap_staff_bp integer not null default 1000 check (discount_cap_staff_bp between 0 and 10000),
  add column discount_cap_manager_bp integer not null default 3000 check (discount_cap_manager_bp between 0 and 10000);

-- --- Profil fiscal par établissement ----------------------------------------------------
create table public.fiscal_profiles (
  establishment_id   uuid primary key,
  company_id         uuid not null references public.companies (id) on delete cascade,
  country_code       text not null check (country_code ~ '^[A-Z]{2}$'),
  currency           text not null check (currency ~ '^[A-Z]{3}$'),
  -- D1 : la V0.5 n'est PAS certifiée ; « certified » sera débloqué après certification.
  fiscal_mode        public.fiscal_mode not null default 'uncertified' check (fiscal_mode in ('demo', 'uncertified')),
  seller_legal_name  text check (seller_legal_name is null or char_length(seller_legal_name) <= 160),
  seller_tax_id      text check (seller_tax_id is null or char_length(seller_tax_id) <= 40),      -- SIREN, NIF, UID…
  seller_vat_number  text check (seller_vat_number is null or char_length(seller_vat_number) <= 40),
  seller_address     text check (seller_address is null or char_length(seller_address) <= 300),
  legal_mentions     text check (legal_mentions is null or char_length(legal_mentions) <= 1000),
  b2c_invoice_threshold_cents bigint not null default 0 check (b2c_invoice_threshold_cents >= 0),
  updated_at         timestamptz not null default now(),
  foreign key (establishment_id, company_id) references public.establishments (id, company_id) on delete cascade
);
create index fiscal_profiles_company_idx on public.fiscal_profiles (company_id);
create trigger fiscal_profiles_updated_at before update on public.fiscal_profiles
  for each row execute function private.set_updated_at();

-- --- Taux de TVA datés ---------------------------------------------------------------
create table public.tax_rates (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  code         text not null check (code ~ '^[a-z_]{2,20}$'),
  label        text not null check (char_length(label) between 1 and 60),
  rate_bp      integer not null check (rate_bp between 0 and 10000),
  valid_from   date not null default date '2000-01-01',
  valid_to     date,
  created_at   timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  unique (company_id, country_code, code, valid_from),
  unique (id, company_id)
);
create index tax_rates_company_idx on public.tax_rates (company_id, country_code, code);

-- --- Moyens de paiement ------------------------------------------------------------------
create table public.payment_methods (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind       public.payment_method_kind not null,
  label      text not null check (char_length(btrim(label)) between 1 and 40),
  active     boolean not null default true,
  sort       smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (id, company_id)
);
create index payment_methods_company_idx on public.payment_methods (company_id, sort);

-- --- Catalogue produits (le stock arrive en V0.6 — D12) -------------------------------------
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 2 and 80),
  sku         text check (sku is null or char_length(sku) <= 40),
  price_cents bigint not null check (price_cents between 0 and 100000000),
  tax_code    text not null default 'standard' check (tax_code ~ '^[a-z_]{2,20}$'),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, company_id)
);
create index products_company_idx on public.products (company_id, name);
create trigger products_updated_at before update on public.products
  for each row execute function private.set_updated_at();

-- Prestations : code de taux (le taux effectif dépend du pays de l'établissement et de la date).
alter table public.services add column tax_code text not null default 'standard' check (tax_code ~ '^[a-z_]{2,20}$');

-- --- Valeurs par défaut par pays (à valider par un expert local) ---------------------------
create or replace function private.seed_fiscal_defaults(p_company_id uuid, p_country text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.tax_rates (company_id, country_code, code, label, rate_bp)
  select p_company_id, p_country, r.code, r.label, r.rate_bp
  from (values
    ('FR', 'standard', 'TVA 20 %', 2000), ('FR', 'intermediate', 'TVA 10 %', 1000), ('FR', 'reduced', 'TVA 5,5 %', 550),
    ('ES', 'standard', 'IVA 21 %', 2100), ('ES', 'reduced', 'IVA 10 %', 1000),
    ('BE', 'standard', 'TVA 21 %', 2100), ('BE', 'reduced', 'TVA 6 %', 600),
    ('CH', 'standard', 'TVA 8,1 %', 810), ('CH', 'reduced', 'TVA 2,6 %', 260),
    ('DE', 'standard', 'MwSt. 19 %', 1900), ('DE', 'reduced', 'MwSt. 7 %', 700)
  ) as r(country, code, label, rate_bp)
  where r.country = p_country
  on conflict do nothing;

  if not exists (select 1 from public.payment_methods m where m.company_id = p_company_id) then
    insert into public.payment_methods (company_id, kind, label, sort) values
      (p_company_id, 'cash', 'Espèces', 1), (p_company_id, 'card', 'Carte', 2),
      (p_company_id, 'transfer', 'Virement', 3), (p_company_id, 'cheque', 'Chèque', 4);
    insert into public.payment_methods (company_id, kind, label, sort)
    select p_company_id, 'local', l.label, 5
    from (values ('ES', 'Bizum'), ('CH', 'TWINT'), ('BE', 'Payconiq')) as l(country, label)
    where l.country = p_country;
  end if;
end;
$$;

create or replace function private.default_b2c_threshold(p_country text)
returns bigint language sql immutable set search_path = ''
as $$ select (case upper(p_country) when 'FR' then 2500 else 0 end)::bigint; $$;

-- Profil fiscal créé avec chaque établissement.
create or replace function private.establishment_fiscal_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_currency text;
begin
  select c.currency into v_currency from public.companies c where c.id = new.company_id;
  insert into public.fiscal_profiles (establishment_id, company_id, country_code, currency, b2c_invoice_threshold_cents)
  values (new.id, new.company_id, new.country_code, coalesce(v_currency, 'EUR'), private.default_b2c_threshold(new.country_code))
  on conflict do nothing;
  perform private.seed_fiscal_defaults(new.company_id, new.country_code);
  return null;
end;
$$;
create trigger establishments_fiscal_profile after insert on public.establishments
  for each row execute function private.establishment_fiscal_profile();

-- Établissements existants.
insert into public.fiscal_profiles (establishment_id, company_id, country_code, currency, b2c_invoice_threshold_cents)
select e.id, e.company_id, e.country_code, c.currency, private.default_b2c_threshold(e.country_code)
from public.establishments e join public.companies c on c.id = e.company_id
on conflict do nothing;
do $$ begin perform private.seed_fiscal_defaults(e.company_id, e.country_code) from public.establishments e; end $$;

-- Taux applicable à une date (pays de l'établissement).
create or replace function private.tax_rate_for(p_company_id uuid, p_country text, p_code text, p_date date)
returns public.tax_rates language sql stable security definer set search_path = ''
as $$
  select * from public.tax_rates t
  where t.company_id = p_company_id and t.country_code = p_country and t.code = p_code
    and t.valid_from <= p_date and (t.valid_to is null or t.valid_to > p_date)
  order by t.valid_from desc limit 1;
$$;

-- --- Permissions Caisse ---------------------------------------------------------------
create or replace function private.permission_roles(p_permission text)
returns public.company_role[]
language sql immutable set search_path = ''
as $$
  select case p_permission
    when 'company.read'         then array['owner', 'admin', 'manager', 'staff']
    when 'company.update'       then array['owner', 'admin']
    when 'company.delete'       then array['owner']
    when 'establishment.write'  then array['owner', 'admin']
    when 'establishment.delete' then array['owner']
    when 'membership.manage'    then array['owner', 'admin']
    when 'invitation.manage'    then array['owner', 'admin']
    when 'staff.write'          then array['owner', 'admin', 'manager']
    when 'schedule.write'       then array['owner', 'admin', 'manager']
    when 'service.write'        then array['owner', 'admin']
    when 'resource.write'       then array['owner', 'admin']
    when 'appointment.write'    then array['owner', 'admin', 'manager', 'staff']
    when 'audit.read'           then array['owner', 'admin']
    when 'client.read'          then array['owner', 'admin', 'manager', 'staff']
    when 'client.write'         then array['owner', 'admin', 'manager', 'staff']
    when 'client.contact.read'  then array['owner', 'admin', 'manager']
    when 'client.merge'         then array['owner', 'admin', 'manager']
    when 'client.export'        then array['owner', 'admin']
    when 'client.erase'         then array['owner', 'admin']
    when 'consent.write'        then array['owner', 'admin', 'manager', 'staff']
    when 'settings.health'      then array['owner']
    when 'settings.retention'   then array['owner', 'admin']
    -- V0.5 Caisse (D6 : le collaborateur ouvre/encaisse/clôture, sans avoirs ni rapports globaux)
    when 'register.operate'     then array['owner', 'admin', 'manager', 'staff']
    when 'refund.issue'         then array['owner', 'admin', 'manager']
    when 'cash.movement'        then array['owner', 'admin', 'manager']
    when 'discount.approve'     then array['owner', 'admin', 'manager']
    when 'reports.read'         then array['owner', 'admin', 'manager']
    when 'accounting.export'    then array['owner', 'admin']
    when 'catalog.write'        then array['owner', 'admin']
    when 'settings.fiscal'      then array['owner']
    else array[]::text[]
  end::public.company_role[];
$$;

create or replace function public.my_permissions(p_company_id uuid)
returns text[]
language sql stable security invoker set search_path = ''
as $$
  select coalesce(array_agg(p order by p), array[]::text[])
  from unnest(array[
    'company.read', 'company.update', 'company.delete', 'establishment.write',
    'establishment.delete', 'membership.manage', 'invitation.manage', 'staff.write',
    'schedule.write', 'service.write', 'resource.write', 'appointment.write', 'audit.read',
    'client.read', 'client.write', 'client.contact.read', 'client.merge', 'client.export',
    'client.erase', 'consent.write', 'settings.health', 'settings.retention',
    'register.operate', 'refund.issue', 'cash.movement', 'discount.approve', 'reports.read',
    'accounting.export', 'catalog.write', 'settings.fiscal'
  ]) as p
  where private.can(p_company_id, p);
$$;

-- --- RLS / privilèges -------------------------------------------------------------------
alter table public.fiscal_profiles enable row level security;
alter table public.tax_rates enable row level security;
alter table public.payment_methods enable row level security;
alter table public.products enable row level security;
revoke all on public.fiscal_profiles, public.tax_rates, public.payment_methods, public.products from public, anon, authenticated;

grant select on public.fiscal_profiles to authenticated;
grant update (seller_legal_name, seller_tax_id, seller_vat_number, seller_address, legal_mentions, b2c_invoice_threshold_cents, fiscal_mode)
  on public.fiscal_profiles to authenticated;
create policy fiscal_profiles_select on public.fiscal_profiles for select to authenticated
  using (private.can_access_establishment(establishment_id));
create policy fiscal_profiles_update on public.fiscal_profiles for update to authenticated
  using (private.can(company_id, 'settings.fiscal')) with check (private.can(company_id, 'settings.fiscal'));

grant select on public.tax_rates to authenticated;
grant insert (company_id, country_code, code, label, rate_bp, valid_from, valid_to) on public.tax_rates to authenticated;
grant update (label, valid_to) on public.tax_rates to authenticated;
create policy tax_rates_select on public.tax_rates for select to authenticated
  using (private.is_company_member(company_id));
create policy tax_rates_insert on public.tax_rates for insert to authenticated
  with check (private.can(company_id, 'settings.fiscal'));
create policy tax_rates_update on public.tax_rates for update to authenticated
  using (private.can(company_id, 'settings.fiscal')) with check (private.can(company_id, 'settings.fiscal'));

grant select on public.payment_methods to authenticated;
grant insert (company_id, kind, label, active, sort) on public.payment_methods to authenticated;
grant update (label, active, sort) on public.payment_methods to authenticated;
create policy payment_methods_select on public.payment_methods for select to authenticated
  using (private.is_company_member(company_id));
create policy payment_methods_insert on public.payment_methods for insert to authenticated
  with check (private.can(company_id, 'settings.fiscal'));
create policy payment_methods_update on public.payment_methods for update to authenticated
  using (private.can(company_id, 'settings.fiscal')) with check (private.can(company_id, 'settings.fiscal'));

grant select on public.products to authenticated;
grant insert (company_id, name, sku, price_cents, tax_code, active) on public.products to authenticated;
grant update (name, sku, price_cents, tax_code, active) on public.products to authenticated;
create policy products_select on public.products for select to authenticated
  using (private.is_company_member(company_id));
create policy products_insert on public.products for insert to authenticated
  with check (private.can(company_id, 'catalog.write'));
create policy products_update on public.products for update to authenticated
  using (private.can(company_id, 'catalog.write')) with check (private.can(company_id, 'catalog.write'));

grant update (tax_code) on public.services to authenticated;

-- Plafonds de remise : modifiables par le propriétaire (settings.fiscal) via RPC.
create or replace function private.set_discount_caps(p_company_id uuid, p_staff_bp integer, p_manager_bp integer)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.can(p_company_id, 'settings.fiscal') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.companies c set discount_cap_staff_bp = p_staff_bp, discount_cap_manager_bp = p_manager_bp where c.id = p_company_id;
end;
$$;
revoke all on function private.set_discount_caps(uuid, integer, integer) from public, anon;
grant execute on function private.set_discount_caps(uuid, integer, integer) to authenticated;
create function public.set_discount_caps(p_company_id uuid, p_staff_bp integer, p_manager_bp integer)
returns void language sql security invoker set search_path = ''
as $$ select private.set_discount_caps(p_company_id, p_staff_bp, p_manager_bp); $$;
revoke all on function public.set_discount_caps(uuid, integer, integer) from public, anon;
grant execute on function public.set_discount_caps(uuid, integer, integer) to authenticated;

revoke all on all functions in schema private from public, anon;
