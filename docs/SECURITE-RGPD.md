# Sécurité & protection des données (RGPD)

## Ce qui est déjà en place (prototype)

| Principe | Mise en œuvre |
| --- | --- |
| Aucune donnée réelle | Données de démonstration fictives (`src/data/demo.ts`), e-mail démo sur domaine réservé `.example` (RFC 2606). |
| Minimisation | Clients identifiés par prénom + initiale ; aucun téléphone, e-mail, date de naissance ni note de santé. |
| Pas de traceurs | Aucun outil d'analyse, pixel publicitaire ni cookie. Pas de bannière cookies nécessaire à ce stade. |
| Pas de transfert à des tiers | Polices système uniquement (pas de Google Fonts), aucune ressource externe chargée. |
| Stockage local limité | `sessionStorage` : profil d'affichage non sensible, expiré après 30 min d'inactivité. `localStorage` : préférence de langue uniquement. Le mot de passe n'est jamais stocké. |
| Authentification | Messages d'erreur génériques, verrouillage temporaire après 5 échecs, déconnexion automatique, champs `autocomplete` corrects pour les gestionnaires de mots de passe. |
| En-têtes HTTP | `public/_headers` : CSP stricte, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. |
| XSS | Rendu via React (échappement automatique), aucun `dangerouslySetInnerHTML`, règle ESLint `no-eval`. |
| Build | Pas de source maps en production ; `noindex` tant que l'application n'est pas publique. |

## À réaliser avant toute donnée réelle (backend)

- Authentification côté serveur : mots de passe hachés (Argon2id), MFA, limitation de débit, cookie de session `HttpOnly; Secure; SameSite=Strict`.
- Isolation stricte des données par salon (multi-tenant) et contrôle d'accès par rôle.
- Hébergement des données dans l'UE, chiffrement au repos et en transit, sauvegardes chiffrées.
- Registre des traitements, base légale par traitement, durées de conservation et purge automatique.
- Exercice des droits (accès, rectification, effacement, portabilité) depuis l'interface.
- Contrat de sous-traitance (art. 28) avec chaque salon client et avec les hébergeurs.
- Journalisation des accès aux données personnelles, sans données personnelles dans les logs.
- AIPD si des données sensibles (ex. allergies, contre-indications esthétiques) sont collectées.
