-- =============================================================================
-- SOLUSSIMO — Migration 019 : factures, clôtures, documents, rapports, exports (V0.5)
--  · factures nominatives (série F) avec instantané de l'acheteur (obligation légale)
--  · clôture de session (ticket Z) : comptage, écart justifié, totaux figés, chaînés
--  · clôtures mensuelles / annuelles, grand total perpétuel
--  · données de reçu / facture (PDF), réimpressions journalisées (« DUPLICATA »)
--  · rapports (le collaborateur ne voit que ses ventes) et exports CSV / FEC
--  · contrôle d'intégrité global (ventes, clôtures, journal)
-- =============================================================================

alter table public.fiscal_chain_heads add column last_closure_hash text not null default 'GENESIS';

-- --- Factures ---------------------------------------------------------------------------------
create table public.invoices (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  establishment_id uuid not null references public.establishments (id),
  sale_id          uuid not null unique references public.sales (id),
  series           text not null default 'F',
  year             integer not null,
  number           integer not null,
  document_no      text not null,
  -- Instantané de l'acheteur : conservé au titre de l'obligation comptable, même si la fiche est effacée.
  buyer            jsonb not null,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default clock_timestamp(),
  hash             text not null,
  unique (establishment_id, series, year, number)
);
create index invoices_company_idx on public.invoices (company_id);
create index invoices_created_by_idx on public.invoices (created_by);
create trigger invoices_immutable before update or delete on public.invoices
  for each row execute function private.forbid_fiscal_change();

-- --- Clôtures ---------------------------------------------------------------------------------
create table public.closures (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  establishment_id  uuid not null references public.establishments (id),
  kind              text not null check (kind in ('z', 'month', 'year')),
  session_id        uuid unique references public.register_sessions (id),
  period_start      date not null,
  period_end        date not null,
  number            integer not null,
  document_no       text not null,
  currency          text not null,
  totals            jsonb not null,
  total_cents       bigint not null,
  tax_cents         bigint not null,
  grand_total_cents bigint not null,  -- grand total perpétuel (par type de clôture)
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default clock_timestamp(),
  prev_hash         text not null,
  hash              text not null,
  check ((kind = 'z') = (session_id is not null))
);
create unique index closures_period_uidx on public.closures (establishment_id, kind, period_start) where kind <> 'z';
create index closures_establishment_idx on public.closures (establishment_id, created_at);
create index closures_company_idx on public.closures (company_id);
create index closures_created_by_idx on public.closures (created_by);
create trigger closures_immutable before update or delete on public.closures
  for each row execute function private.forbid_fiscal_change();

-- --- Plan de comptes (FEC) : paramétrable, à valider par l'expert-comptable ----------------------------
create table public.accounting_accounts (
  company_id uuid not null references public.companies (id) on delete cascade,
  key        text not null check (key ~ '^[a-z_]{2,40}$'),
  account    text not null check (account ~ '^[0-9A-Z]{2,20}$'),
  label      text not null check (char_length(label) between 1 and 80),
  primary key (company_id, key)
);

create or replace function private.seed_accounting_defaults(p_company_id uuid)
returns void language sql security definer set search_path = ''
as $$
  insert into public.accounting_accounts (company_id, key, account, label) values
    (p_company_id, 'revenue_service', '706000', 'Prestations de services'),
    (p_company_id, 'revenue_product', '707000', 'Ventes de marchandises'),
    (p_company_id, 'revenue_custom',  '708000', 'Produits des activités annexes'),
    (p_company_id, 'deposit',         '419100', 'Clients - avances et acomptes reçus'),
    (p_company_id, 'vat_collected',   '445710', 'TVA collectée'),
    (p_company_id, 'pay_cash',        '530000', 'Caisse'),
    (p_company_id, 'pay_card',        '511500', 'Cartes bancaires à encaisser'),
    (p_company_id, 'pay_cheque',      '511200', 'Chèques à encaisser'),
    (p_company_id, 'pay_transfer',    '512000', 'Banque'),
    (p_company_id, 'pay_local',       '511800', 'Autres moyens de paiement')
  on conflict do nothing;
$$;
create or replace function private.company_accounting_defaults()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin perform private.seed_accounting_defaults(new.id); return null; end; $$;
create trigger companies_accounting_defaults after insert on public.companies
  for each row execute function private.company_accounting_defaults();
do $$ begin perform private.seed_accounting_defaults(c.id) from public.companies c; end $$;

