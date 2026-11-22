-- =============================================================================
-- SOLUSSIMO — Migration 018 : caisse et encaissements (V0.5)
--  · caisses, sessions (une seule ouverte par caisse), mouvements d'espèces
--  · complete_sale : encaissement ATOMIQUE calculé côté serveur (prix, TVA, remises)
--  · remises plafonnées par rôle (D5) + code d'approbation d'un responsable
--  · paiements mixtes, rendu monnaie (espèces uniquement), aucun numéro de carte
--  · numérotation continue sans trou, idempotence, chaînage SHA-256, journal fiscal
--  · acomptes (imputés ensuite), avoirs plafonnés au restant remboursable
--  · inaltérabilité : aucune modification ni suppression d'une pièce validée
-- Montants en unités mineures (bigint). D1 : mode non certifié uniquement.
-- =============================================================================

create type public.register_session_status as enum ('open', 'closed');
create type public.sale_kind as enum ('sale', 'deposit', 'credit_note');
create type public.sale_line_kind as enum ('service', 'product', 'custom', 'deposit', 'deposit_applied');

-- --- Caisses et sessions -------------------------------------------------------------
create table public.cash_registers (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  establishment_id uuid not null,
  name             text not null default 'Caisse 1' check (char_length(btrim(name)) between 1 and 40),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (id, company_id),
  foreign key (establishment_id, company_id) references public.establishments (id, company_id) on delete cascade
);
create index cash_registers_establishment_idx on public.cash_registers (establishment_id, company_id);
create index cash_registers_company_idx on public.cash_registers (company_id);

create table public.register_sessions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  establishment_id    uuid not null,
  register_id         uuid not null,
  status              public.register_session_status not null default 'open',
  opened_at           timestamptz not null default now(),
  opened_by           uuid references auth.users (id) on delete set null,
  opening_float_cents bigint not null check (opening_float_cents between 0 and 10000000),
  opening_count       jsonb,
  closed_at           timestamptz,
  closed_by           uuid references auth.users (id) on delete set null,
  counted_cash_cents  bigint,
  closing_count       jsonb,
  expected_cash_cents bigint,
  difference_cents    bigint,
  difference_reason   text check (difference_reason is null or char_length(difference_reason) <= 300),
  foreign key (register_id, company_id) references public.cash_registers (id, company_id) on delete cascade,
  foreign key (establishment_id, company_id) references public.establishments (id, company_id) on delete cascade
);
-- Une seule session ouverte par caisse.
create unique index register_sessions_one_open_uidx on public.register_sessions (register_id) where status = 'open';
create index register_sessions_establishment_idx on public.register_sessions (establishment_id, opened_at desc);
create index register_sessions_company_idx on public.register_sessions (company_id);
create index register_sessions_register_company_idx on public.register_sessions (register_id, company_id);
create index register_sessions_establishment_company_idx on public.register_sessions (establishment_id, company_id);
create index register_sessions_opened_by_idx on public.register_sessions (opened_by);
create index register_sessions_closed_by_idx on public.register_sessions (closed_by);

