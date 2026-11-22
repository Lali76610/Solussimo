# Sécurité & protection des données (RGPD)

## Mesures en place (V0.2)

### Isolation multi-tenant
| Mesure | Mise en œuvre |
| --- | --- |
| RLS sur toutes les tables | Politiques par entreprise via `private.is_company_member()` / `private.can()` (testé). |
| Visiteur non connecté | Le rôle `anon` n'a **aucun** privilège sur les tables ni les fonctions (testé). |
| Moindre privilège | Privilèges par colonne : `company_id`, `user_id`, `created_by` non modifiables via l'API. |
| Pas d'auto-rattachement | Aucun `INSERT` direct dans `memberships` ; création d'entreprise uniquement via RPC. |
| Anti-escalade | Un admin ne gère jamais un owner ; personne ne change son propre rôle ; ≥ 1 owner garanti. |
| Fonctions sûres | `SECURITY DEFINER` + `search_path` vide ; schéma `private` non exposé par l'API. |
| Traçabilité | `audit_log` alimenté par triggers, lecture owner/admin, non falsifiable, sans donnée personnelle. |
| Tests | 94 assertions SQL + test de mutation (une politique affaiblie fait échouer la CI). |

### Authentification
| Mesure | Mise en œuvre |
| --- | --- |
| Supabase Auth | Mots de passe hachés côté serveur, confirmation d'e-mail, flux PKCE, rotation des jetons. |
| Politique de mot de passe | ≥ 10 caractères, majuscule, minuscule, chiffre (client + `config.toml`). |
| Anti-énumération | Messages génériques (connexion, inscription, mot de passe oublié). |
| Anti-force brute | Verrouillage client après 5 échecs + limitation de débit Supabase côté serveur. |
| Redirections | Uniquement vers des chemins internes (pas de redirection ouverte). |
| Mode démo | Séparé : aucune requête réseau, données fictives locales, bandeau permanent. |

### Secrets
| Mesure | Mise en œuvre |
| --- | --- |
| Aucune clé dans le dépôt | `.env*` ignorés, `.env.example` sans valeur. |
| Pas de `service_role` dans le navigateur | Vérification au build (échec) + à l'exécution + `npm run check:secrets` sur le dépôt et `dist/` (CI). |
| CSP | `connect-src` limité à `'self'` et `*.supabase.co`. |

### RGPD
| Principe | Mise en œuvre |
| --- | --- |
| Minimisation | Profil = nom affiché + langue. Collaborateurs = nom affiché + métier. Aucune coordonnée. |
| Consentement / information | Case à cocher à l'inscription + page « Confidentialité » (4 langues). |
| Droit d'accès / portabilité | `export_my_data()` → téléchargement JSON depuis « Mon compte ». |
| Droit à l'effacement | `delete_my_account()` (cascade) et `delete_company()` (owner, confirmation par le nom). |
| Pas de traceurs | Aucun outil d'analyse, polices système, aucune ressource tierce. |
| Données fictives | Démo et tests : domaine réservé `.example`, aucun client réel. |

### Personnel & Planning (V0.3)
| Mesure | Mise en œuvre |
| --- | --- |
| Cloisonnement par établissement | Managers / collaborateurs limités aux établissements de leur fiche (RLS). |
| Absences | Types neutres (congés, absence, formation, autre) : **aucun motif médical** (art. 9 RGPD). |
| Invitations | Jeton 256 bits, usage unique, 72 h ; seul le hachage SHA-256 est stocké ; lien dans le fragment `#` (absent des journaux serveur) ; acceptation réservée à l'e-mail confirmé. |
| Rendez-vous | Écriture uniquement par RPC serveur (permissions, horaires, congés) ; contraintes d'exclusion contre la double réservation ; journal d'audit. |
| Clients | Libellé minimal (80 caractères), aucune coordonnée, en attendant le module Clients. |

### Clients (V0.4)
| Mesure | Mise en œuvre |
| --- | --- |
| Masquage des coordonnées (D2) | `email` / `phone_e164` non lisibles via l'API ; versions masquées seules ; affichage complet par `reveal_client_contact` (owner/admin/manager), **journalisé** |
| Minimisation (D4, D5) | Prénom OU nom suffit ; contacts facultatifs ; jour/mois de naissance sans année ; clients de passage sans fiche |
| Consentements | Par finalité et canal, **ajout seul** (aucune modification/suppression), méthode et version du texte, cases non cochées par défaut |
| Données de santé (D1, D3) | Désactivées par défaut ; activation par le propriétaire après 3 confirmations légales ; habilitation (owner/admin ou praticien désigné par eux) ; consentement explicite ; **AES-256** (pgcrypto) avec clé dans **Supabase Vault** ; aucune lecture directe ; chaque accès journalisé ; effacement au retrait du consentement ou à la désactivation |
| Droits RGPD | Export JSON (partage iOS), rectification tracée, anonymisation (rendez-vous conservés pour la comptabilité) |
| Conservation (D6) | Réexamen des fiches inactives (36 mois par défaut, paramétrable), **jamais de suppression automatique** ; durée comptable par pays |
| Anti-aspiration | Recherche limitée à 50 résultats ; pas de liste complète pour le rôle collaborateur |
| Fusion (D7) | Responsables dans leurs établissements, verrous ordonnés (concurrence testée), consentement le plus restrictif conservé, journal |

## Reste à faire avant des données clients réelles
- Projet Supabase en **région UE**, DPA Supabase signé, SMTP personnalisé.
- Envoi automatique des invitations par e-mail (SMTP personnalisé / fonction serveur) — aujourd'hui partagé par l'appli Mail du gérant.
- **MFA** (TOTP) pour owners/admins.
- Textes juridiques définitifs (responsable de traitement, DPO, durées de conservation) et registre des traitements.
- Purge automatique des comptes inactifs / journaux d'audit au-delà de la durée de conservation.
- **AIPD** à réaliser avant d'activer les données de santé ; validation juridique du point HDS (France) / § 22 BDSG (Allemagne).
