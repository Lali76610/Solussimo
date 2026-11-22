# SOLUSSIMO

Plateforme SaaS internationale de gestion pour salons de coiffure et instituts d'esthétique.

> **Statut : V0.3 — Personnel & Planning.** (Socle V0.2 : Authentification réelle (Supabase Auth), architecture multi-tenant protégée par RLS, et **mode démonstration** séparé (salon fictif « Maison Élégance »).) V0.3 : fiches collaborateurs, horaires, absences, invitations sécurisées, planning de réservation réel. Aucune donnée client réelle.

## Stack

- React 19 + TypeScript (strict) + Vite
- Tailwind CSS v4 (thème aux couleurs SOLUSSIMO)
- React Router · i18next (FR, EN, ES, DE) · lucide-react
- Supabase : PostgreSQL + Auth + Row Level Security — voir [docs/SUPABASE.md](docs/SUPABASE.md)

## Identité graphique

| Couleur          | Hex       | Token Tailwind  |
| ---------------- | --------- | --------------- |
| Turquoise        | `#008B8B` | `brand`         |
| Turquoise clair  | `#BFEAE7` | `brand-light`   |
| Or doux          | `#C4A875` | `gold`          |
| Blanc            | `#FFFFFF` | `white`         |

## Démarrage

```bash
npm install
npm run dev          # http://localhost:5173
npm run dev:mobile   # exposé sur le réseau local (test sur téléphone)
```

- **Sans configuration** : seul le mode démonstration est disponible (bouton « Explorer la démonstration »).
- **Avec Supabase** : copier `.env.example` vers `.env.local` et renseigner l'URL et la **clé publique** (anon). Voir [docs/SUPABASE.md](docs/SUPABASE.md).

## Vérifications

```bash
npm run verify       # types + lint + tests unitaires + build + détection de secrets
npm run test:db      # migrations + 198 tests SQL (sécurité, planning, concurrence) (PostgreSQL requis, DATABASE_URL)
```

Ces vérifications tournent aussi en CI (GitHub Actions) sur chaque Pull Request.

## Structure

```
supabase/
  migrations/  migrations SQL versionnées (schéma, RLS, RPC)
  tests/       tests de sécurité SQL (isolation multi-tenant, rôles, RGPD)
src/
  auth/        Supabase Auth + mode démo séparé, gardes de routes
  tenant/      entreprise active et permissions (multi-tenant)
  components/  composants UI partagés (Logo, StatCard, LanguageSwitcher…)
  data/        données de démonstration fictives
  i18n/        configuration i18next + fichiers de traduction fr/en/es/de
  layouts/     mise en page (barre latérale, tiroir et onglets mobiles)
  lib/         formatage localisé (devise, dates)
  pages/       écrans démo (données fictives) + live/ (données Supabase), inscription, création de salon, compte
```

## Ajouter une langue

1. Copier `src/i18n/locales/fr.json` vers `xx.json` et traduire.
2. Déclarer la langue dans `SUPPORTED_LANGUAGES` (`src/i18n/index.ts`).

## Sécurité & RGPD

Voir [docs/SECURITE-RGPD.md](docs/SECURITE-RGPD.md).
