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
  not exists (select 1 from information_schema.columns
              where table_schema = 'public'
                and column_name in ('email', 'phone', 'birth_date', 'address', 'password')),
  'minimisation RGPD : aucune colonne e-mail/téléphone/adresse/mot de passe dans public');

rollback;
