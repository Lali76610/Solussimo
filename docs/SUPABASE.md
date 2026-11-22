# Socle Supabase — SOLUSSIMO V0.2

## Architecture multi-tenant

```
auth.users (Supabase Auth)
   │ 1–1
   ▼
profiles ──────────────┐            (nom affiché, langue — rien d'autre)
                       │
companies  ◄── memberships (user_id, role) ──► profiles      ← TENANT = companies
   │  1–n                                                    (frontière d'isolation)
   ▼
establishments ◄── staff_members (company_id, establishment_id, user_id?)
   │
audit_log (qui / quoi / quand — sans données personnelles)
```

- **Tenant = `companies`.** Toute table métier porte `company_id`.
- **Rôles** (`company_role`) : `owner` > `admin` > `manager` > `staff`.
- **Intégrité inter-tenant** : clé étrangère composite `(establishment_id, company_id)`,
  `company_id` immuable (trigger + privilèges colonne), lien `staff_members.user_id`
  autorisé uniquement vers un membre de la même entreprise.
- **Création d'entreprise** : uniquement via `create_company_with_establishment()`
  (atomique : entreprise + établissement + owner + fiche collaborateur).
- **Adhésions** : pas d'`INSERT` direct depuis l'API. Le futur flux d'invitation
  (avec acceptation par l'invité) passera par une fonction contrôlée.

### Matrice des permissions

| Permission             | owner | admin | manager | staff |
| ---------------------- | :---: | :---: | :-----: | :---: |
| `company.read`         |   ✔   |   ✔   |    ✔    |   ✔   |
| `company.update`       |   ✔   |   ✔   |         |       |
| `company.delete`       |   ✔   |       |         |       |
| `establishment.write`  |   ✔   |   ✔   |         |       |
| `establishment.delete` |   ✔   |       |         |       |
| `membership.manage`    |   ✔   |   ✔¹  |         |       |
| `staff.write`          |   ✔   |   ✔   |    ✔    |       |
| `audit.read`           |   ✔   |   ✔   |         |       |
| `invitation.manage`    |   ✔   |   ✔²  |         |       |
| `schedule.write`       |   ✔   |   ✔   |   ✔³    |       |
| `service.write`        |   ✔   |   ✔   |         |       |
| `resource.write`       |   ✔   |   ✔   |         |       |
| `appointment.write`    |   ✔   |   ✔   |   ✔³    |  ✔³   |

¹ Un admin ne peut jamais créer, modifier ou retirer un owner, ni changer son propre rôle.
Une entreprise garde toujours au moins un owner.
² Un admin invite uniquement des managers et des collaborateurs.
³ **Cloisonnement par établissement (V0.3)** : managers et collaborateurs ne voient et
n'agissent que dans les établissements auxquels leur fiche est affectée. Owner/admin : tous.

Source unique : `private.permission_roles()` (SQL). L'interface lit les permissions
effectives via `rpc('my_permissions')` ; **la base reste seule juge** (RLS).

## Migrations versionnées

| Fichier | Contenu |
| --- | --- |
| `20261122100000_foundation.sql` | schéma `private`, types, utilitaires |
| `20261122100100_tenancy_tables.sql` | tables multi-tenant, trigger de création de profil |
| `20261122100200_permissions_and_rls.sql` | fonctions d'autorisation, garde-fous, RLS, privilèges |
| `20261122100300_audit_log.sql` | journal d'audit non falsifiable |
| `20261122100400_onboarding_and_gdpr_rpc.sql` | création de salon, export / effacement RGPD |
| `20261122100500_harden_rpc_exposure.sql` | RPC privilégiées déplacées dans `private`, enveloppes `SECURITY INVOKER` |
| `20261123100000_staff_scheduling.sql` | V0.3 — fonctions multiples, réservable, affectations multi-établissements, horaires, absences, RLS par établissement |
| `20261123100100_invitations.sql` | V0.3 — invitations à usage unique (72 h, jeton haché, e-mail confirmé) |
| `20261123100200_planning.sql` | V0.3 — prestations, ressources (cabines), rendez-vous par RPC, contraintes d'exclusion, fuseaux / DST |
| `20261123100300_conflict_errcode_and_indexes.sql` | V0.3 — conflit de version signalé sans code réessayé par PostgREST (constaté sur Supabase : boucle → HTTP 504) ; index |

## Tests de sécurité

```bash
# PostgreSQL local jetable (le script installe un stub Supabase minimal si besoin)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
```

197 assertions : RLS sur toutes les tables, aucun privilège `anon`, isolation complète
entre deux entreprises et entre établissements, matrice des rôles, création de salon,
RGPD, Personnel (affectations, horaires, absences), invitations (usage unique,
expiration, révocation, mauvais compte), Planning (disponibilités, pauses, congés,
double réservation, déplacement, annulation, concurrence optimiste, fuseaux, changement
d'heure, cabines) et **concurrence réelle** (sessions parallèles : 20 réservations
simultanées du même créneau → 1 seule acceptée).
Exécutées automatiquement en CI (job « Base de données »).

> ⚠️ Ne jamais pointer `DATABASE_URL` vers une base de production : le script recrée une base `solussimo_test`.

## Environnement de développement (en service)

| Élément | Valeur |
| --- | --- |
| Projet | `solussimo-dev` — ref `iipymibdmazppggymvwn` — région `eu-west-1` (Irlande, UE) |
| Migrations | 10/10 appliquées (`npm run db:migrate -- iipymibdmazppggymvwn`) |
| Tests SQL sur le projet réel | 194/194 (transactions annulées, aucune donnée conservée) ; concurrence : local + CI |
| Tests API de bout en bout | 39/39 (`npm run test:api -- iipymibdmazppggymvwn`) |
| Security / Performance Advisor | 0 alerte |
| Auth | confirmation e-mail, mot de passe ≥ 10 (a-z, A-Z, 0-9), ré-authentification pour changer de mot de passe, inscriptions anonymes désactivées |
| Site Netlify associé | `solussimo-dev.netlify.app` (projet Netlify distinct de la démo, protection d'accès active) |
| Redirections autorisées | `localhost:5173`, `solussimo-dev.netlify.app` (+ aperçus `*--solussimo-dev`) |
| Clé navigateur | clé **publishable** (`sb_publishable_…`), fournie par variable d'environnement |
| Signature des jetons | clé asymétrique **ES256** uniquement ; ancien secret HS256 **révoqué**, clés legacy `anon` / `service_role` **désactivées** (22/11/2026) |

Les scripts `db:migrate` et `test:api` utilisent l'API de gestion Supabase
(`SUPABASE_ACCESS_TOKEN`, jamais versionné). `db:migrate` refuse tout projet
dont le nom ne finit pas par `-dev`, `-demo` ou `-staging` (garde-fou production).

## Mise en service d'un nouvel environnement

1. **Créer le projet** sur supabase.com — région **UE** (ex. Francfort `eu-central-1` ou Paris `eu-west-3`).
   Un projet distinct par environnement : `solussimo-demo` / `solussimo-staging` / `solussimo-prod`.
2. **Appliquer les migrations** :
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
3. **Auth → URL Configuration** : Site URL + Redirect URLs (`https://<domaine>/**`).
   **Auth → Providers → Email** : confirmation d'e-mail activée, mot de passe ≥ 10 caractères
   (majuscule, minuscule, chiffre), protection contre les mots de passe compromis (offre Pro).
4. **SMTP personnalisé** (Auth → SMTP) avant toute ouverture : l'expéditeur par défaut de Supabase est limité.
5. **Variables d'environnement** (Netlify → Site configuration → Environment variables) :
   `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` (**clé publique** anon/publishable uniquement).
   Le build échoue volontairement si une clé `service_role` / `sb_secret_` est fournie.
6. Régénérer les types : `npx supabase gen types typescript --linked > src/lib/database.types.ts`.

La clé `service_role` ne doit **jamais** quitter le tableau de bord Supabase ni
apparaître dans le dépôt, Netlify (variables `VITE_*`) ou le navigateur.