create table public.export_batches (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  establishment_id uuid not null references public.establishments (id) on delete cascade,
  format           text not null check (format in ('csv', 'fec')),
  period_start     date not null,
  period_end       date not null,
  rows             integer not null,
  sha256           text not null,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index export_batches_company_idx on public.export_batches (company_id);
create index export_batches_establishment_idx on public.export_batches (establishment_id);
create index export_batches_created_by_idx on public.export_batches (created_by);

-- --- Changement des paramètres fiscaux : journalisé ------------------------------------------------
create or replace function private.journal_fiscal_profile_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_changed text[];
begin
  select array_agg(n.key order by n.key) into v_changed
  from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value and n.key not in ('updated_at');
  if v_changed is not null then
    perform private.journal(new.company_id, new.establishment_id, 'settings.fiscal_changed', null,
                            jsonb_build_object('fields', v_changed));
  end if;
  return null;
end;
$$;
create trigger fiscal_profiles_journal after update on public.fiscal_profiles
  for each row execute function private.journal_fiscal_profile_change();

-- --- Agrégats (communs au ticket Z, aux clôtures et aux rapports) -------------------------------------
create or replace function private.sales_totals(p_sale_ids uuid[])
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'count_sales',        (select count(*) from public.sales s where s.id = any (p_sale_ids) and s.kind = 'sale'),
    'count_deposits',     (select count(*) from public.sales s where s.id = any (p_sale_ids) and s.kind = 'deposit'),
    'count_credit_notes', (select count(*) from public.sales s where s.id = any (p_sale_ids) and s.kind = 'credit_note'),
    'total_cents',    (select coalesce(sum(s.total_cents), 0) from public.sales s where s.id = any (p_sale_ids)),
    'tax_cents',      (select coalesce(sum(s.tax_cents), 0) from public.sales s where s.id = any (p_sale_ids)),
    'net_cents',      (select coalesce(sum(s.net_cents), 0) from public.sales s where s.id = any (p_sale_ids)),
    'discount_cents', (select coalesce(sum(s.discount_cents), 0) from public.sales s where s.id = any (p_sale_ids)),
    'refunds_cents',  (select coalesce(sum(s.total_cents), 0) from public.sales s where s.id = any (p_sale_ids) and s.kind = 'credit_note'),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('kind', m.method_kind, 'label', m.method_label, 'amount_cents', m.amount) order by m.method_label)
                  from (select p.method_kind, p.method_label, sum(p.amount_cents) as amount from public.sale_payments p
                        where p.sale_id = any (p_sale_ids) group by 1, 2) m), '[]'),
    'by_rate', coalesce((select jsonb_agg(jsonb_build_object('rate_bp', r.rate, 'net_cents', r.net, 'tax_cents', r.tax, 'total_cents', r.total) order by r.rate)
                  from (select l.tax_rate_bp as rate, sum(l.net_cents) as net, sum(l.tax_cents) as tax, sum(l.total_cents) as total
                        from public.sale_lines l where l.sale_id = any (p_sale_ids) group by 1) r), '[]'));
$$;

create or replace function private.closure_digest(p_prev text, p_doc text, p_kind text, p_start date, p_end date, p_total bigint,
                                                  p_tax bigint, p_grand bigint, p_totals jsonb, p_at timestamptz)
