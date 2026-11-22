\o /dev/null
-- Vérifications statiques du schéma : RLS, privilèges, fonctions SECURITY DEFINER.
begin;

select tests.ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  'RLS activée sur TOUTES les tables du schéma public');

select tests.ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (has_table_privilege('anon', c.oid, 'SELECT')
        or has_table_privilege('anon', c.oid, 'INSERT')
        or has_table_privilege('anon', c.oid, 'UPDATE')
        or has_table_privilege('anon', c.oid, 'DELETE'))),
  'le rôle anon n''a AUCUN privilège sur les tables public');

select tests.ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'le rôle anon ne peut exécuter AUCUNE fonction public/private');

select tests.ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')),
  'toute fonction SECURITY DEFINER fixe son search_path');

select tests.ok(
  not has_table_privilege('authenticated', 'public.companies', 'INSERT')
  and not has_table_privilege('authenticated', 'public.companies', 'DELETE'),
  'companies : ni INSERT ni DELETE direct (uniquement via RPC contrôlées)');

select tests.ok(
  not has_table_privilege('authenticated', 'public.memberships', 'INSERT'),
  'memberships : aucun INSERT direct (pas de rattachement arbitraire d''un compte)');

select tests.ok(
  not has_column_privilege('authenticated', 'public.establishments', 'company_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.staff_members', 'company_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.memberships', 'company_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.memberships', 'user_id', 'UPDATE'),
  'company_id / user_id non modifiables via l''API');

select tests.ok(
  not has_table_privilege('authenticated', 'public.audit_log', 'INSERT')
  and not has_table_privilege('authenticated', 'public.audit_log', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.audit_log', 'DELETE'),
  'audit_log en lecture seule pour les utilisateurs (non falsifiable)');

select tests.ok(
  not exists (select 1 from information_schema.columns c
              where c.table_schema = 'public'
                and c.column_name in ('email', 'phone', 'phone_e164', 'birth_date', 'address', 'password', 'search_text')
                -- Exception justifiée : l'adresse de l'invité (lignes lisibles par owner/admin uniquement).
                and not (c.table_name = 'invitations' and c.column_name = 'email')
                and has_column_privilege('authenticated', format('%I.%I', c.table_schema, c.table_name), c.column_name, 'SELECT')),
  'RGPD / D2 : aucune coordonnée en clair lisible via l''API (versions masquées uniquement)');

select tests.ok(
  has_column_privilege('authenticated', 'public.clients', 'email_masked', 'SELECT')
  and has_column_privilege('authenticated', 'public.clients', 'phone_masked', 'SELECT')
  and not has_column_privilege('authenticated', 'public.clients', 'email', 'SELECT')
  and not has_column_privilege('authenticated', 'public.clients', 'phone_e164', 'SELECT'),
  'D2 : coordonnées clients lisibles uniquement masquées');

select tests.ok(
  not has_column_privilege('authenticated', 'public.invitations', 'token_hash', 'SELECT'),
  'invitations : le hachage du jeton n''est jamais lisible via l''API');

select tests.ok(
  not has_table_privilege('authenticated', 'public.appointments', 'INSERT')
  and not has_table_privilege('authenticated', 'public.appointments', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.appointments', 'DELETE'),
  'rendez-vous : aucune écriture directe (RPC contrôlées uniquement)');

select tests.ok(
  not has_table_privilege('authenticated', 'public.staff_working_hours', 'INSERT')
  and not has_table_privilege('authenticated', 'public.staff_working_hours', 'DELETE'),
  'horaires : écriture uniquement via RPC');

select tests.ok(
  exists (select 1 from pg_constraint where conname = 'appointments_no_staff_overlap' and contype = 'x')
  and exists (select 1 from pg_constraint where conname = 'appointments_no_resource_overlap' and contype = 'x'),
  'contraintes d''exclusion anti-double réservation présentes (collaborateur + ressource)');

select tests.ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef),
  'aucune fonction SECURITY DEFINER exposée par l''API (schéma public)');

select tests.ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosrc ~ 'errcode\s*=\s*''(40001|40P01)'''),
  'aucune erreur métier levée avec un code réessayé automatiquement par PostgREST (40001/40P01)');

rollback;
