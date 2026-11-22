# SOLUSSIMO

Plateforme SaaS internationale de gestion pour salons de coiffure et instituts d'esthétique.

> **Statut : prototype front-end.** Toutes les données affichées (salon « Maison Élégance », clients, personnel, ventes, stock) sont **fictives**.

## Stack

- React 19 + TypeScript (strict) + Vite
- Tailwind CSS v4 (thème aux couleurs SOLUSSIMO)
- React Router · i18next (FR, EN, ES, DE) · lucide-react

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

Compte de démonstration : bouton « Utiliser le compte de démonstration » sur la page de connexion.

## Vérifications

```bash
npm run typecheck
npm run lint
npm run build
```

Ces vérifications tournent aussi en CI (GitHub Actions) sur chaque Pull Request.

## Structure

```
src/
  auth/        session (prototype), contexte d'authentification, garde de routes
  components/  composants UI partagés (Logo, StatCard, LanguageSwitcher…)
  data/        données de démonstration fictives
  i18n/        configuration i18next + fichiers de traduction fr/en/es/de
  layouts/     mise en page (barre latérale, tiroir et onglets mobiles)
  lib/         formatage localisé (devise, dates)
  pages/       Connexion, Tableau de bord, Planning, Clients, Personnel, Caisse, Stock
```

## Ajouter une langue

1. Copier `src/i18n/locales/fr.json` vers `xx.json` et traduire.
2. Déclarer la langue dans `SUPPORTED_LANGUAGES` (`src/i18n/index.ts`).

## Sécurité & RGPD

Voir [docs/SECURITE-RGPD.md](docs/SECURITE-RGPD.md).