create table public.cash_movements (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  session_id   uuid not null references public.register_sessions (id) on delete cascade,
  direction    text not null check (direction in ('in', 'out')),
  amount_cents bigint not null check (amount_cents between 1 and 10000000),
  reason       text not null check (char_length(btrim(reason)) between 2 and 200),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index cash_movements_session_idx on public.cash_movements (session_id);
create index cash_movements_company_idx on public.cash_movements (company_id);
create index cash_movements_created_by_idx on public.cash_movements (created_by);

-- Une caisse par défaut pour chaque établissement.
create or replace function private.establishment_default_register()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.cash_registers (company_id, establishment_id) values (new.company_id, new.id);
  return null;
end;
$$;
create trigger establishments_default_register after insert on public.establishments
  for each row execute function private.establishment_default_register();
insert into public.cash_registers (company_id, establishment_id)
select e.company_id, e.id from public.establishments e
where not exists (select 1 from public.cash_registers r where r.establishment_id = e.id);

-- --- Numérotation, chaînage, journal -------------------------------------------------
create table public.document_counters (
  establishment_id uuid not null references public.establishments (id) on delete cascade,
  series           text not null,
  year             integer not null,
  last_number      integer not null default 0,
  primary key (establishment_id, series, year)
);

create table public.fiscal_chain_heads (
  establishment_id  uuid primary key references public.establishments (id) on delete cascade,
  last_hash         text not null default 'GENESIS',
  last_journal_hash text not null default 'GENESIS'
);

create table public.fiscal_journal (
  id               bigint generated always as identity primary key,
  company_id       uuid not null references public.companies (id) on delete cascade,
  establishment_id uuid not null references public.establishments (id) on delete cascade,
  event            text not null check (char_length(event) <= 60),
  ref_id           uuid,
  actor_id         uuid,
  payload          jsonb not null default '{}',  -- jamais de données personnelles
  created_at       timestamptz not null default clock_timestamp(),
  prev_hash        text not null,
  hash             text not null
);
create index fiscal_journal_establishment_idx on public.fiscal_journal (establishment_id, id);
create index fiscal_journal_company_idx on public.fiscal_journal (company_id);

-- Verrou de la tête de chaîne (sérialise les validations d'un établissement).
create or replace function private.lock_chain_head(p_establishment_id uuid)
returns public.fiscal_chain_heads language plpgsql security definer set search_path = ''
as $$
declare
  v_head public.fiscal_chain_heads%rowtype;
begin
  insert into public.fiscal_chain_heads (establishment_id) values (p_establishment_id) on conflict do nothing;
  select * into v_head from public.fiscal_chain_heads h where h.establishment_id = p_establishment_id for update;
  return v_head;
end;
$$;

create or replace function private.journal(p_company_id uuid, p_establishment_id uuid, p_event text, p_ref uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_head public.fiscal_chain_heads%rowtype;
  v_at timestamptz := clock_timestamp();
  v_hash text;
begin
  v_head := private.lock_chain_head(p_establishment_id);
  v_hash := encode(sha256(convert_to(concat_ws('|', v_head.last_journal_hash, p_event, p_ref, (select auth.uid()),
                                                 to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), coalesce(p_payload, '{}')::text), 'UTF8')), 'hex');
  insert into public.fiscal_journal (company_id, establishment_id, event, ref_id, actor_id, payload, created_at, prev_hash, hash)
  values (p_company_id, p_establishment_id, p_event, p_ref, (select auth.uid()), coalesce(p_payload, '{}'), v_at, v_head.last_journal_hash, v_hash);
  update public.fiscal_chain_heads h set last_journal_hash = v_hash where h.establishment_id = p_establishment_id;
end;
$$;

-- Numéro suivant (verrou de ligne ; annulé avec la transaction → aucun trou).
create or replace function private.next_number(p_establishment_id uuid, p_series text, p_year integer)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into public.document_counters (establishment_id, series, year, last_number)
  values (p_establishment_id, p_series, p_year, 1)
  on conflict (establishment_id, series, year) do update set last_number = public.document_counters.last_number + 1
  returning last_number into v_n;
  return v_n;
end;
$$;

-- Date locale de l'établissement (jour de caisse, changements d'heure compris).
create or replace function private.local_date(p_establishment_id uuid, p_at timestamptz)
returns date language sql stable security definer set search_path = ''
as $$ select (p_at at time zone e.timezone)::date from public.establishments e where e.id = p_establishment_id; $$;

-- --- Ventes, lignes, paiements --------------------------------------------------------------
create table public.sales (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  establishment_id    uuid not null,
  register_session_id uuid not null references public.register_sessions (id),
  kind                public.sale_kind not null,
  series              text not null,
  year                integer not null,
  number              integer not null,
  document_no         text not null,
  client_id           uuid,
  appointment_id      uuid references public.appointments (id),
  original_sale_id    uuid references public.sales (id),
  currency            text not null,
  subtotal_cents      bigint not null,   -- avant remises
  discount_cents      bigint not null default 0,
  total_cents         bigint not null,   -- TTC
  tax_cents           bigint not null,
  net_cents           bigint not null,   -- HT
  discount_reason     text check (discount_reason is null or char_length(discount_reason) <= 200),
  discount_approved_by uuid references auth.users (id) on delete set null,
  refund_reason       text check (refund_reason is null or char_length(refund_reason) <= 200),
  fiscal_mode         public.fiscal_mode not null,
  idempotency_key     uuid not null,
  created_by          uuid references auth.users (id) on delete set null,
  completed_at        timestamptz not null default clock_timestamp(),
  prev_hash           text,
  hash                text,
  unique (company_id, idempotency_key),
  unique (establishment_id, series, year, number),
  unique (id, company_id),
  foreign key (establishment_id, company_id) references public.establishments (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id),
  check (total_cents = net_cents + tax_cents)
);
-- Un rendez-vous n'est encaissé qu'une fois.
create unique index sales_appointment_uidx on public.sales (appointment_id) where kind = 'sale' and appointment_id is not null;
create index sales_establishment_time_idx on public.sales (establishment_id, completed_at desc);
create index sales_company_idx on public.sales (company_id);
create index sales_session_idx on public.sales (register_session_id);
create index sales_client_idx on public.sales (client_id, company_id);
create index sales_original_idx on public.sales (original_sale_id);
create index sales_created_by_idx on public.sales (created_by);
create index sales_approved_by_idx on public.sales (discount_approved_by);
create index sales_establishment_company_idx on public.sales (establishment_id, company_id);

create table public.sale_lines (
  id               uuid primary key default gen_random_uuid(),
  sale_id          uuid not null references public.sales (id),
  company_id       uuid not null references public.companies (id) on delete cascade,
  position         smallint not null,
  kind             public.sale_line_kind not null,
  service_id       uuid references public.services (id),
  product_id       uuid references public.products (id),
  ref_sale_id      uuid references public.sales (id),       -- acompte imputé
  original_line_id uuid references public.sale_lines (id),  -- ligne remboursée (avoir)
  staff_id         uuid references public.staff_members (id) on delete set null,
  label            text not null check (char_length(label) between 1 and 120),
  quantity         integer not null check (quantity between -99 and 99 and quantity <> 0),
  unit_price_cents bigint not null,
  discount_cents   bigint not null default 0,
  tax_rate_bp      integer not null check (tax_rate_bp between 0 and 10000),
  total_cents      bigint not null,
  tax_cents        bigint not null,
  net_cents        bigint not null,
  check (total_cents = net_cents + tax_cents),
  unique (sale_id, position)
);
create index sale_lines_company_idx on public.sale_lines (company_id);
create index sale_lines_service_idx on public.sale_lines (service_id);
create index sale_lines_product_idx on public.sale_lines (product_id);
create index sale_lines_ref_sale_idx on public.sale_lines (ref_sale_id);
create index sale_lines_original_idx on public.sale_lines (original_line_id);
create index sale_lines_staff_idx on public.sale_lines (staff_id);

create table public.sale_payments (
  id                uuid primary key default gen_random_uuid(),
  sale_id           uuid not null references public.sales (id),
  company_id        uuid not null references public.companies (id) on delete cascade,
  payment_method_id uuid not null references public.payment_methods (id),
  method_kind       public.payment_method_kind not null,
  method_label      text not null,
  amount_cents      bigint not null check (amount_cents <> 0),
  tendered_cents    bigint,
  change_cents      bigint not null default 0 check (change_cents >= 0),
  -- Référence de transaction du terminal : jamais un numéro de carte (aucune suite de 12+ chiffres).
  external_ref      text check (external_ref is null or (char_length(external_ref) <= 40 and external_ref !~ '[0-9]{12,}')),
  received_at       timestamptz not null default clock_timestamp()
);
create index sale_payments_sale_idx on public.sale_payments (sale_id);
create index sale_payments_company_idx on public.sale_payments (company_id);
create index sale_payments_method_idx on public.sale_payments (payment_method_id);

-- Acompte imputé une seule fois.
create table public.deposit_applications (
  deposit_sale_id uuid primary key references public.sales (id),
  sale_id         uuid not null references public.sales (id),
  company_id      uuid not null references public.companies (id) on delete cascade,
  created_at      timestamptz not null default now()
);
create index deposit_applications_sale_idx on public.deposit_applications (sale_id);
create index deposit_applications_company_idx on public.deposit_applications (company_id);

-- Codes d'approbation de remise (D5), usage unique, 15 min.
create table public.discount_approvals (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  establishment_id uuid not null references public.establishments (id) on delete cascade,
  code_hash        bytea not null unique,
  max_bp           integer not null check (max_bp between 1 and 10000),
  approver_id      uuid not null references auth.users (id) on delete cascade,
  expires_at       timestamptz not null,
  used_at          timestamptz,
  used_in_sale_id  uuid references public.sales (id)
);
create index discount_approvals_company_idx on public.discount_approvals (company_id);
create index discount_approvals_establishment_idx on public.discount_approvals (establishment_id);
create index discount_approvals_approver_idx on public.discount_approvals (approver_id);
create index discount_approvals_sale_idx on public.discount_approvals (used_in_sale_id);

create table public.discount_code_failures (
  user_id   uuid not null,
  failed_at timestamptz not null default now()
);
create index discount_code_failures_user_idx on public.discount_code_failures (user_id, failed_at);

-- --- Inaltérabilité ------------------------------------------------------------------------
create or replace function private.forbid_fiscal_change()
returns trigger language plpgsql set search_path = ''
as $$
begin
  -- Seule la finalisation (pose de l'empreinte) d'une vente est autorisée, une seule fois.
  if tg_op = 'UPDATE' and tg_table_name = 'sales' then
    if (to_jsonb(old) ->> 'hash') is null and (to_jsonb(new) ->> 'hash') is not null
       and (to_jsonb(new) - 'hash' - 'prev_hash') = (to_jsonb(old) - 'hash' - 'prev_hash') then
      return new;
    end if;
  end if;
  raise exception 'fiscal_record_immutable' using errcode = '42501';
end;
$$;
create trigger sales_immutable before update or delete on public.sales
  for each row execute function private.forbid_fiscal_change();
create trigger sale_lines_immutable before update or delete on public.sale_lines
  for each row execute function private.forbid_fiscal_change();
create trigger sale_payments_immutable before update or delete on public.sale_payments
  for each row execute function private.forbid_fiscal_change();
create trigger fiscal_journal_immutable before update or delete on public.fiscal_journal
  for each row execute function private.forbid_fiscal_change();
create trigger deposit_applications_immutable before update or delete on public.deposit_applications
  for each row execute function private.forbid_fiscal_change();

-- Suppression d'une entreprise ayant des pièces comptables : refusée (obligation de conservation).
create or replace function private.retain_fiscal_records()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.sales s where s.company_id = old.id) then
    raise exception 'fiscal_records_retained' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
create trigger companies_retain_fiscal_records before delete on public.companies
  for each row execute function private.retain_fiscal_records();

-- --- Visibilité (D6 : le collaborateur ne voit que ses propres ventes) ---------------------------
create or replace function private.can_see_sale_row(p_company_id uuid, p_establishment_id uuid, p_created_by uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.can_in_establishment(p_establishment_id, 'reports.read')
      or (p_created_by = (select auth.uid()) and private.can_in_establishment(p_establishment_id, 'register.operate'));
$$;
create or replace function private.can_see_sale(p_sale_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.sales s where s.id = p_sale_id
                 and private.can_see_sale_row(s.company_id, s.establishment_id, s.created_by));
$$;

-- --- Empreinte d'une vente ------------------------------------------------------------------
create or replace function private.sale_digest(p_sale_id uuid, p_prev text)
returns text language sql stable security definer set search_path = ''
as $$
  select encode(sha256(convert_to(concat_ws('|',
    p_prev, s.document_no, s.kind::text, to_char(s.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    s.currency, s.total_cents, s.tax_cents, s.net_cents, s.discount_cents, s.client_id, s.original_sale_id,
    (select string_agg(concat_ws(';', l.position, l.kind, l.label, l.quantity, l.unit_price_cents, l.discount_cents,
                                 l.tax_rate_bp, l.total_cents, l.tax_cents), '/' order by l.position)
     from public.sale_lines l where l.sale_id = s.id),
    (select string_agg(concat_ws(';', p.method_kind, p.amount_cents, p.change_cents), '/' order by p.id)
     from public.sale_payments p where p.sale_id = s.id)), 'UTF8')), 'hex')
  from public.sales s where s.id = p_sale_id;
$$;

-- Finalisation commune : numéro déjà posé, calcule l'empreinte et met à jour la chaîne.
create or replace function private.seal_sale(p_sale_id uuid, p_establishment_id uuid, p_prev text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_hash text := private.sale_digest(p_sale_id, p_prev);
begin
  update public.sales s set prev_hash = p_prev, hash = v_hash where s.id = p_sale_id;
  update public.fiscal_chain_heads h set last_hash = v_hash where h.establishment_id = p_establishment_id;
  return v_hash;
end;
$$;

-- --- Ouverture de caisse ----------------------------------------------------------------------
create or replace function private.open_register(p_register_id uuid, p_opening_float_cents bigint, p_count jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_reg public.cash_registers%rowtype;
  v_id uuid;
begin
  select * into v_reg from public.cash_registers r where r.id = p_register_id and r.active;
  if not found or not private.can_in_establishment(v_reg.establishment_id, 'register.operate') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  begin
    insert into public.register_sessions (company_id, establishment_id, register_id, opened_by, opening_float_cents, opening_count)
    values (v_reg.company_id, v_reg.establishment_id, v_reg.id, (select auth.uid()), p_opening_float_cents, p_count)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'register_already_open' using errcode = 'P0001';
  end;
  perform private.journal(v_reg.company_id, v_reg.establishment_id, 'register.opened', v_id,
                          jsonb_build_object('opening_float_cents', p_opening_float_cents));
  return v_id;
end;
$$;

-- --- Mouvement d'espèces -------------------------------------------------------------------------
create or replace function private.add_cash_movement(p_session_id uuid, p_direction text, p_amount_cents bigint, p_reason text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_s public.register_sessions%rowtype;
  v_id uuid;
begin
  select * into v_s from public.register_sessions s where s.id = p_session_id for share;
  if not found or not private.can_in_establishment(v_s.establishment_id, 'cash.movement') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_s.status <> 'open' then
    raise exception 'register_closed' using errcode = 'P0001';
  end if;
  insert into public.cash_movements (company_id, session_id, direction, amount_cents, reason, created_by)
  values (v_s.company_id, v_s.id, p_direction, p_amount_cents, btrim(p_reason), (select auth.uid())) returning id into v_id;
  perform private.journal(v_s.company_id, v_s.establishment_id, 'cash.movement', v_id,
                          jsonb_build_object('direction', p_direction, 'amount_cents', p_amount_cents));
  return v_id;
end;
$$;

-- --- Code d'approbation de remise (D5) ---------------------------------------------------------
create or replace function private.create_discount_approval(p_establishment_id uuid, p_max_bp integer)
returns table (code text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
  v_code text := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 100000000)::text, 8, '0');
  v_cap integer;
  v_exp timestamptz := now() + interval '15 minutes';
begin
  select e.company_id into v_company from public.establishments e where e.id = p_establishment_id;
  if v_company is null or not private.can_in_establishment(p_establishment_id, 'discount.approve') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Un responsable n'approuve que dans la limite de son propre plafond.
  v_cap := case when private.is_company_admin(v_company) then 10000
                else (select c.discount_cap_manager_bp from public.companies c where c.id = v_company) end;
  if p_max_bp < 1 or p_max_bp > v_cap then
    raise exception 'discount_cap_exceeded' using errcode = 'P0001';
  end if;
  insert into public.discount_approvals (company_id, establishment_id, code_hash, max_bp, approver_id, expires_at)
  values (v_company, p_establishment_id, sha256(convert_to(p_establishment_id::text || ':' || v_code, 'UTF8')), p_max_bp, (select auth.uid()), v_exp);
  perform private.journal(v_company, p_establishment_id, 'discount.approval_created', null, jsonb_build_object('max_bp', p_max_bp));
  return query select v_code, v_exp;
end;
$$;

-- --- Encaissement -----------------------------------------------------------------------------
-- p_payload : {
--   establishment_id, session_id, idempotency_key, kind: 'sale' | 'deposit', client_id?, appointment_id?,
--   lines: [{kind: 'service'|'product'|'custom', service_id?, product_id?, label?, unit_price_cents?, quantity, discount_bp?, staff_id?}],
--   deposit_amount_cents? (kind = deposit), ticket_discount_bp?, discount_reason?, approval_code?,
--   deposit_ids?: [uuid], payments: [{method_id, amount_cents, tendered_cents?, external_ref?}] }
create or replace function private.complete_sale(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_est public.establishments%rowtype;
  v_profile public.fiscal_profiles%rowtype;
  v_session public.register_sessions%rowtype;
  v_key uuid := (p_payload ->> 'idempotency_key')::uuid;
  v_kind public.sale_kind := coalesce(p_payload ->> 'kind', 'sale')::public.sale_kind;
  v_client uuid := nullif(p_payload ->> 'client_id', '')::uuid;
  v_appt uuid := nullif(p_payload ->> 'appointment_id', '')::uuid;
  v_appt_row public.appointments%rowtype;
  v_existing public.sales%rowtype;
  v_today date;
  v_year integer;
  v_sale_id uuid := gen_random_uuid();
  v_line jsonb;
  v_pos smallint := 0;
  v_rate public.tax_rates%rowtype;
  v_label text;
  v_unit bigint;
  v_qty integer;
  v_code text;
  v_gross bigint;
  v_line_disc bigint;
  v_ticket_bp integer := coalesce((p_payload ->> 'ticket_discount_bp')::integer, 0);
  v_subtotal bigint := 0;
  v_discount bigint := 0;
  v_total bigint := 0;
  v_tax bigint := 0;
  v_cap integer;
  v_eff_bp integer;
  v_approval public.discount_approvals%rowtype;
  v_pay jsonb;
  v_method public.payment_methods%rowtype;
  v_paid bigint := 0;
  v_tendered bigint;
  v_change_total bigint := 0;
  v_amount bigint;
  v_dep public.sales%rowtype;
  v_head public.fiscal_chain_heads%rowtype;
  v_series text;
  v_number integer;
  v_doc text;
  v_role_company uuid;
  v_lines_tmp jsonb := '[]';
  r record;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if v_key is null then
    raise exception 'idempotency_key_required' using errcode = '22023';
  end if;
  select * into v_est from public.establishments e where e.id = (p_payload ->> 'establishment_id')::uuid;
  if not found or not private.can_in_establishment(v_est.id, 'register.operate') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Idempotence : une même clé renvoie le ticket déjà validé.
  select * into v_existing from public.sales s where s.company_id = v_est.company_id and s.idempotency_key = v_key;
  if found then
    return jsonb_build_object('sale_id', v_existing.id, 'document_no', v_existing.document_no,
                              'total_cents', v_existing.total_cents, 'replayed', true);
  end if;

  select * into v_profile from public.fiscal_profiles f where f.establishment_id = v_est.id;
  select * into v_session from public.register_sessions s where s.id = (p_payload ->> 'session_id')::uuid for share;
  if not found or v_session.establishment_id <> v_est.id or v_session.status <> 'open' then
    raise exception 'register_closed' using errcode = 'P0001';
  end if;
  v_today := private.local_date(v_est.id, now());
  v_year := extract(year from v_today)::integer;

  -- Rendez-vous et client.
  if v_appt is not null then
    select * into v_appt_row from public.appointments a where a.id = v_appt;
    if not found or v_appt_row.establishment_id <> v_est.id or v_appt_row.status in ('cancelled') then
      raise exception 'appointment_unavailable' using errcode = 'P0001';
    end if;
    v_client := coalesce(v_client, v_appt_row.client_id);
  end if;
  if v_client is not null and not exists (
    select 1 from public.clients c where c.id = v_client and c.company_id = v_est.company_id and c.status = 'active'
      and private.can_see_client_row(c.company_id, c.home_establishment_id, c.id)) then
    raise exception 'client_unavailable' using errcode = 'P0001';
  end if;

  -- Lignes : prix et taux toujours issus du catalogue (jamais du navigateur), sauf ligne libre (responsables).
  if v_kind = 'deposit' then
    if v_client is null then
      raise exception 'client_required' using errcode = '22023';
    end if;
    v_unit := (p_payload ->> 'deposit_amount_cents')::bigint;
    if v_unit is null or v_unit <= 0 then
      raise exception 'invalid_amount' using errcode = '22023';
    end if;
    p_payload := jsonb_set(p_payload, '{lines}', jsonb_build_array(jsonb_build_object('kind', 'deposit', 'quantity', 1)));
    v_ticket_bp := 0;
  end if;
  if jsonb_typeof(p_payload -> 'lines') <> 'array' or jsonb_array_length(p_payload -> 'lines') = 0
     or jsonb_array_length(p_payload -> 'lines') > 50 then
    raise exception 'invalid_lines' using errcode = '22023';
  end if;
  if v_ticket_bp not between 0 and 10000 then
    raise exception 'invalid_discount' using errcode = '22023';
  end if;

  for v_line in select * from jsonb_array_elements(p_payload -> 'lines') loop
    v_pos := v_pos + 1;
    v_qty := coalesce((v_line ->> 'quantity')::integer, 1);
    if v_qty not between 1 and 99 then
      raise exception 'invalid_quantity' using errcode = '22023';
    end if;
    case v_line ->> 'kind'
      when 'service' then
        select s.name, s.price_cents, s.tax_code into v_label, v_unit, v_code
        from public.services s where s.id = (v_line ->> 'service_id')::uuid and s.company_id = v_est.company_id;
      when 'product' then
        select p.name, p.price_cents, p.tax_code into v_label, v_unit, v_code
        from public.products p where p.id = (v_line ->> 'product_id')::uuid and p.company_id = v_est.company_id and p.active;
      when 'custom' then
        if not private.has_company_role(v_est.company_id, array['owner', 'admin', 'manager']::public.company_role[]) then
          raise exception 'forbidden' using errcode = '42501';
        end if;
        v_label := left(btrim(v_line ->> 'label'), 120);
        v_unit := (v_line ->> 'unit_price_cents')::bigint;
        v_code := coalesce(v_line ->> 'tax_code', 'standard');
      when 'deposit' then
        v_label := 'Acompte';
        v_code := 'standard';
      else
        raise exception 'invalid_lines' using errcode = '22023';
    end case;
    if v_label is null or v_unit is null or v_unit < 0 then
      raise exception 'invalid_lines' using errcode = '22023';
    end if;
    v_rate := private.tax_rate_for(v_est.company_id, v_profile.country_code, v_code, v_today);
    if v_rate.id is null then
      raise exception 'tax_rate_missing' using errcode = 'P0001';
    end if;
    v_gross := v_unit * v_qty;
    v_line_disc := round(v_gross * coalesce((v_line ->> 'discount_bp')::integer, 0) / 10000.0)::bigint;
    if coalesce((v_line ->> 'discount_bp')::integer, 0) not between 0 and 10000 then
      raise exception 'invalid_discount' using errcode = '22023';
    end if;
    -- Remise de ticket répartie ligne par ligne (même pourcentage).
    v_line_disc := v_line_disc + round((v_gross - v_line_disc) * v_ticket_bp / 10000.0)::bigint;
    v_lines_tmp := v_lines_tmp || jsonb_build_object(
      'position', v_pos, 'kind', v_line ->> 'kind', 'service_id', v_line ->> 'service_id', 'product_id', v_line ->> 'product_id',
      'staff_id', v_line ->> 'staff_id', 'label', v_label, 'quantity', v_qty, 'unit', v_unit, 'discount', v_line_disc,
      'rate', v_rate.rate_bp, 'total', v_gross - v_line_disc,
      'tax', round((v_gross - v_line_disc) * v_rate.rate_bp / (10000.0 + v_rate.rate_bp))::bigint);
    v_subtotal := v_subtotal + v_gross;
    v_discount := v_discount + v_line_disc;
  end loop;

  -- Plafonds de remise par rôle (D5) ; au-delà, code d'approbation d'un responsable.
  if v_discount > 0 then
    if nullif(btrim(p_payload ->> 'discount_reason'), '') is null then
      raise exception 'discount_reason_required' using errcode = '22023';
    end if;
    v_eff_bp := ceil(v_discount * 10000.0 / greatest(v_subtotal, 1))::integer;
    v_cap := case
      when private.is_company_admin(v_est.company_id) then 10000
      when private.has_company_role(v_est.company_id, array['manager']::public.company_role[])
        then (select c.discount_cap_manager_bp from public.companies c where c.id = v_est.company_id)
      else (select c.discount_cap_staff_bp from public.companies c where c.id = v_est.company_id) end;
    if v_eff_bp > v_cap then
      if (select count(*) from public.discount_code_failures f where f.user_id = v_user and f.failed_at > now() - interval '15 minutes') >= 5 then
        raise exception 'too_many_attempts' using errcode = 'P0001';
      end if;
      select * into v_approval from public.discount_approvals a
      where a.code_hash = sha256(convert_to(v_est.id::text || ':' || coalesce(p_payload ->> 'approval_code', ''), 'UTF8'))
        and a.establishment_id = v_est.id and a.used_at is null and a.expires_at > now() and a.max_bp >= v_eff_bp
      for update;
      if not found then
        -- Pas d'exception ici : l'échec doit être conservé (limitation des essais).
        if nullif(p_payload ->> 'approval_code', '') is not null then
          insert into public.discount_code_failures (user_id) values (v_user);
        end if;
        return jsonb_build_object('error', 'discount_approval_required', 'required_bp', v_eff_bp);
      end if;
    end if;
  end if;

  -- Acomptes à imputer (même client, non encore imputés, non remboursés).
  for v_dep in
    select s.* from public.sales s
    where s.id in (select (jsonb_array_elements_text(coalesce(p_payload -> 'deposit_ids', '[]'))) :: uuid)
    for update
  loop
    if v_dep.kind <> 'deposit' or v_dep.company_id <> v_est.company_id or v_dep.client_id is distinct from v_client
       or exists (select 1 from public.deposit_applications d where d.deposit_sale_id = v_dep.id)
       or exists (select 1 from public.sales c where c.original_sale_id = v_dep.id) then
      raise exception 'deposit_unavailable' using errcode = 'P0001';
    end if;
    v_pos := v_pos + 1;
    v_lines_tmp := v_lines_tmp || jsonb_build_object(
      'position', v_pos, 'kind', 'deposit_applied', 'ref_sale_id', v_dep.id, 'label', 'Acompte ' || v_dep.document_no,
      'quantity', 1, 'unit', -v_dep.total_cents, 'discount', 0,
      'rate', (select max(l.tax_rate_bp) from public.sale_lines l where l.sale_id = v_dep.id),
      'total', -v_dep.total_cents, 'tax', -v_dep.tax_cents);
  end loop;

  select coalesce(sum((x ->> 'total')::bigint), 0), coalesce(sum((x ->> 'tax')::bigint), 0) into v_total, v_tax
  from jsonb_array_elements(v_lines_tmp) x;
  if v_total < 0 then
    raise exception 'deposit_exceeds_total' using errcode = 'P0001';
  end if;

  -- Paiements : Σ = total ; rendu monnaie uniquement en espèces.
  for v_pay in select * from jsonb_array_elements(coalesce(p_payload -> 'payments', '[]')) loop
    select * into v_method from public.payment_methods m
    where m.id = (v_pay ->> 'method_id')::uuid and m.company_id = v_est.company_id and m.active;
    v_amount := (v_pay ->> 'amount_cents')::bigint;
    if v_method.id is null or v_amount is null or v_amount <= 0 then
      raise exception 'invalid_payment' using errcode = '22023';
    end if;
    if (v_pay ->> 'external_ref') ~ '[0-9]{12,}' then
      raise exception 'card_number_forbidden' using errcode = '22023';
    end if;
    v_tendered := coalesce((v_pay ->> 'tendered_cents')::bigint, v_amount);
    if v_tendered < v_amount or (v_method.kind <> 'cash' and v_tendered <> v_amount) then
      raise exception 'invalid_payment' using errcode = '22023';
    end if;
    v_paid := v_paid + v_amount;
    v_change_total := v_change_total + (v_tendered - v_amount);
  end loop;
  if v_paid <> v_total then
    raise exception 'payment_mismatch' using errcode = 'P0001';
  end if;

  -- Validation atomique : verrou de chaîne, numéro continu, insertions, empreinte.
  begin
    v_head := private.lock_chain_head(v_est.id);
    v_series := case v_kind when 'deposit' then 'D' else 'T' end;
    v_number := private.next_number(v_est.id, v_series, v_year);
    v_doc := v_series || '-' || v_year || '-' || lpad(v_number::text, 6, '0');

    insert into public.sales (id, company_id, establishment_id, register_session_id, kind, series, year, number, document_no,
      client_id, appointment_id, currency, subtotal_cents, discount_cents, total_cents, tax_cents, net_cents,
      discount_reason, discount_approved_by, fiscal_mode, idempotency_key, created_by)
    values (v_sale_id, v_est.company_id, v_est.id, v_session.id, v_kind, v_series, v_year, v_number, v_doc,
      v_client, v_appt, v_profile.currency, v_subtotal, v_discount, v_total, v_tax, v_total - v_tax,
      nullif(btrim(p_payload ->> 'discount_reason'), ''), v_approval.approver_id, v_profile.fiscal_mode, v_key, v_user);
  exception when unique_violation then
    -- Demande concurrente avec la même clé : on renvoie le ticket déjà validé.
    select * into v_existing from public.sales s where s.company_id = v_est.company_id and s.idempotency_key = v_key;
    if found then
      return jsonb_build_object('sale_id', v_existing.id, 'document_no', v_existing.document_no,
                                'total_cents', v_existing.total_cents, 'replayed', true);
    end if;
    raise exception 'appointment_already_paid' using errcode = 'P0001';
  end;

  insert into public.sale_lines (sale_id, company_id, position, kind, service_id, product_id, ref_sale_id, staff_id, label,
    quantity, unit_price_cents, discount_cents, tax_rate_bp, total_cents, tax_cents, net_cents)
  select v_sale_id, v_est.company_id, (x ->> 'position')::smallint, (x ->> 'kind')::public.sale_line_kind,
         nullif(x ->> 'service_id', '')::uuid, nullif(x ->> 'product_id', '')::uuid, nullif(x ->> 'ref_sale_id', '')::uuid,
         nullif(x ->> 'staff_id', '')::uuid, x ->> 'label', (x ->> 'quantity')::integer, (x ->> 'unit')::bigint,
         (x ->> 'discount')::bigint, coalesce((x ->> 'rate')::integer, 0), (x ->> 'total')::bigint, (x ->> 'tax')::bigint,
         (x ->> 'total')::bigint - (x ->> 'tax')::bigint
  from jsonb_array_elements(v_lines_tmp) x;

  for v_pay in select * from jsonb_array_elements(coalesce(p_payload -> 'payments', '[]')) loop
    select * into v_method from public.payment_methods m where m.id = (v_pay ->> 'method_id')::uuid;
    v_amount := (v_pay ->> 'amount_cents')::bigint;
    v_tendered := coalesce((v_pay ->> 'tendered_cents')::bigint, v_amount);
    insert into public.sale_payments (sale_id, company_id, payment_method_id, method_kind, method_label, amount_cents,
      tendered_cents, change_cents, external_ref)
    values (v_sale_id, v_est.company_id, v_method.id, v_method.kind, v_method.label, v_amount,
      case when v_method.kind = 'cash' then v_tendered end, v_tendered - v_amount, nullif(btrim(v_pay ->> 'external_ref'), ''));
  end loop;

  insert into public.deposit_applications (deposit_sale_id, sale_id, company_id)
  select (x ->> 'ref_sale_id')::uuid, v_sale_id, v_est.company_id from jsonb_array_elements(v_lines_tmp) x
  where x ->> 'kind' = 'deposit_applied';

  if v_approval.id is not null then
    update public.discount_approvals a set used_at = now(), used_in_sale_id = v_sale_id where a.id = v_approval.id;
  end if;
  if v_appt is not null and v_appt_row.status = 'booked' then
    update public.appointments a set status = 'completed', version = a.version + 1 where a.id = v_appt;
  end if;

  perform private.seal_sale(v_sale_id, v_est.id, v_head.last_hash);
  perform private.journal(v_est.company_id, v_est.id, 'sale.completed', v_sale_id,
    jsonb_build_object('document_no', v_doc, 'kind', v_kind, 'total_cents', v_total, 'discount_cents', v_discount));

  return jsonb_build_object('sale_id', v_sale_id, 'document_no', v_doc, 'total_cents', v_total,
                            'change_cents', v_change_total, 'replayed', false);
end;
$$;

-- --- Avoirs / remboursements ---------------------------------------------------------------------
-- p_payload : { original_sale_id, session_id, idempotency_key, reason,
--               lines?: [{line_id, quantity}] (absent = tout le restant), payments: [{method_id, amount_cents}] }
create or replace function private.refund_sale(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_orig public.sales%rowtype;
  v_session public.register_sessions%rowtype;
  v_key uuid := (p_payload ->> 'idempotency_key')::uuid;
  v_existing public.sales%rowtype;
  v_req jsonb;
  v_line public.sale_lines%rowtype;
  v_qty integer;
  v_remaining integer;
  v_lines_tmp jsonb := '[]';
  v_pos smallint := 0;
  v_total bigint;
  v_tax bigint;
  v_pay jsonb;
  v_method public.payment_methods%rowtype;
  v_paid bigint := 0;
  v_head public.fiscal_chain_heads%rowtype;
  v_number integer;
  v_doc text;
  v_year integer;
  v_id uuid := gen_random_uuid();
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if v_key is null or nullif(btrim(p_payload ->> 'reason'), '') is null then
    raise exception 'refund_reason_required' using errcode = '22023';
  end if;
  -- Verrou du ticket d'origine : les remboursements concurrents sont sérialisés.
  select * into v_orig from public.sales s where s.id = (p_payload ->> 'original_sale_id')::uuid for update;
  if not found or not private.can_in_establishment(v_orig.establishment_id, 'refund.issue') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_existing from public.sales s where s.company_id = v_orig.company_id and s.idempotency_key = v_key;
  if found then
    return jsonb_build_object('sale_id', v_existing.id, 'document_no', v_existing.document_no, 'total_cents', v_existing.total_cents, 'replayed', true);
  end if;
  if v_orig.kind = 'credit_note' then
    raise exception 'not_refundable' using errcode = 'P0001';
  end if;
  if v_orig.kind = 'deposit' and exists (select 1 from public.deposit_applications d where d.deposit_sale_id = v_orig.id) then
    raise exception 'deposit_already_applied' using errcode = 'P0001';
  end if;
  select * into v_session from public.register_sessions s where s.id = (p_payload ->> 'session_id')::uuid for share;
  if not found or v_session.establishment_id <> v_orig.establishment_id or v_session.status <> 'open' then
    raise exception 'register_closed' using errcode = 'P0001';
  end if;

  for v_line in select * from public.sale_lines l where l.sale_id = v_orig.id and l.kind <> 'deposit_applied' order by l.position loop
    v_remaining := v_line.quantity - coalesce((select -sum(c.quantity) from public.sale_lines c where c.original_line_id = v_line.id), 0);
    if p_payload ? 'lines' and jsonb_typeof(p_payload -> 'lines') = 'array' and jsonb_array_length(p_payload -> 'lines') > 0 then
      select (x ->> 'quantity')::integer into v_qty from jsonb_array_elements(p_payload -> 'lines') x where (x ->> 'line_id')::uuid = v_line.id;
      v_qty := coalesce(v_qty, 0);
    else
      v_qty := v_remaining;
    end if;
    continue when v_qty = 0;
    if v_qty < 0 or v_qty > v_remaining then
      raise exception 'refund_exceeds_remaining' using errcode = 'P0001';
    end if;
    v_pos := v_pos + 1;
    v_lines_tmp := v_lines_tmp || jsonb_build_object(
      'position', v_pos, 'kind', v_line.kind, 'service_id', v_line.service_id, 'product_id', v_line.product_id,
      'staff_id', v_line.staff_id, 'original_line_id', v_line.id, 'label', v_line.label, 'quantity', -v_qty,
      'unit', v_line.unit_price_cents, 'discount', -round(v_line.discount_cents * v_qty / v_line.quantity::numeric)::bigint,
      'rate', v_line.tax_rate_bp,
      'total', -round(v_line.total_cents * v_qty / v_line.quantity::numeric)::bigint,
      'tax', -round(v_line.tax_cents * v_qty / v_line.quantity::numeric)::bigint);
  end loop;
  if v_pos = 0 then
    raise exception 'refund_exceeds_remaining' using errcode = 'P0001';
  end if;
  select sum((x ->> 'total')::bigint), sum((x ->> 'tax')::bigint) into v_total, v_tax from jsonb_array_elements(v_lines_tmp) x;

  for v_pay in select * from jsonb_array_elements(coalesce(p_payload -> 'payments', '[]')) loop
    select * into v_method from public.payment_methods m where m.id = (v_pay ->> 'method_id')::uuid and m.company_id = v_orig.company_id and m.active;
    if v_method.id is null or (v_pay ->> 'amount_cents')::bigint <= 0 then
      raise exception 'invalid_payment' using errcode = '22023';
    end if;
    v_paid := v_paid + (v_pay ->> 'amount_cents')::bigint;
  end loop;
  if v_paid <> -v_total then
    raise exception 'payment_mismatch' using errcode = 'P0001';
  end if;

  v_year := extract(year from private.local_date(v_orig.establishment_id, now()))::integer;
  v_head := private.lock_chain_head(v_orig.establishment_id);
  v_number := private.next_number(v_orig.establishment_id, 'A', v_year);
  v_doc := 'A-' || v_year || '-' || lpad(v_number::text, 6, '0');
  insert into public.sales (id, company_id, establishment_id, register_session_id, kind, series, year, number, document_no,
    client_id, original_sale_id, currency, subtotal_cents, discount_cents, total_cents, tax_cents, net_cents,
    refund_reason, fiscal_mode, idempotency_key, created_by)
  values (v_id, v_orig.company_id, v_orig.establishment_id, v_session.id, 'credit_note', 'A', v_year, v_number, v_doc,
    v_orig.client_id, v_orig.id, v_orig.currency,
    (select sum((x ->> 'unit')::bigint * (x ->> 'quantity')::integer) from jsonb_array_elements(v_lines_tmp) x),
    (select sum((x ->> 'discount')::bigint) from jsonb_array_elements(v_lines_tmp) x),
    v_total, v_tax, v_total - v_tax, btrim(p_payload ->> 'reason'),
    (select f.fiscal_mode from public.fiscal_profiles f where f.establishment_id = v_orig.establishment_id), v_key, v_user);
  insert into public.sale_lines (sale_id, company_id, position, kind, service_id, product_id, original_line_id, staff_id, label,
    quantity, unit_price_cents, discount_cents, tax_rate_bp, total_cents, tax_cents, net_cents)
  select v_id, v_orig.company_id, (x ->> 'position')::smallint, (x ->> 'kind')::public.sale_line_kind,
         nullif(x ->> 'service_id', '')::uuid, nullif(x ->> 'product_id', '')::uuid, (x ->> 'original_line_id')::uuid,
         nullif(x ->> 'staff_id', '')::uuid, x ->> 'label', (x ->> 'quantity')::integer, (x ->> 'unit')::bigint,
         (x ->> 'discount')::bigint, (x ->> 'rate')::integer, (x ->> 'total')::bigint, (x ->> 'tax')::bigint,
         (x ->> 'total')::bigint - (x ->> 'tax')::bigint
  from jsonb_array_elements(v_lines_tmp) x;
  insert into public.sale_payments (sale_id, company_id, payment_method_id, method_kind, method_label, amount_cents)
  select v_id, v_orig.company_id, m.id, m.kind, m.label, -(x ->> 'amount_cents')::bigint
  from jsonb_array_elements(p_payload -> 'payments') x join public.payment_methods m on m.id = (x ->> 'method_id')::uuid;

  perform private.seal_sale(v_id, v_orig.establishment_id, v_head.last_hash);
  perform private.journal(v_orig.company_id, v_orig.establishment_id, 'credit_note.completed', v_id,
    jsonb_build_object('document_no', v_doc, 'original', v_orig.document_no, 'total_cents', v_total));
  return jsonb_build_object('sale_id', v_id, 'document_no', v_doc, 'total_cents', v_total, 'replayed', false);
end;
$$;

-- --- Vérification de l'intégrité de la chaîne ---------------------------------------------------------
create or replace function private.verify_fiscal_chain(p_establishment_id uuid)
returns table (documents bigint, first_broken text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_prev text := 'GENESIS';
  v_count bigint := 0;
  r record;
begin
  if not private.can_in_establishment(p_establishment_id, 'reports.read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  for r in select s.id, s.document_no, s.prev_hash, s.hash from public.sales s
           where s.establishment_id = p_establishment_id order by s.completed_at, s.id loop
    v_count := v_count + 1;
    if r.prev_hash is distinct from v_prev or r.hash is distinct from private.sale_digest(r.id, v_prev) then
      return query select v_count, r.document_no;
      return;
    end if;
    v_prev := r.hash;
  end loop;
  return query select v_count, null::text;
end;
$$;

-- --- RLS : lecture seule, écritures exclusivement par RPC ----------------------------------------------
alter table public.cash_registers enable row level security;
alter table public.register_sessions enable row level security;
alter table public.cash_movements enable row level security;
alter table public.document_counters enable row level security;
alter table public.fiscal_chain_heads enable row level security;
alter table public.fiscal_journal enable row level security;
alter table public.sales enable row level security;
alter table public.sale_lines enable row level security;
alter table public.sale_payments enable row level security;
alter table public.deposit_applications enable row level security;
alter table public.discount_approvals enable row level security;
alter table public.discount_code_failures enable row level security;

revoke all on public.cash_registers, public.register_sessions, public.cash_movements, public.document_counters,
  public.fiscal_chain_heads, public.fiscal_journal, public.sales, public.sale_lines, public.sale_payments,
  public.deposit_applications, public.discount_approvals, public.discount_code_failures
  from public, anon, authenticated;
revoke all on sequence public.fiscal_journal_id_seq from public, anon, authenticated;

grant select on public.cash_registers, public.register_sessions, public.cash_movements, public.sales,
  public.sale_lines, public.sale_payments, public.deposit_applications, public.fiscal_journal to authenticated;
grant insert (company_id, establishment_id, name) on public.cash_registers to authenticated;
grant update (name, active) on public.cash_registers to authenticated;

create policy cash_registers_select on public.cash_registers for select to authenticated
  using (private.can_access_establishment(establishment_id));
create policy cash_registers_insert on public.cash_registers for insert to authenticated
  with check (private.can_in_establishment(establishment_id, 'settings.fiscal'));
create policy cash_registers_update on public.cash_registers for update to authenticated
  using (private.can_in_establishment(establishment_id, 'settings.fiscal'))
  with check (private.can_in_establishment(establishment_id, 'settings.fiscal'));
create policy register_sessions_select on public.register_sessions for select to authenticated
  using (private.can_in_establishment(establishment_id, 'register.operate'));
create policy cash_movements_select on public.cash_movements for select to authenticated
  using (exists (select 1 from public.register_sessions s where s.id = session_id
                 and private.can_in_establishment(s.establishment_id, 'register.operate')));
create policy sales_select on public.sales for select to authenticated
  using (private.can_see_sale_row(company_id, establishment_id, created_by));
create policy sale_lines_select on public.sale_lines for select to authenticated
  using (private.can_see_sale(sale_id));
create policy sale_payments_select on public.sale_payments for select to authenticated
  using (private.can_see_sale(sale_id));
create policy deposit_applications_select on public.deposit_applications for select to authenticated
  using (private.can_see_sale(sale_id));
create policy fiscal_journal_select on public.fiscal_journal for select to authenticated
  using (private.can_in_establishment(establishment_id, 'reports.read'));

-- --- Fonctions exposées (SECURITY INVOKER) ------------------------------------------------------------
revoke all on all functions in schema private from public, anon;
grant execute on function
  private.can_see_sale_row(uuid, uuid, uuid), private.can_see_sale(uuid),
  private.open_register(uuid, bigint, jsonb), private.add_cash_movement(uuid, text, bigint, text),
  private.create_discount_approval(uuid, integer), private.complete_sale(jsonb), private.refund_sale(jsonb),
  private.verify_fiscal_chain(uuid)
to authenticated;

create function public.open_register(p_register_id uuid, p_opening_float_cents bigint, p_count jsonb default null)
returns uuid language sql security invoker set search_path = ''
as $$ select private.open_register(p_register_id, p_opening_float_cents, p_count); $$;
create function public.add_cash_movement(p_session_id uuid, p_direction text, p_amount_cents bigint, p_reason text)
returns uuid language sql security invoker set search_path = ''
as $$ select private.add_cash_movement(p_session_id, p_direction, p_amount_cents, p_reason); $$;
create function public.create_discount_approval(p_establishment_id uuid, p_max_bp integer)
returns table (code text, expires_at timestamptz) language sql security invoker set search_path = ''
as $$ select * from private.create_discount_approval(p_establishment_id, p_max_bp); $$;
create function public.complete_sale(p_payload jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.complete_sale(p_payload); $$;
create function public.refund_sale(p_payload jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.refund_sale(p_payload); $$;
create function public.verify_fiscal_chain(p_establishment_id uuid)
returns table (documents bigint, first_broken text) language sql stable security invoker set search_path = ''
as $$ select * from private.verify_fiscal_chain(p_establishment_id); $$;

revoke all on function
  public.open_register(uuid, bigint, jsonb), public.add_cash_movement(uuid, text, bigint, text),
  public.create_discount_approval(uuid, integer), public.complete_sale(jsonb), public.refund_sale(jsonb),
  public.verify_fiscal_chain(uuid)
from public, anon;
grant execute on function
  public.open_register(uuid, bigint, jsonb), public.add_cash_movement(uuid, text, bigint, text),
  public.create_discount_approval(uuid, integer), public.complete_sale(jsonb), public.refund_sale(jsonb),
  public.verify_fiscal_chain(uuid)
to authenticated;