returns text language sql immutable set search_path = ''
as $$
  select encode(sha256(convert_to(concat_ws('|', p_prev, p_doc, p_kind, p_start, p_end, p_total, p_tax, p_grand, p_totals::text,
                                            to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')), 'UTF8')), 'hex');
$$;

-- Insère une clôture chaînée (le verrou de tête de chaîne est pris par l'appelant).
create or replace function private.insert_closure(p_est public.establishments, p_kind text, p_session uuid, p_start date, p_end date,
                                                  p_totals jsonb, p_prev text)
returns public.closures language plpgsql security definer set search_path = ''
as $$
declare
  v_c public.closures%rowtype;
  v_series text := case p_kind when 'z' then 'Z' when 'month' then 'ZM' else 'ZA' end;
begin
  v_c.id := gen_random_uuid();
  v_c.number := private.next_number(p_est.id, v_series, extract(year from p_end)::integer);
  v_c.document_no := v_series || '-' || extract(year from p_end)::integer || '-' || lpad(v_c.number::text, 6, '0');
  v_c.total_cents := (p_totals ->> 'total_cents')::bigint;
  v_c.tax_cents := (p_totals ->> 'tax_cents')::bigint;
  v_c.grand_total_cents := v_c.total_cents + coalesce((select c.grand_total_cents from public.closures c
    where c.establishment_id = p_est.id and c.kind = p_kind order by c.created_at desc limit 1), 0);
  v_c.created_at := clock_timestamp();
  v_c.hash := private.closure_digest(p_prev, v_c.document_no, p_kind, p_start, p_end, v_c.total_cents, v_c.tax_cents,
                                     v_c.grand_total_cents, p_totals, v_c.created_at);
  insert into public.closures (id, company_id, establishment_id, kind, session_id, period_start, period_end, number, document_no,
    currency, totals, total_cents, tax_cents, grand_total_cents, created_by, created_at, prev_hash, hash)
  values (v_c.id, p_est.company_id, p_est.id, p_kind, p_session, p_start, p_end, v_c.number, v_c.document_no,
    (select f.currency from public.fiscal_profiles f where f.establishment_id = p_est.id), p_totals, v_c.total_cents, v_c.tax_cents,
    v_c.grand_total_cents, (select auth.uid()), v_c.created_at, p_prev, v_c.hash)
  returning * into v_c;
  update public.fiscal_chain_heads h set last_closure_hash = v_c.hash where h.establishment_id = p_est.id;
  perform private.journal(p_est.company_id, p_est.id, 'closure.' || p_kind, v_c.id,
    jsonb_build_object('document_no', v_c.document_no, 'total_cents', v_c.total_cents, 'grand_total_cents', v_c.grand_total_cents));
  return v_c;
end;
$$;

-- --- Clôture de session : ticket Z ----------------------------------------------------------------
create or replace function private.close_register(p_session_id uuid, p_counted_cash_cents bigint, p_count jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_s public.register_sessions%rowtype;
  v_est public.establishments%rowtype;
  v_head public.fiscal_chain_heads%rowtype;
  v_ids uuid[];
  v_totals jsonb;
  v_cash_sales bigint;
  v_in bigint;
  v_out bigint;
  v_expected bigint;
  v_diff bigint;
  v_closure public.closures%rowtype;
begin
  select * into v_s from public.register_sessions s where s.id = p_session_id;
  if not found or not private.can_in_establishment(v_s.establishment_id, 'register.operate') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- D6 : le collaborateur ne clôture que la session qu'il a ouverte.
  if v_s.opened_by is distinct from (select auth.uid()) and not private.can_in_establishment(v_s.establishment_id, 'reports.read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_counted_cash_cents is null or p_counted_cash_cents < 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  select * into v_est from public.establishments e where e.id = v_s.establishment_id;
  -- Même ordre de verrouillage que l'encaissement (session, puis tête de chaîne) : aucun interblocage,
  -- et les encaissements en cours sont terminés avant le calcul du Z.
  select * into v_s from public.register_sessions s where s.id = p_session_id for update;
  v_head := private.lock_chain_head(v_est.id);
  if v_s.status <> 'open' then
    raise exception 'register_closed' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(s.id), '{}') into v_ids from public.sales s where s.register_session_id = v_s.id;
  select coalesce(sum(p.amount_cents), 0) into v_cash_sales from public.sale_payments p
  where p.sale_id = any (v_ids) and p.method_kind = 'cash';
  select coalesce(sum(m.amount_cents) filter (where m.direction = 'in'), 0), coalesce(sum(m.amount_cents) filter (where m.direction = 'out'), 0)
  into v_in, v_out from public.cash_movements m where m.session_id = v_s.id;
  v_expected := v_s.opening_float_cents + v_cash_sales + v_in - v_out;
  v_diff := p_counted_cash_cents - v_expected;
  if v_diff <> 0 and nullif(btrim(p_reason), '') is null then
    raise exception 'difference_reason_required' using errcode = '22023';
  end if;

  v_totals := private.sales_totals(v_ids) || jsonb_build_object('cash', jsonb_build_object(
    'opening_float_cents', v_s.opening_float_cents, 'cash_sales_cents', v_cash_sales, 'movements_in_cents', v_in,
    'movements_out_cents', v_out, 'expected_cents', v_expected, 'counted_cents', p_counted_cash_cents, 'difference_cents', v_diff),
    'opened_at', v_s.opened_at, 'closed_at', now());

  update public.register_sessions s set status = 'closed', closed_at = now(), closed_by = (select auth.uid()),
    counted_cash_cents = p_counted_cash_cents, closing_count = p_count, expected_cash_cents = v_expected,
    difference_cents = v_diff, difference_reason = nullif(btrim(p_reason), '')
  where s.id = v_s.id;

  v_closure := private.insert_closure(v_est, 'z', v_s.id, private.local_date(v_est.id, v_s.opened_at),
                                      private.local_date(v_est.id, now()), v_totals, v_head.last_closure_hash);
  return jsonb_build_object('closure_id', v_closure.id, 'document_no', v_closure.document_no, 'expected_cents', v_expected,
                            'difference_cents', v_diff, 'totals', v_totals);
end;
$$;

-- --- Clôture mensuelle / annuelle ------------------------------------------------------------------
create or replace function private.close_period(p_establishment_id uuid, p_kind text, p_period_start date)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_est public.establishments%rowtype;
  v_head public.fiscal_chain_heads%rowtype;
  v_start date;
  v_end date;
  v_ids uuid[];
  v_totals jsonb;
  v_closure public.closures%rowtype;
begin
  select * into v_est from public.establishments e where e.id = p_establishment_id;
  if not found or not private.can_in_establishment(p_establishment_id, 'reports.read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind not in ('month', 'year') then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  v_start := date_trunc(p_kind, p_period_start)::date;
  v_end := (date_trunc(p_kind, p_period_start) + ('1 ' || p_kind)::interval - interval '1 day')::date;
  if v_end >= private.local_date(v_est.id, now()) then
    raise exception 'period_not_ended' using errcode = 'P0001';
  end if;
  v_head := private.lock_chain_head(v_est.id);
  if exists (select 1 from public.register_sessions s where s.establishment_id = v_est.id and s.status = 'open'
             and private.local_date(v_est.id, s.opened_at) <= v_end) then
    raise exception 'open_sessions_in_period' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.closures c where c.establishment_id = v_est.id and c.kind = p_kind and c.period_start = v_start) then
    raise exception 'period_already_closed' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(s.id), '{}') into v_ids from public.sales s
  where s.establishment_id = v_est.id and private.local_date(v_est.id, s.completed_at) between v_start and v_end;
  v_totals := private.sales_totals(v_ids);
  v_closure := private.insert_closure(v_est, p_kind, null, v_start, v_end, v_totals, v_head.last_closure_hash);
  return jsonb_build_object('closure_id', v_closure.id, 'document_no', v_closure.document_no, 'totals', v_totals,
                            'grand_total_cents', v_closure.grand_total_cents);
end;
$$;

-- --- Facture nominative ---------------------------------------------------------------------------
-- p_buyer : { name, address?, vat_number?, tax_id? } — aucun champ hors liste.
create or replace function private.issue_invoice(p_sale_id uuid, p_buyer jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_sale public.sales%rowtype;
  v_buyer jsonb;
  v_number integer;
  v_doc text;
  v_at timestamptz;
  v_existing public.invoices%rowtype;
begin
  select * into v_sale from public.sales s where s.id = p_sale_id;
  if not found or not private.can_see_sale(p_sale_id) or not private.can_in_establishment(v_sale.establishment_id, 'register.operate') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_existing from public.invoices i where i.sale_id = p_sale_id;
  if found then
    return jsonb_build_object('invoice_id', v_existing.id, 'document_no', v_existing.document_no, 'replayed', true);
  end if;
  if jsonb_typeof(p_buyer) <> 'object' or exists (select 1 from jsonb_object_keys(p_buyer) k where k not in ('name', 'address', 'vat_number', 'tax_id'))
     or char_length(btrim(coalesce(p_buyer ->> 'name', ''))) not between 2 and 160
     or char_length(coalesce(p_buyer ->> 'address', '')) > 300
     or char_length(coalesce(p_buyer ->> 'vat_number', '')) > 40 or char_length(coalesce(p_buyer ->> 'tax_id', '')) > 40 then
    raise exception 'invalid_buyer' using errcode = '22023';
  end if;
  select jsonb_object_agg(k, btrim(v)) into v_buyer from jsonb_each_text(p_buyer) as t(k, v) where nullif(btrim(v), '') is not null;
  perform private.lock_chain_head(v_sale.establishment_id);
  v_number := private.next_number(v_sale.establishment_id, 'F', v_sale.year);
  v_doc := 'F-' || v_sale.year || '-' || lpad(v_number::text, 6, '0');
  v_at := clock_timestamp();
  begin
    insert into public.invoices (company_id, establishment_id, sale_id, year, number, document_no, buyer, created_by, created_at, hash)
    values (v_sale.company_id, v_sale.establishment_id, v_sale.id, v_sale.year, v_number, v_doc, v_buyer, (select auth.uid()), v_at,
            encode(sha256(convert_to(concat_ws('|', v_sale.hash, v_doc, v_buyer::text, to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')), 'UTF8')), 'hex'))
    returning * into v_existing;
  exception when unique_violation then
    select * into v_existing from public.invoices i where i.sale_id = p_sale_id;
    return jsonb_build_object('invoice_id', v_existing.id, 'document_no', v_existing.document_no, 'replayed', true);
  end;
  perform private.journal(v_sale.company_id, v_sale.establishment_id, 'invoice.issued', v_existing.id,
                          jsonb_build_object('document_no', v_doc, 'sale', v_sale.document_no));
  return jsonb_build_object('invoice_id', v_existing.id, 'document_no', v_doc, 'replayed', false);
end;
$$;

-- --- Données d'un document (reçu, facture, avoir, Z) pour le PDF ---------------------------------------
-- Chaque génération est journalisée ; à partir de la deuxième, le document porte la mention « DUPLICATA ».
create or replace function private.get_document(p_kind text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_sale public.sales%rowtype;
  v_cl public.closures%rowtype;
  v_est public.establishments%rowtype;
  v_profile public.fiscal_profiles%rowtype;
  v_inv public.invoices%rowtype;
  v_prints bigint;
  v_doc jsonb;
  v_ref uuid;
begin
  if p_kind in ('receipt', 'invoice') then
    select * into v_sale from public.sales s where s.id = p_id;
    if not found or not private.can_see_sale(p_id) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    select * into v_inv from public.invoices i where i.sale_id = p_id;
    if p_kind = 'invoice' and v_inv.id is null then
      raise exception 'invoice_missing' using errcode = 'P0001';
    end if;
    select * into v_est from public.establishments e where e.id = v_sale.establishment_id;
    v_ref := case when p_kind = 'invoice' then v_inv.id else v_sale.id end;
  elsif p_kind = 'closure' then
    select * into v_cl from public.closures c where c.id = p_id;
    if not found or not (private.can_in_establishment(v_cl.establishment_id, 'reports.read')
                         or exists (select 1 from public.register_sessions s where s.id = v_cl.session_id and s.opened_by = (select auth.uid()))) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    select * into v_est from public.establishments e where e.id = v_cl.establishment_id;
    v_ref := v_cl.id;
  else
    raise exception 'invalid_document' using errcode = '22023';
  end if;
  select * into v_profile from public.fiscal_profiles f where f.establishment_id = v_est.id;
  select count(*) into v_prints from public.fiscal_journal j where j.ref_id = v_ref and j.event = 'document.printed';

  v_doc := jsonb_build_object(
    'type', case when p_kind = 'closure' then 'closure' when p_kind = 'invoice' then 'invoice' else v_sale.kind::text end,
    'duplicate', v_prints > 0, 'print_count', v_prints + 1,
    'fiscal_mode', v_profile.fiscal_mode, 'country_code', v_profile.country_code, 'currency', v_profile.currency,
    'timezone', v_est.timezone,
    'seller', jsonb_build_object('establishment', v_est.name, 'city', v_est.city,
      'legal_name', coalesce(v_profile.seller_legal_name, (select c.name from public.companies c where c.id = v_est.company_id)),
      'tax_id', v_profile.seller_tax_id, 'vat_number', v_profile.seller_vat_number, 'address', v_profile.seller_address,
      'legal_mentions', v_profile.legal_mentions));

  if p_kind = 'closure' then
    v_doc := v_doc || jsonb_build_object('document_no', v_cl.document_no, 'date', v_cl.created_at, 'kind', v_cl.kind,
      'period_start', v_cl.period_start, 'period_end', v_cl.period_end, 'totals', v_cl.totals,
      'grand_total_cents', v_cl.grand_total_cents, 'hash', v_cl.hash);
  else
    v_doc := v_doc || jsonb_build_object(
      'document_no', case when p_kind = 'invoice' then v_inv.document_no else v_sale.document_no end,
      'sale_document_no', v_sale.document_no, 'date', v_sale.completed_at,
      'original_document_no', (select o.document_no from public.sales o where o.id = v_sale.original_sale_id),
      'refund_reason', v_sale.refund_reason,
      'buyer', case when p_kind = 'invoice' then v_inv.buyer end,
      'invoice_document_no', v_inv.document_no,
      'subtotal_cents', v_sale.subtotal_cents, 'discount_cents', v_sale.discount_cents, 'total_cents', v_sale.total_cents,
      'tax_cents', v_sale.tax_cents, 'net_cents', v_sale.net_cents, 'hash', v_sale.hash,
      'staff', (select string_agg(distinct m.display_name, ', ') from public.sale_lines l join public.staff_members m on m.id = l.staff_id where l.sale_id = v_sale.id),
      'lines', (select jsonb_agg(jsonb_build_object('label', l.label, 'kind', l.kind, 'quantity', l.quantity, 'unit_price_cents', l.unit_price_cents,
                  'discount_cents', l.discount_cents, 'tax_rate_bp', l.tax_rate_bp, 'total_cents', l.total_cents) order by l.position)
                from public.sale_lines l where l.sale_id = v_sale.id),
      'payments', (select coalesce(jsonb_agg(jsonb_build_object('label', p.method_label, 'kind', p.method_kind, 'amount_cents', p.amount_cents,
                  'tendered_cents', p.tendered_cents, 'change_cents', p.change_cents) order by p.received_at), '[]')
                from public.sale_payments p where p.sale_id = v_sale.id),
      'taxes', (private.sales_totals(array[v_sale.id]) -> 'by_rate'));
  end if;
  perform private.journal(v_est.company_id, v_est.id, 'document.printed', v_ref,
                          jsonb_build_object('type', p_kind, 'print_count', v_prints + 1));
  return v_doc;
end;
$$;

-- --- Rapports ---------------------------------------------------------------------------------
-- D6 : un collaborateur n'obtient que ses propres ventes ; les responsables voient tout l'établissement.
create or replace function private.sales_report(p_establishment_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_all boolean;
  v_ids uuid[];
begin
  if not private.can_in_establishment(p_establishment_id, 'register.operate') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  v_all := private.can_in_establishment(p_establishment_id, 'reports.read');
  select coalesce(array_agg(s.id), '{}') into v_ids from public.sales s
  where s.establishment_id = p_establishment_id
    and private.local_date(p_establishment_id, s.completed_at) between p_from and p_to
    and (v_all or s.created_by = (select auth.uid()));
  return private.sales_totals(v_ids) || jsonb_build_object(
    'scope', case when v_all then 'establishment' else 'own' end,
    'currency', (select f.currency from public.fiscal_profiles f where f.establishment_id = p_establishment_id),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'total_cents', d.total, 'count', d.n) order by d.day)
      from (select private.local_date(p_establishment_id, s.completed_at) as day, sum(s.total_cents) as total,
                   count(*) filter (where s.kind = 'sale') as n
            from public.sales s where s.id = any (v_ids) group by 1) d), '[]'),
    'by_staff', coalesce((select jsonb_agg(jsonb_build_object('staff_id', x.staff_id, 'name', x.name, 'total_cents', x.total) order by x.total desc)
      from (select l.staff_id, coalesce(m.display_name, '—') as name, sum(l.total_cents) as total
            from public.sale_lines l left join public.staff_members m on m.id = l.staff_id
            where l.sale_id = any (v_ids) and l.kind in ('service', 'product', 'custom') group by 1, 2) x), '[]'),
    'by_item', coalesce((select jsonb_agg(jsonb_build_object('label', x.label, 'kind', x.kind, 'quantity', x.qty, 'total_cents', x.total) order by x.total desc)
      from (select l.label, l.kind, sum(l.quantity) as qty, sum(l.total_cents) as total from public.sale_lines l
            where l.sale_id = any (v_ids) and l.kind in ('service', 'product', 'custom') group by 1, 2 limit 50) x), '[]'));
end;
$$;

-- --- Exports comptables ---------------------------------------------------------------------------------
create or replace function private.fec_amount(p_cents bigint)
returns text language sql immutable set search_path = ''
as $$ select replace(to_char(abs(p_cents) / 100.0, 'FM9999999990.00'), '.', ','); $$;

create or replace function private.export_accounting(p_establishment_id uuid, p_from date, p_to date, p_format text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_est public.establishments%rowtype;
  v_lines text[] := '{}';
  v_text text;
  v_n integer := 0;
  v_ecr integer := 0;
  r record;
  v_e record;
  v_acc jsonb;
begin
  select * into v_est from public.establishments e where e.id = p_establishment_id;
  if not found or not private.can_in_establishment(p_establishment_id, 'accounting.export') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_format not in ('csv', 'fec') or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  select jsonb_object_agg(a.key, jsonb_build_array(a.account, a.label)) into v_acc
  from public.accounting_accounts a where a.company_id = v_est.company_id;

  if p_format = 'csv' then
    -- Journal des ventes : aucune donnée personnelle (pas de nom de client).
    v_lines := array['date;document;type;origine;total_ttc;tva;total_ht;remise;devise;paiements;empreinte'];
    for r in select s.*, private.local_date(s.establishment_id, s.completed_at) as day from public.sales s
             where s.establishment_id = p_establishment_id and private.local_date(s.establishment_id, s.completed_at) between p_from and p_to
             order by s.series, s.year, s.number loop
      v_n := v_n + 1;
      v_lines := v_lines || concat_ws(';', r.day, r.document_no, r.kind, coalesce((select o.document_no from public.sales o where o.id = r.original_sale_id), ''),
        to_char(r.total_cents / 100.0, 'FM9999999990.00'), to_char(r.tax_cents / 100.0, 'FM9999999990.00'),
        to_char(r.net_cents / 100.0, 'FM9999999990.00'), to_char(r.discount_cents / 100.0, 'FM9999999990.00'), r.currency,
        (select string_agg(replace(p.method_label, ';', ',') || ' ' || to_char(p.amount_cents / 100.0, 'FM9999999990.00'), ' + ' order by p.received_at)
         from public.sale_payments p where p.sale_id = r.id), r.hash);
    end loop;
  else
    -- FEC (art. A47 A-1 du LPF) : écritures de ventes équilibrées, une écriture par pièce.
    v_lines := array['JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|CompteLib|CompAuxNum|CompAuxLib|PieceRef|PieceDate|EcritureLib|Debit|Credit|EcritureLet|DateLet|ValidDate|Montantdevise|Idevise'];
    for r in select s.*, to_char(private.local_date(s.establishment_id, s.completed_at), 'YYYYMMDD') as day from public.sales s
             where s.establishment_id = p_establishment_id and private.local_date(s.establishment_id, s.completed_at) between p_from and p_to
             order by s.completed_at, s.id loop
      v_ecr := v_ecr + 1;
      for v_e in
        -- Encaissements (débit), puis produits / acomptes et TVA (crédit). Les montants négatifs (avoirs) inversent le sens.
        select k.key, k.amount from (
          select 'pay_' || p.method_kind::text as key, p.amount_cents as amount, 1 as ord from public.sale_payments p where p.sale_id = r.id
          union all
          select case l.kind when 'service' then 'revenue_service' when 'product' then 'revenue_product' when 'custom' then 'revenue_custom' else 'deposit' end,
                 -sum(l.net_cents), 2 from public.sale_lines l where l.sale_id = r.id group by 1
          union all
          select 'vat_collected', -sum(l.tax_cents), 3 from public.sale_lines l where l.sale_id = r.id having sum(l.tax_cents) <> 0
        ) k where k.amount <> 0 order by k.ord, k.key
      loop
        v_n := v_n + 1;
        v_lines := v_lines || concat_ws('|', 'VE', 'Ventes', v_ecr, r.day, v_acc -> v_e.key ->> 0, v_acc -> v_e.key ->> 1, '', '',
          r.document_no, r.day, left(replace(r.kind::text || ' ' || r.document_no, '|', ' '), 100),
          case when v_e.amount > 0 then private.fec_amount(v_e.amount::bigint) else '0,00' end,
          case when v_e.amount < 0 then private.fec_amount(v_e.amount::bigint) else '0,00' end,
          '', '', r.day, '', '');
      end loop;
    end loop;
  end if;
  v_text := array_to_string(v_lines, E'\r\n') || E'\r\n';
  insert into public.export_batches (company_id, establishment_id, format, period_start, period_end, rows, sha256, created_by)
  values (v_est.company_id, v_est.id, p_format, p_from, p_to, v_n, encode(sha256(convert_to(v_text, 'UTF8')), 'hex'), (select auth.uid()));
  perform private.journal(v_est.company_id, v_est.id, 'export.' || p_format, null,
                          jsonb_build_object('from', p_from, 'to', p_to, 'rows', v_n));
  return jsonb_build_object('format', p_format, 'rows', v_n, 'content', v_text,
    'filename', case when p_format = 'fec'
      then coalesce(regexp_replace((select f.seller_tax_id from public.fiscal_profiles f where f.establishment_id = v_est.id), '\D', '', 'g'), 'SIREN')
           || 'FEC' || to_char(p_to, 'YYYYMMDD') || '.txt'
      else 'ventes_' || p_from || '_' || p_to || '.csv' end);
end;
$$;

-- --- Contrôle d'intégrité global ---------------------------------------------------------------------
create or replace function private.verify_integrity(p_establishment_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_prev text := 'GENESIS';
  v_n bigint := 0;
  v_broken_closure text;
  v_broken_journal bigint;
  v_sales record;
  r record;
begin
  select * into v_sales from private.verify_fiscal_chain(p_establishment_id);  -- contrôle des droits inclus
  for r in select * from public.closures c where c.establishment_id = p_establishment_id order by c.created_at, c.id loop
    v_n := v_n + 1;
    if r.prev_hash <> v_prev or r.hash <> private.closure_digest(v_prev, r.document_no, r.kind, r.period_start, r.period_end,
                                                                r.total_cents, r.tax_cents, r.grand_total_cents, r.totals, r.created_at) then
      v_broken_closure := r.document_no;
      exit;
    end if;
    v_prev := r.hash;
  end loop;
  v_prev := 'GENESIS';
  for r in select * from public.fiscal_journal j where j.establishment_id = p_establishment_id order by j.id loop
    if r.prev_hash <> v_prev or r.hash <> encode(sha256(convert_to(concat_ws('|', v_prev, r.event, r.ref_id, r.actor_id,
         to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), r.payload::text), 'UTF8')), 'hex') then
      v_broken_journal := r.id;
      exit;
    end if;
    v_prev := r.hash;
  end loop;
  return jsonb_build_object(
    'sales', jsonb_build_object('documents', v_sales.documents, 'first_broken', v_sales.first_broken),
    'closures', jsonb_build_object('documents', v_n, 'first_broken', v_broken_closure),
    'journal', jsonb_build_object('entries', (select count(*) from public.fiscal_journal j where j.establishment_id = p_establishment_id),
                                  'first_broken', v_broken_journal),
    'ok', v_sales.first_broken is null and v_broken_closure is null and v_broken_journal is null);
end;
$$;

-- --- RLS ---------------------------------------------------------------------------------------------
alter table public.invoices enable row level security;
alter table public.closures enable row level security;
alter table public.accounting_accounts enable row level security;
alter table public.export_batches enable row level security;
revoke all on public.invoices, public.closures, public.accounting_accounts, public.export_batches from public, anon, authenticated;

grant select on public.invoices, public.closures, public.accounting_accounts, public.export_batches to authenticated;
grant update (account, label) on public.accounting_accounts to authenticated;

create policy invoices_select on public.invoices for select to authenticated using (private.can_see_sale(sale_id));
create policy closures_select on public.closures for select to authenticated
  using (private.can_in_establishment(establishment_id, 'reports.read')
         or exists (select 1 from public.register_sessions s where s.id = session_id and s.opened_by = (select auth.uid())));
create policy accounting_accounts_select on public.accounting_accounts for select to authenticated
  using (private.can(company_id, 'accounting.export'));
create policy accounting_accounts_update on public.accounting_accounts for update to authenticated
  using (private.can(company_id, 'accounting.export')) with check (private.can(company_id, 'accounting.export'));
create policy export_batches_select on public.export_batches for select to authenticated
  using (private.can_in_establishment(establishment_id, 'accounting.export'));

-- --- Fonctions exposées ------------------------------------------------------------------------------
revoke all on all functions in schema private from public, anon;
grant execute on function
  private.close_register(uuid, bigint, jsonb, text), private.close_period(uuid, text, date),
  private.issue_invoice(uuid, jsonb), private.get_document(text, uuid), private.sales_report(uuid, date, date),
  private.export_accounting(uuid, date, date, text), private.verify_integrity(uuid)
to authenticated;

create function public.close_register(p_session_id uuid, p_counted_cash_cents bigint, p_count jsonb default null, p_reason text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.close_register(p_session_id, p_counted_cash_cents, p_count, p_reason); $$;
create function public.close_period(p_establishment_id uuid, p_kind text, p_period_start date)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.close_period(p_establishment_id, p_kind, p_period_start); $$;
create function public.issue_invoice(p_sale_id uuid, p_buyer jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.issue_invoice(p_sale_id, p_buyer); $$;
create function public.get_document(p_kind text, p_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.get_document(p_kind, p_id); $$;
create function public.sales_report(p_establishment_id uuid, p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.sales_report(p_establishment_id, p_from, p_to); $$;
create function public.export_accounting(p_establishment_id uuid, p_from date, p_to date, p_format text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.export_accounting(p_establishment_id, p_from, p_to, p_format); $$;
create function public.verify_integrity(p_establishment_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.verify_integrity(p_establishment_id); $$;

revoke all on function
  public.close_register(uuid, bigint, jsonb, text), public.close_period(uuid, text, date), public.issue_invoice(uuid, jsonb),
  public.get_document(text, uuid), public.sales_report(uuid, date, date), public.export_accounting(uuid, date, date, text),
  public.verify_integrity(uuid)
from public, anon;
grant execute on function
  public.close_register(uuid, bigint, jsonb, text), public.close_period(uuid, text, date), public.issue_invoice(uuid, jsonb),
  public.get_document(text, uuid), public.sales_report(uuid, date, date), public.export_accounting(uuid, date, date, text),
  public.verify_integrity(uuid)
to authenticated;
