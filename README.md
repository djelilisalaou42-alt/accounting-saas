# Accounting SaaS — Progiciel de gestion comptable SYSCOHADA / OHADA

Étapes réalisées : 1 (architecture), 2 (schéma Prisma), 3 (PostgreSQL + migrations + intégrité
comptable), 4 (authentification), 5 (autorisation, rôles, permissions, multi-entreprise), 6
(exercices comptables + plan comptable SYSCOHADA), 7 (journaux + moteur de saisie des écritures), 8
(grand livre, balance générale, exports CSV), 9 (lettrage des comptes de tiers), 10 (clients,
fournisseurs, devis, factures, paiements), 11 (trésorerie : caisse, banques, rapprochement bancaire).
Étape 12 (fiscalité, immobilisations, budgets...) non commencée.

## Sommaire

- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration — variables d'environnement](#configuration--variables-denvironnement)
- [Base de données](#base-de-données)
- [Authentification](#authentification)
- [Lancement](#lancement)
- [Tests](#tests)
- [Sécurité](#sécurité)
- [Arborescence](#arborescence)
- [Limites connues de cet environnement](#limites-connues-de-cet-environnement)

---

## Prérequis

- Node.js 20+
- PostgreSQL 16 (Docker recommandé)
- npm

## Installation

### Backend

```bash
cd backend
cp .env.example .env
# éditer .env : générer de vrais secrets JWT (jamais les valeurs d'exemple)
npm install
```

### Frontend

```bash
cd frontend
cp .env.local.example .env.local
npm install
```

## Configuration — variables d'environnement

### Backend (`backend/.env`) — **jamais exposées au navigateur**

| Variable | Rôle | Secret ? |
|---|---|---|
| `DATABASE_URL` | Connexion PostgreSQL (dev) | Oui (identifiants DB) |
| `DATABASE_URL_TEST` | Connexion PostgreSQL (tests) | Oui |
| `JWT_ACCESS_SECRET` | Signature des access tokens | **Oui, critique** — 32+ caractères aléatoires |
| `JWT_ACCESS_EXPIRES_IN` | Durée de vie de l'access token (défaut `15m`) | Non |
| `JWT_REFRESH_SECRET` | Réservé (rotation future d'algorithme) | Oui |
| `JWT_REFRESH_EXPIRES_IN` | Durée de vie du refresh token (défaut `7d`) | Non |
| `BCRYPT_SALT_ROUNDS` | Legacy (l'auth utilise Argon2id, pas bcrypt) | Non |
| `MAX_LOGIN_ATTEMPTS` | Seuil de verrouillage anti-bruteforce (défaut 5) | Non |
| `LOGIN_LOCKOUT_MINUTES` | Durée du verrouillage (défaut 15) | Non |
| `CORS_ORIGIN` | Origine(s) autorisée(s) | Non |
| `FRONTEND_URL` | Base des liens envoyés par email (invitation, reset password) | **Oui en production** — sans cette variable, retombe silencieusement sur `http://localhost:3000`, produisant des liens cassés dans les emails réels (gap identifié lors de la finalisation pré-production) |
| `ATTACHMENTS_STORAGE_PATH` | Dossier de stockage des pièces jointes (Étape 16, défaut `./storage/attachments`) | Non |
| `ATTACHMENTS_MAX_SIZE_BYTES` | Taille maximale d'un fichier téléversé (défaut 10 Mo) | Non |
| `NODE_ENV` | `development` / `test` / `production` | Non |

**Jamais dans `NEXT_PUBLIC_*` ni dans le code frontend** : `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`DATABASE_URL`. Le frontend ne connaît et ne doit connaître aucun de ces secrets — il ne fait que
recevoir un access token déjà signé et envoyer/recevoir un cookie opaque qu'il ne peut pas lire.

### Frontend (`frontend/.env.local`) — **variables publiques uniquement**

| Variable | Rôle |
|---|---|
| `NEXT_PUBLIC_API_URL` | URL de base de l'API backend |

Toute variable préfixée `NEXT_PUBLIC_` est injectée dans le bundle JavaScript livré au navigateur —
par construction, ce préfixe ne doit donc **jamais** porter un secret. Un seul fichier `.env.local`
existe côté frontend et ne contient que cette URL, publique par nature.

## Base de données

```bash
docker compose up -d
docker compose exec postgres psql -U accounting_user -d postgres -c "CREATE DATABASE accounting_saas_test OWNER accounting_user;"
```

### Migrations

**17 migrations** (Étapes 1 à 17), à appliquer dans l'ordre chronologique — le nommage des
dossiers (`AAAAMMJJHHMMSS_nom`) garantit cet ordre par simple tri alphabétique :

```bash
cd backend
export DATABASE_URL="postgresql://accounting_user:accounting_password@localhost:5432/accounting_saas?schema=public"
for f in prisma/migrations/2026*/migration.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

Vérifié lors des audits post-Étape 12, post-Étape 14 et post-Étape 16 : les 16 migrations rejouées
sur une base entièrement vide reproduisent une structure strictement identique (43 tables, 121
clés étrangères, mêmes valeurs d'enum) à une base construite au fil des étapes — voir [Limites
connues](#limites-connues-de-cet-environnement).

En usage normal (accès réseau non restreint), `npx prisma migrate dev` régénère et applique tout
cela automatiquement — voir la section limites plus bas pour le détail de la contrainte réseau de cet
environnement de développement.

### Seed

Référentiel de permissions/rôles (à rejouer aussi en production — idempotent), puis compléments
ajoutés au fil des étapes, puis données de démonstration (dev uniquement) :

```bash
cd backend
psql "$DATABASE_URL" -f prisma/seed/seed_permissions_roles.sql
psql "$DATABASE_URL" -f prisma/seed/seed_step6_permissions.sql
psql "$DATABASE_URL" -f prisma/seed/seed_step7_permissions.sql
psql "$DATABASE_URL" -f prisma/seed/seed_step9_permissions.sql
psql "$DATABASE_URL" -f prisma/seed/seed_step10_permissions.sql
psql "$DATABASE_URL" -f prisma/seed/seed_step11_permissions.sql
psql "$DATABASE_URL" -f prisma/seed/seed_step12_permissions.sql
psql "$DATABASE_URL" -f prisma/seed/seed_step13_permissions.sql
psql "$DATABASE_URL" -f prisma/seed/seed_step14_permissions.sql
psql "$DATABASE_URL" -f prisma/seed/seed_step16_permissions.sql
psql "$DATABASE_URL" -f prisma/seed/seed_step17_permissions.sql
psql "$DATABASE_URL" -f prisma/seed/seed.sql
```

`seed.sql` (dev uniquement) : entreprise de démonstration, admin (`admin@demo.local` /
`Demo1234!`), plan comptable minimal (9 comptes, rattachés au référentiel SYSCOHADA réel —
corrigé lors de l'audit post-Étape 12, voir [Limites connues](#limites-connues-de-cet-environnement)),
5 journaux, un exercice 2026 ouvert — aucune donnée réelle. Le mot de passe de démonstration est
haché en Argon2id (corrigé lors de la préparation au déploiement — il était auparavant haché en
bcrypt, jamais reconnu par la vérification Argon2id de l'application, rendant ce login
systématiquement impossible malgré la documentation ; voir [Limites
connues](#limites-connues-de-cet-environnement)).

### Prisma (client ORM)

```bash
npx prisma generate
```

Voir [Limites connues](#limites-connues-de-cet-environnement) : cette commande n'a pas pu être
exécutée dans ce sandbox de développement, mais fonctionne normalement avec un accès réseau standard.

## Authentification

### Endpoints

| Méthode | Route | Protection | Description |
|---|---|---|---|
| POST | `/auth/register` | Publique, throttlée | Inscription |
| POST | `/auth/login` | Publique, throttlée | Connexion — pose le cookie refresh token |
| POST | `/auth/refresh` | Cookie refresh token requis | Renouvelle l'access token (rotation) |
| POST | `/auth/logout` | Cookie refresh token requis | Révoque la session courante |
| POST | `/auth/logout-all` | `JwtAuthGuard` | Révoque toutes les sessions de l'utilisateur |
| GET | `/auth/me` | `JwtAuthGuard` | Profil de l'utilisateur connecté |
| POST | `/auth/forgot-password` | Publique, throttlée | Demande de réinitialisation (réponse générique) |
| POST | `/auth/reset-password` | Publique | Réinitialise avec un token à usage unique |
| POST | `/auth/change-password` | `JwtAuthGuard` | Change le mot de passe, révoque les sessions |

### Cycle de vie d'une session

```
Login (email + mot de passe)
 ↓
Access Token (JWT, 15 min, payload { sub, email } uniquement)
  → renvoyé dans le corps JSON, gardé EN MÉMOIRE côté frontend (jamais localStorage)
 ↓
Refresh Token (opaque, 256 bits, 7 jours)
  → posé en cookie HttpOnly + Secure(prod) + SameSite=Strict, path=/api/v1/auth
  → seul son hash SHA-256 est stocké en base, jamais la valeur en clair
 ↓
Expiration de l'access token (15 min)
 ↓
Le frontend appelle POST /auth/refresh (le navigateur envoie le cookie automatiquement,
le JS frontend n'a et ne peut avoir aucun accès direct au refresh token)
 ↓
Rotation : l'ancien refresh token est immédiatement révoqué (revoked=true, revokedAt),
un nouveau couple access/refresh est émis et chaîné (replaced_by_token_id)
 ↓
Nouvel Access Token retourné, nouveau cookie refresh token posé
```

### Détection de réutilisation d'un refresh token

Si un refresh token déjà révoqué (donc déjà utilisé une fois pour une rotation, ou explicitement
déconnecté) est présenté à nouveau à `/auth/refresh`, c'est le signe qu'un token a probablement été
volé puis rejoué en parallèle d'une session légitime. Comportement choisi et **testé
explicitement** (voir section Tests) : **toutes** les sessions actives de l'utilisateur sont
immédiatement révoquées (pas seulement le successeur direct du token rejoué), l'événement est
journalisé (`AuditAction.REVOKE`), et la requête échoue avec 401. L'utilisateur doit se reconnecter
sur tous ses appareils — c'est un compromis volontairement conservateur : mieux vaut une
reconnexion partout qu'une session compromise laissée active ailleurs.

### Cookies — comportement dev vs production

| Attribut | Valeur | Effet |
|---|---|---|
| `HttpOnly` | toujours `true` | invisible pour tout JavaScript (protection XSS) |
| `Secure` | `true` seulement si `NODE_ENV=production` | en dev HTTP (localhost), `Secure=true` empêcherait le navigateur d'accepter le cookie — désactivé volontairement en dev, **obligatoire** en production (HTTPS uniquement) |
| `SameSite` | `Strict` | jamais envoyé sur une requête cross-site (protection CSRF sans token dédié) |
| `Path` | `/api/v1/auth` | inaccessible à toute autre route de l'API |
| `Max-Age` | 7 jours | aligné sur `JWT_REFRESH_EXPIRES_IN` |

Le refresh token n'est **jamais** accessible en `document.cookie` (HttpOnly l'en empêche), jamais
stocké en `localStorage`/`sessionStorage`/`IndexedDB`, et le frontend ne le manipule à aucun moment —
il se contente d'appeler `/auth/refresh` en laissant le navigateur gérer le cookie.

### `MailService` (réinitialisation de mot de passe)

Aucun fournisseur email réel n'est branché à ce stade (hors périmètre de l'authentification pure).
En développement/test, `MailService` stocke l'email dans une boîte de sortie interne en mémoire
(jamais via `Logger` — le token de réinitialisation n'apparaît donc jamais dans les logs
applicatifs). En production, `sendPasswordResetEmail` lève une exception explicite plutôt que de
simuler silencieusement un envoi.

## Lancement

```bash
# Backend (http://localhost:3001/api/v1)
cd backend && npm run start:dev

# Frontend (http://localhost:3000)
cd frontend && npm run dev
```

Pages disponibles : `/login`, `/register`, `/forgot-password`, `/reset-password`, `/` (profil +
déconnexion, protégée côté client par redirection si non authentifié).

## Tests

### Tests unitaires (Jest, sans dépendance Prisma)

```bash
cd backend && npx jest --config jest.config.js
```

**Résultat réellement obtenu : 24 PASS / 24 TOTAL** (4 suites : `password.util`, `token.util`, JWT,
`MailService`).

### Tests d'intégration PostgreSQL (contournement documenté du moteur Prisma indisponible)

```bash
export DATABASE_URL_TEST="postgresql://accounting_user:accounting_password@localhost:5432/accounting_saas_test?schema=public"
cd backend && npx ts-node --compiler-options '{"module":"commonjs"}' test/auth/auth_integration_test.ts
```

**Résultat réellement obtenu : 25 PASS / 25 TOTAL**, incluant explicitement : inscription valide,
email dupliqué rejeté, connexion valide/invalide, statut désactivé, émission/rotation/expiration/
révocation de refresh token, **scénario complet de réutilisation d'un refresh token déjà révoqué**
(connexion → token A → token B via rotation → réutilisation de A → détection → révocation de toute
la session B+C), logout, logout-all, cycle complet de reset password (demande, expiration, usage
unique), changement de mot de passe (révocation des sessions), et verrouillage anti-bruteforce
(5 échecs → verrouillage → expiration simulée → déblocage → connexion réussie).

### Backend — compilation / build / lint (revérifié à l'Étape 5)

| Vérification | Commande | Résultat réel |
|---|---|---|
| TypeScript | `npx tsc --noEmit -p tsconfig.json` | **0 erreur** |
| Build NestJS | `npx nest build` | **Succès** |
| ESLint (auth + companies + common) | `npx eslint "src/modules/auth/**/*.ts" "src/modules/companies/**/*.ts" "src/common/**/*.ts"` | **0 erreur, 0 avertissement** |

### Frontend — compilation / build / lint (revérifié à l'Étape 5)

| Vérification | Commande | Résultat réel |
|---|---|---|
| TypeScript | `npx tsc --noEmit -p tsconfig.json` | **0 erreur** |
| Build Next.js | `npx next build` | **Succès** — 10 routes générées (`/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/companies`, `/companies/new`, `/companies/[id]`, `/companies/[id]/members`) |
| ESLint | `npx next lint` | **0 avertissement, 0 erreur** |

Un problème réel a été rencontré et corrigé pendant cette vérification : `useSearchParams()` dans
`/reset-password` doit être enveloppé dans un `<Suspense>` sous l'App Router de Next.js 14 (erreur de
build sinon) — corrigé en extrayant le formulaire dans un sous-composant englobé par `<Suspense>`.

### Tests non exécutés

Aucun test Jest/Supertest piloté par `PrismaService`/`AuthController` via injection de dépendances
NestJS réelle n'a pu être exécuté : cela nécessiterait le client Prisma généré (voir limites
ci-dessous). Les tests d'intégration PostgreSQL ci-dessus couvrent le même périmètre fonctionnel en
appelant directement la vraie base avec le vrai code métier non-Prisma (`password.util.ts`,
`token.util.ts`), mais ne passent pas par `AuthController`/HTTP — donc ne valident pas les DTO
(`class-validator`), les guards NestJS eux-mêmes, ni le routing HTTP. Une fois `prisma generate`
disponible : `npx jest --config test/jest-e2e.json` avec Supertest sur `AuthController` complétera
cette couverture.

## Sécurité

- **Mots de passe** : Argon2id (memoryCost 19456, timeCost 2, parallelism 1 — recommandation OWASP),
  jamais stockés ni retournés en clair, jamais présents dans une réponse API (`toPublicUser()`
  exclut systématiquement `passwordHash`).
- **Access token** : JWT `HS256`, payload strictement `{ sub, email }`, 15 minutes, secret
  `JWT_ACCESS_SECRET` uniquement côté backend.
- **Refresh token** : opaque, 256 bits d'entropie (`crypto.randomBytes(32)`), seul son hash SHA-256
  est stocké en base, cookie HttpOnly/Secure(prod)/SameSite=Strict, rotation à chaque usage,
  révocation individuelle (`logout`) ou globale (`logout-all`), détection de réutilisation (voir
  plus haut).
- **Anti-bruteforce** : verrouillage après `MAX_LOGIN_ATTEMPTS` (5) échecs, `LOGIN_LOCKOUT_MINUTES`
  (15) minutes, + rate limiting IP+email sur `/auth/login`, `/auth/register`, `/auth/forgot-password`
  (`AuthThrottlerGuard`).
- **Anti-énumération** : `/auth/login` renvoie un message strictement identique pour "email
  inconnu" et "mot de passe incorrect" (avec une vérification Argon2 factice sur email inconnu, pour
  que le temps de réponse ne trahisse pas la différence) ; `/auth/forgot-password` renvoie toujours
  le même message générique.
- **Audit** : `REGISTER`, `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `LOGOUT_ALL`, `REFRESH`, `REVOKE`,
  `PASSWORD_CHANGE`, `PASSWORD_RESET_REQUEST`, `PASSWORD_RESET` tous journalisés dans `audit_logs` —
  jamais de mot de passe, hash, ou token dans `old_value`/`new_value`.
- **Recherche systématique de fuite** (voir rapport de conversation) : aucun `console.log` dans le
  code source, aucun token brut dans un appel `Logger`, aucun secret en dur hors fichiers `.env*`
  (exclus de l'archive), aucun usage de `localStorage`/`sessionStorage`/`IndexedDB` côté frontend,
  `refreshToken` jamais inclus dans un corps de réponse JSON (uniquement `res.cookie`).

## Arborescence

```
accounting-saas/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   │   ├── 20260821120000_init/
│   │   │   ├── 20260821123000_accounting_rules/
│   │   │   ├── 20260821140000_auth_tokens/           (Étape 4)
│   │   │   └── 20260821150000_audit_actions_auth/    (Étape 4)
│   │   ├── seed/seed.sql
│   │   └── seed.ts
│   ├── src/modules/auth/
│   │   ├── auth.controller.ts / auth.service.ts / auth.module.ts
│   │   ├── password.util.ts / token.util.ts / jwt-payload.interface.ts
│   │   ├── dto/ (register, login, forgot-password, reset-password, change-password)
│   │   ├── guards/ (jwt-auth.guard.ts, auth-throttler.guard.ts)
│   │   ├── strategies/jwt.strategy.ts
│   │   ├── decorators/current-user.decorator.ts
│   │   ├── mail/mail.service.ts
│   │   └── __tests__/ (4 suites Jest)
│   └── test/auth/auth_integration_test.ts
├── frontend/
│   ├── src/app/ (login, register, forgot-password, reset-password, page d'accueil)
│   ├── src/lib/ (api-client.ts, auth-context.tsx)
│   ├── tsconfig.json / next.config.js / .eslintrc.json
│   └── .env.local.example
├── docker-compose.yml
├── REVUE-TECHNIQUE-SCHEMA.md
└── README.md
```

## Autorisation, rôles et multi-entreprise (Étape 5)

### Modèle

```
User ──< UserCompany >── Company
           │
           └── Role ──< RolePermission >── Permission
```

Le rôle est porté par `UserCompany`, jamais par `User` directement : un même utilisateur peut avoir
un rôle différent dans chaque entreprise à laquelle il appartient (déjà le cas dans le schéma depuis
l'Étape 2 — aucune restructuration majeure n'a été nécessaire ici).

Les 7 rôles demandés sont des lignes `Role` **globales** (`companyId = NULL`), réutilisées par toutes
les entreprises plutôt que clonées à chaque création d'entreprise — plus simple, et cohérent avec le
fait qu'aucun mécanisme de rôle personnalisé par entreprise n'est demandé à ce stade. `SUPER_ADMIN`
existe comme ligne `Role` pour la cohérence documentaire, mais l'accès plate-forme réel passe par
`User.isSuperAdmin` (booléen, jamais positionné automatiquement), totalement indépendant de toute
`UserCompany` — un SUPER_ADMIN n'appartient à aucune entreprise et n'en a pas besoin.

### Rôles et permissions (47 permissions, format `MODULE.ACTION`)

| Rôle | Permissions | Résumé |
|---|---|---|
| `ADMIN` | 47/47 | Administration complète de l'entreprise |
| `SUPER_ADMIN` | 47/47 | Documentaire — l'accès réel passe par `isSuperAdmin`, jamais assigné via `UserCompany` |
| `ACCOUNTANT` | 39 | Gestion comptable complète (saisie, validation, contrepassation, factures, paiements, caisse, banque, fiscalité) — pas de gestion des membres ni des paramètres d'entreprise |
| `DIRECTOR` | 18 | Lecture large + pilotage budgétaire + export |
| `AUDITOR` | 16 | Lecture seule partout + audit + export, jamais d'écriture |
| `ACCOUNTING_ASSISTANT` | 15 | Saisie/consultation de base — jamais `*.VALIDATE`, `*.REVERSE`, `*.CANCEL`, `*.CLOSE`, `*.RECONCILE` |
| `VIEWER` | 13 | Consultation minimale (pas d'accès aux membres ni à l'audit) |

Matrice complète : `prisma/seed/seed_permissions_roles.sql` (source de vérité, testée — voir Tests).

### Guards

```
JwtAuthGuard          (Étape 4 — authentifie l'utilisateur)
        ↓
PermissionsGuard       (Étape 5 — vérifie, dans cet ordre :)
  1. entreprise active (Company.status === 'ACTIVE')
  2. appartenance (UserCompany existe, status === 'ACTIVE')
  3. rôle DANS CETTE entreprise précise
  4. permission(s) requise(s) — @RequirePermissions('ENTRY.VALIDATE')
```

`User.isSuperAdmin` court-circuite les points 1-4. Le `companyId` est **toujours** lu depuis le
paramètre de route (`:companyId`), jamais depuis le body ni un état de session — chaque requête est
revérifiée intégralement contre la base à chaque appel.

### Endpoints

| Méthode | Route | Permission |
|---|---|---|
| GET | `/companies` | authentifié (liste ses propres appartenances) |
| POST | `/companies` | authentifié (créateur devient ADMIN automatiquement) |
| GET | `/companies/:companyId` | `COMPANY.READ` |
| PATCH | `/companies/:companyId` | `COMPANY.UPDATE` |
| POST | `/companies/:companyId/switch` | appartenance (confirme l'accès, ne pose aucun état serveur) |
| GET | `/companies/:companyId/members` | `USER.READ` |
| POST | `/companies/:companyId/members/invite` | `USER.CREATE` |
| GET | `/companies/invitations/:token` | publique (prévisualisation sans authentification) |
| POST | `/companies/invitations/:token/accept` | authentifié |
| PATCH | `/companies/:companyId/members/:userCompanyId/role` | `USER.UPDATE` |
| POST | `/companies/:companyId/members/:userCompanyId/disable` \| `/enable` | `USER.DISABLE` |
| DELETE | `/companies/:companyId/members/:userCompanyId` | `USER.DISABLE` (retrait doux, jamais de `DELETE` physique) |

### Entreprise « active »

Aucun état "entreprise active" n'est mémorisé côté serveur entre deux requêtes. `/switch` confirme
uniquement l'accès et journalise `COMPANY_SWITCH` ; côté frontend, `currentCompanyId` (`CompanyProvider`,
`frontend/src/lib/company-context.tsx`) n'est qu'une **préférence d'affichage** persistée en
`localStorage` — jamais une frontière de sécurité : chaque appel vers `/companies/:companyId/...`
fait revérifier l'appartenance par `PermissionsGuard`.

### Invitations

`CompanyInvitation` : email + rôle + `tokenHash` (SHA-256, jamais le token en clair) + `expiresAt` +
`status` (`PENDING`/`ACCEPTED`/`EXPIRED`/`REVOKED`). Le token brut ne transite que par
`MailService.sendCompanyInvitationEmail` (jamais via `Logger`, même règle qu'en Étape 4).

### Conservation des données

`UserCompany.status` (`ACTIVE`/`DISABLED`/`REMOVED`) — jamais de suppression physique d'un membre.
Désactivation, réactivation et retrait sont tous des changements de statut tracés
(`disabledAt`/`disabledById`), la ligne reste en base pour préserver l'historique des actions
comptables déjà effectuées par ce membre.

### Audit

`COMPANY_CREATE`, `COMPANY_UPDATE`, `MEMBER_INVITE`, `MEMBER_ROLE_CHANGE`, `MEMBER_DISABLE`,
`MEMBER_ENABLE`, `MEMBER_REMOVE`, `COMPANY_SWITCH`, `PERMISSION_DENIED` — ce dernier n'enregistre
jamais que la raison catégorique (`not_a_member`, `missing_permission`, `company_inactive_or_missing`)
et les codes de permission demandés, jamais de donnée sensible.

### Frontend

`/companies` (liste), `/companies/new` (création), `/companies/[id]` (détail/édition),
`/companies/[id]/members` (gestion des membres — invitation, changement de rôle, désactivation/
réactivation/retrait), `/companies/invitations/[token]/accept` (acceptation d'invitation — gère
invitation valide/expirée/déjà utilisée/inexistante, redirige vers `/login?redirect=...` si
l'utilisateur n'est pas connecté et revient automatiquement ici après connexion), `CompanySelector`
(sélecteur dans la page d'accueil). Le token d'invitation ne vit **que** dans l'URL (paramètre de
route puis `?redirect=` de la page de connexion) — jamais copié en `localStorage`/`sessionStorage`.

### Audit de sécurité multi-tenant final (5 cas demandés)

Vérifiés par `test/authorization/final_security_test.ts` (voir Tests) :

1. **Utilisateur A (membre de A uniquement) → `GET /companies/B`** : refusé, 403 (`not_a_member`).
2. **`companyId` falsifié dans le body de la requête** : sans effet — le guard ne lit *jamais* le
   body, uniquement le paramètre `:companyId` de l'URL ; de plus `ValidationPipe({ whitelist: true,
   forbidNonWhitelisted: true })` (posé globalement dans `main.ts` dès l'Étape 1) rejette en 400 tout
   champ non déclaré dans le DTO avant même d'atteindre le service.
3. **A tente de modifier le rôle d'un membre de B** : refusé — `PermissionsGuard` bloque déjà l'accès
   à l'entreprise B avant que `getMembershipOrThrow()` ne soit atteint.
4. **Membre désactivé réutilisant une session (JWT) encore valide** : accès immédiatement bloqué —
   `PermissionsGuard` revérifie `UserCompany.status` en base à **chaque requête**, aucun état n'est
   mis en cache côté serveur ni dans le JWT lui-même.
5. **Même utilisateur, ACCOUNTANT en A / AUDITOR en B** : `ENTRY.CREATE`/`ENTRY.VALIDATE` accordés en
   A, refusés en B ; `ENTRY.READ` accordé dans les deux — la résolution des permissions se fait
   entièrement à partir du rôle **dans l'entreprise de l'URL**, jamais d'un rôle "global" de
   l'utilisateur.

### Tests

Migration déjà appliquée sur `accounting_saas` et `accounting_saas_test` (7 rôles, 47 permissions,
matrice complète — vérifié par requête directe). **Tests d'intégration PostgreSQL réels :**

| Suite | Résultat |
|---|---|
| `test/authorization/authorization_integration_test.ts` (25 scénarios demandés) | **30 PASS / 30** |
| `test/authorization/final_security_test.ts` (5 cas de sécurité finaux + cycle d'invitation) | **12 PASS / 12** |
| `test/auth/auth_integration_test.ts` (Étape 4, non régressé) | **25 PASS / 25** |
| Tests unitaires Jest (Étape 4, non régressés) | **24 PASS / 24** |
| **Total** | **91 PASS / 91** |

**Distinction test DB / service / API / frontend** (comme demandé) :
- **Test DB (réellement exécuté)** : `authorization_integration_test.ts` reproduit exactement la
  requête SQL de `PermissionsGuard.canActivate()` contre les données réellement seedées — valide le
  modèle de données et la matrice de permissions.
- **Test service (non exécuté)** : nécessiterait `Test.createTestingModule` de NestJS avec
  `PrismaService` réel → bloqué par l'indisponibilité de `prisma generate` (voir plus bas).
- **Test API/HTTP (non exécuté)** : nécessiterait Supertest sur `CompaniesController` réel (guards,
  DTO, routing inclus) → même blocage.
- **Test frontend (non exécuté)** : `tsc`/`next build`/`next lint` valident la compilation et la
  correction statique, mais aucun test de rendu (React Testing Library) n'a été écrit à ce stade.



## Exercices comptables et plan comptable SYSCOHADA (Étape 6)

### Inventaire avant modification (résumé)

Déjà présents et réutilisés tels quels : `AccountingPeriod` (statuts `OPEN`/`CLOSED`/`LOCKED`,
`closedAt`/`closedById`/`reopenedAt`/`reopenedById`/`reopenReason` — tous déjà posés depuis la revue
technique de l'Étape 2/3), la contrainte PostgreSQL anti-chevauchement des exercices (Étape 3, **non
supprimée**), le système RBAC complet (Étape 5, réutilisé sans nouveau mécanisme d'autorisation),
`AuditLog`. Incomplets : `Account` existait mais avec une classe comptable en **enum figé**
(`CLASS_1`…`CLASS_9`, sans métadonnées) plutôt qu'en données, aucun modèle de référentiel, aucun
niveau hiérarchique ni distinction compte de mouvement/regroupement. Absents : modules
`accounting-periods` et plan comptable (contrôleurs/services vides), permissions dédiées, import CSV,
pages `/settings/accounting/*`.

### Référentiel comptable — architecture

```
AccountingFramework (SYSCOHADA Révisé, PCG français...)
        ↓
   AccountClass (classes 1 à 9, données : code/nom/description/nature/catégorie/ordre)
        ↓
      Account (companyId, frameworkId, accountClassId, code, label, parentId, level, isPostable...)
```

`AccountClass` **remplace** l'ancien enum `AccountClass` figé (migration avec reprise des 12 comptes
existants, aucune perte de données — vérifié par requête directe). Le référentiel (`AccountingFramework`)
est strictement séparé du pays de l'entreprise — `Company.country` et `Company.accountingFrameworkId`
sont deux champs indépendants. Une entreprise reçoit SYSCOHADA Révisé par défaut à sa création
(`CompaniesService.createCompany`) ; un second référentiel (`PCG_FR`) existe en structure pour prouver
que l'architecture n'est pas couplée à SYSCOHADA, mais **sans classes seedées** (voir limite ci-dessous).

**Limite assumée et documentée** (cahier des charges §5/§20) : n'ayant pas accès à une source
officielle et autorisée du plan comptable SYSCOHADA complet, seules les **9 classes** (avec
métadonnées complètes) sont seedées comme référentiel structurel. Les comptes de démonstration
utilisés dans les tests (ex. `401000 Fournisseurs`, `701000 Ventes`) sont des exemples **clairement
identifiés comme tels dans ce document** — jamais présentés comme le plan SYSCOHADA officiel complet.
Une entreprise réelle doit construire ou importer son propre plan comptable détaillé (voir Import CSV).

### Structure d'un compte

`code`, `label`, `accountClassId` (→ classe → référentiel), `parentId`, `level` (profondeur —
recalculée par le service, **jamais déduite de la longueur du code**), `isPostable` (compte de
mouvement vs regroupement), `isAuxiliary`, `isActive`, `companyId`. Défense en profondeur : un
trigger PostgreSQL (`fn_set_account_framework_id`) impose que `framework_id` soit toujours celui de
la classe choisie, et rejette la création si cette classe n'appartient pas au référentiel de
l'entreprise — même en cas d'INSERT direct en base.

**Cycles hiérarchiques** : `parentId` n'est volontairement **pas modifiable** après création
(`UpdateAccountDto` ne l'expose pas) — un compte ne peut donc jamais devenir son propre ancêtre, le
risque de cycle est éliminé par construction plutôt que détecté à l'exécution. Un futur besoin de
« déplacer » un compte (Étape 7+) devra introduire un endpoint dédié avec sa propre détection de
cycle (algorithme déjà écrit et testé dans `test/accounting-setup/accounting_setup_extra_test.ts`,
prêt à être branché).

### Exercices comptables

Aucune modification du modèle `AccountingPeriod` n'a été nécessaire (déjà complet depuis l'Étape 2/3).
Nouveau : module `accounting-periods` (service + contrôleur) exposant création (avec pré-validation
applicative des dates et du chevauchement, en plus de la contrainte SQL déjà existante), clôture,
réouverture. La réouverture reste volontairement plus restrictive : permission dédiée
`ACCOUNTING_PERIOD.REOPEN` non accordée à `ACCOUNTING_ASSISTANT` ni `ACCOUNTANT`... si — accordée à
`ACCOUNTANT` pour la clôture mais **pas** pour la réouverture (seul `ADMIN`/`SUPER_ADMIN`), motif
obligatoire (`@MinLength(10)` sur le DTO), toujours audité avec le motif conservé dans `audit_logs`.

### Plan comptable par entreprise

Une entreprise peut créer ses propres comptes sous les classes du référentiel, avec sous-comptes
(`parentId`), modifier un libellé, désactiver un compte inutilisé (`ACCOUNT.DISABLE`/`ACCOUNT.ENABLE`
— **jamais de suppression physique**, cohérent avec la philosophie de conservation de l'historique
posée dès l'Étape 2).

### Endpoints

| Méthode | Route | Permission |
|---|---|---|
| GET | `/companies/:companyId/accounting-periods` | `ACCOUNTING_PERIOD.READ` |
| GET | `/companies/:companyId/accounting-periods/:id` | `ACCOUNTING_PERIOD.READ` |
| POST | `/companies/:companyId/accounting-periods` | `ACCOUNTING_PERIOD.CREATE` |
| POST | `/companies/:companyId/accounting-periods/:id/close` | `ACCOUNTING_PERIOD.CLOSE` |
| POST | `/companies/:companyId/accounting-periods/:id/reopen` | `ACCOUNTING_PERIOD.REOPEN` (restrictive) |
| GET | `/companies/:companyId/accounts` | `ACCOUNT.READ` |
| GET | `/companies/:companyId/accounts/tree` | `ACCOUNT.READ` |
| GET | `/companies/:companyId/accounts/:id` | `ACCOUNT.READ` |
| GET | `/companies/:companyId/accounts/:id/children` | `ACCOUNT.READ` |
| POST | `/companies/:companyId/accounts` | `ACCOUNT.CREATE` |
| PATCH | `/companies/:companyId/accounts/:id` | `ACCOUNT.UPDATE` |
| POST | `/companies/:companyId/accounts/:id/disable` \| `/enable` | `ACCOUNT.DISABLE` / `ACCOUNT.ENABLE` |
| POST | `/companies/:companyId/accounts/import` | `ACCOUNT.IMPORT` |
| GET | `/accounting-frameworks` | authentifié (référentiels globaux, pas de scope entreprise) |

Routes préfixées `/companies/:companyId/...`, cohérent avec la convention déjà établie en Étape 5
(`/companies/:companyId/members`) plutôt que le `/accounts` racine suggéré en exemple — adapté aux
conventions existantes du projet, comme demandé.

### Import CSV

`POST /companies/:companyId/accounts/import` — corps JSON `{ csvContent: string }` (pas d'upload
multipart : le frontend lit le fichier via l'API `File` du navigateur et envoie son contenu texte,
jamais loggé). Format : `code;label;parentCode;class;allowsPosting`. Validations : doublons dans le
fichier, doublons contre la base, classe inconnue pour le référentiel, parent introuvable (ni en
base ni dans le fichier), cycles de parenté. **Transactionnel strict** : la moindre erreur annule
l'import complet — vérifié explicitement (aucune ligne valide n'est conservée si une ligne du milieu
du fichier échoue).

### Permissions ajoutées

`ACCOUNTING_PERIOD.READ/CREATE/CLOSE/REOPEN`, `ACCOUNT.DISABLE/ENABLE/IMPORT` (7 nouvelles ;
`ACCOUNT.READ/CREATE/UPDATE` existaient déjà depuis l'Étape 5). Matrice mise à jour et vérifiée : 54
permissions au total, réparties par rôle — `ACCOUNTING_PERIOD.REOPEN` réservée à `ADMIN`/`SUPER_ADMIN`.

### Frontend

`/settings/accounting` (sommaire), `/settings/accounting/framework` (référentiel et classes),
`/settings/accounting/periods` (liste, création, clôture, réouverture avec boîte de dialogue exigeant
un motif), `/settings/accounting/accounts` (arbre hiérarchique par classe, recherche, filtre,
création, activation/désactivation, **import CSV** avec prévisualisation avant confirmation).
Réutilise `CompanySelector`/`useCompany`/`useAuth`/`apiClient` existants sans nouveau mécanisme.

### Tests (Étape 6)

| Suite | Résultat |
|---|---|
| `test/accounting-setup/accounting_setup_test.ts` (28 scénarios : exercices 1-10, comptes 11-20, import 21-26) | **28 PASS / 28** |
| `test/accounting-setup/accounting_setup_extra_test.ts` (parent incohérent, cycles, erreur milieu de fichier) | **6 PASS / 6** |
| Régression — Jest (Étape 4) | **24 PASS / 24** |
| Régression — auth_integration_test | **25 PASS / 25** |
| Régression — authorization_integration_test | **30 PASS / 30** |
| Régression — final_security_test | **12 PASS / 12** |
| **Total cumulé** | **125 PASS / 125** |

Backend : `tsc --noEmit` (0 erreur), `nest build` (succès), ESLint (0 erreur). Frontend : `tsc --noEmit`
(0 erreur), `next build` (succès, 15 routes), `next lint` (0 avertissement après correction d'une
dépendance manquante dans un `useEffect`).



## Journaux et moteur de saisie des écritures comptables (Étape 7)

### Inventaire avant modification (résumé)

Quasiment tout existait déjà et a été réutilisé sans modification structurelle : `Journal`,
`AccountingEntry`, `AccountingEntryLine` (modèle complet depuis l'Étape 2/3, y compris
`reversalOfEntryId`), tous les triggers PostgreSQL (`fn_check_entry_balance`,
`fn_protect_validated_entries`, `fn_protect_validated_entry_lines`,
`fn_prevent_entry_in_closed_period`), `fn_next_document_number`, et la quasi-totalité des permissions
(`ENTRY.*`, `JOURNAL.*`, déjà seedées et bien réparties par rôle depuis l'Étape 5). Seules 3
permissions manquaient (`ENTRY.DELETE`, `JOURNAL.DISABLE`, `JOURNAL.ENABLE`) — ajoutées par seed
additif. Les modules `journals` et `accounting-entries` étaient des stubs vides, entièrement
implémentés à cette étape.

### Modèle de ligne d'écriture — précision importante

Le modèle `AccountingEntryLine` (Étape 2/3) utilise un couple `side` (`DEBIT`/`CREDIT`) + `amount`
unique, **pas** deux colonnes séparées `debit`/`credit` comme suggéré en exemple dans le cahier des
charges. Ce modèle existant a été conservé tel quel (aucun modèle parallèle créé) ; le DTO
`CreateAccountingEntryLineDto` accepte `debit`/`credit` séparément côté API (plus naturel pour la
saisie), et le service les convertit en `side`/`amount` avant écriture.

### Statuts et immuabilité

Réutilise `EntryStatus` (`DRAFT`/`VALIDATED`/`REVERSED`, Étape 2/3) sans modification. Toutes les
règles d'immuabilité proviennent des triggers PostgreSQL de l'Étape 3, jamais contournés :
- `trg_a_check_entry_balance` : recalcule débit/crédit depuis les lignes à chaque passage à
  `VALIDATED`, rejette si déséquilibré ou si moins de 2 lignes.
- `trg_b_protect_validated_entries` / `trg_b_protect_validated_entry_lines` : bloque toute
  modification/suppression d'une écriture ou d'une ligne dès que le statut n'est plus `DRAFT`.
- `trg_c_prevent_entry_in_closed_period` : bloque toute création/déplacement/validation dans un
  exercice non `OPEN`.

**Bug réel détecté et corrigé pendant les tests** : la méthode `reverse()` créait initialement la
contrepassation directement en statut `VALIDATED` avec ses lignes imbriquées en un seul appel
Prisma — `trg_a_check_entry_balance` s'exécute avant l'insertion des lignes enfants et voyait donc 0
ligne, rejetant systématiquement l'opération. Corrigé : création en `DRAFT` avec ses lignes, puis
passage à `VALIDATED` dans un second appel — même pattern que pour une écriture normale.

### Exercice comptable — toujours redéterminé côté serveur

Conformément au cahier des charges, `periodId` n'est **jamais** accepté depuis le client : le service
recherche systématiquement l'exercice couvrant la date de l'écriture (`findOpenPeriodForDate`),
vérifie qu'il appartient à l'entreprise et qu'il est `OPEN`, et l'utilise — y compris pour la date de
contrepassation, qui peut différer de la date de l'écriture d'origine.

### Numérotation

Réutilise `fn_next_document_number` (Étape 3) sans modification, avec `scopeKey` = code du journal
(chaque journal a sa propre séquence : `VEN-000001`, `ACH-000001`...). Aucune logique `SELECT
MAX(number) + 1` introduite.

### Endpoints

| Méthode | Route | Permission |
|---|---|---|
| GET/POST | `/companies/:companyId/journals` | `JOURNAL.READ` / `JOURNAL.CREATE` |
| PATCH | `/companies/:companyId/journals/:id` | `JOURNAL.UPDATE` |
| POST | `/companies/:companyId/journals/:id/disable` \| `/enable` | `JOURNAL.DISABLE` / `JOURNAL.ENABLE` |
| GET | `/companies/:companyId/accounting-entries` (filtres : période, journal, statut, compte, recherche, pagination) | `ENTRY.READ` |
| GET | `/companies/:companyId/accounting-entries/:id` | `ENTRY.READ` |
| POST | `/companies/:companyId/accounting-entries` | `ENTRY.CREATE` |
| PATCH | `/companies/:companyId/accounting-entries/:id` (DRAFT uniquement) | `ENTRY.UPDATE` |
| DELETE | `/companies/:companyId/accounting-entries/:id` (DRAFT uniquement) | `ENTRY.DELETE` |
| POST | `/companies/:companyId/accounting-entries/:id/validate` | `ENTRY.VALIDATE` |
| POST | `/companies/:companyId/accounting-entries/:id/reverse` | `ENTRY.REVERSE` |

Convention `/companies/:companyId/...` cohérente avec les Étapes 5/6 (companyId toujours issu de
l'URL authentifiée via `PermissionsGuard`, jamais du body).

### Frontend

`/accounting/journals`, `/accounting/entries` (liste filtrable), `/accounting/entries/new` (saisie
avec contrôle débit/crédit en temps réel, autocomplétion de comptes actifs/postables uniquement,
bouton « Valider » désactivé si déséquilibré), `/accounting/entries/[id]` (détail, actions selon
statut), `/accounting/entries/[id]/edit` (modification de brouillon).

### Tests (Étape 7)

| Suite | Résultat |
|---|---|
| `test/accounting-entries/accounting_entries_test.ts` (journaux 1-6, écritures 7-24, contrepassation 25-31, audit 35-38) | **32 PASS / 32** |
| `test/accounting-entries/concurrency_test.ts` (32-34 : numérotation, validation, contrepassation concurrentes — vraies connexions PostgreSQL parallèles) | **3 PASS / 3** |
| `test/accounting-entries/critical_scenario_test.ts` (§39 : montants exacts, compte non postable) | **3 PASS / 3** |
| Régression (Jest, auth, autorisation, exercices/plan comptable) | **99 PASS / 99** |
| **Total cumulé (toutes étapes)** | **163 PASS / 163** |

Backend : `tsc --noEmit` (0 erreur), `nest build` (succès), ESLint (0 erreur). Frontend : `tsc
--noEmit` (0 erreur), `next build` (succès, 20 routes), `next lint` (0 avertissement).

## Grand livre, balance générale et consultation comptable (Étape 8)

### Inventaire avant modification (résumé)

Tout le socle nécessaire existait déjà et a été réutilisé sans modification structurelle :
`AccountingEntry`/`AccountingEntryLine` (modèle `side`+`amount`, pas de colonnes débit/crédit
séparées), les index `(company_id, entry_date)`, `(company_id, status)`, `(company_id, period_id)`
sur `accounting_entries` et `(company_id, account_id)` sur `accounting_entry_lines` (tous posés dès
la migration initiale de l'Étape 2/3 — **aucune nouvelle migration n'a été nécessaire**, l'inventaire
a confirmé qu'ils couvraient exactement les besoins des requêtes de rapport), et les permissions
`REPORT.READ`/`REPORT.EXPORT` (déjà seedées et réparties par rôle depuis l'Étape 5 — **aucune
nouvelle permission créée**). Seul le module `reports` était un stub vide, entièrement implémenté à
cette étape.

### Règle comptable centrale : traitement des écritures REVERSED

Conformément au cahier des charges (§2), les rapports de cette étape incluent les écritures de
statut **`VALIDATED` et `REVERSED`** — jamais `DRAFT`. Une écriture contrepassée (`REVERSED`) reste un
mouvement réellement comptabilisé historiquement ; l'exclure des rapports romprait l'égalité
fondamentale débit = crédit sur l'ensemble de la comptabilité (la contrepassation resterait visible,
mais pas l'écriture qu'elle annule). Le filtre utilisé partout dans `reports.service.ts` est donc
`status <> 'DRAFT'`, jamais `status = 'VALIDATED'` seul. Testé explicitement : après contrepassation,
l'écriture originale (REVERSED) et sa contrepassation (VALIDATED) apparaissent TOUTES LES DEUX dans
le grand livre du compte concerné, avec un effet net nul sur la paire.

### Convention de calcul du solde

Le modèle `AccountingEntryLine` ne porte pas de notion de « sens naturel » par compte. Ce service
adopte donc la convention universelle documentée explicitement dans le code :
**solde = total débit − total crédit** ; solde ≥ 0 → affiché en solde débiteur, solde < 0 → affiché
en solde créditeur (valeur absolue). Appliquée identiquement au grand livre et à la balance.

### Grand livre

Solde initial = mouvements strictement antérieurs à la date de début (jamais depuis des écritures
DRAFT). Solde progressif calculé par **fonction fenêtrée PostgreSQL**
(`SUM() OVER (ORDER BY entry_date, entry_number, line_number ROWS UNBOUNDED PRECEDING)`) — le calcul
porte sur l'ensemble des lignes filtrées avant application de `LIMIT`/`OFFSET`, donc la pagination
n'introduit aucune erreur de solde progressif. Comptes non postables : gérés proprement (« aucun
mouvement », jamais d'erreur). Filtres : exercice/dates, journal, recherche (numéro ou libellé),
pagination (`page`/`pageSize`/`total`/`totalPages`).

### Balance générale

Une seule requête SQL agrégée (`SUM`/`GROUP BY`, aucune boucle applicative par compte, aucun N+1) :
colonnes Débit/Crédit = mouvements strictement de la période sélectionnée ; colonnes Solde
débiteur/créditeur = solde **cumulé depuis l'origine jusqu'à la fin de la période** (convention
documentée explicitement — distincte des mouvements de période, comme une balance de vérification
classique intègre le report à nouveau). Filtres : période, classe comptable (via
`AccountClass`/`AccountingFramework` existants, aucune classe codée en dur), recherche compte
(préfixe ou libellé). Contrôle d'intégrité (`periodBalanced`/`cumulativeBalanced`) toujours affiché,
jamais masqué en cas d'écart — bien qu'un écart ne devrait jamais se produire grâce aux triggers de
l'Étape 3.

### Export CSV

`GET .../ledger/export` et `GET .../trial-balance/export` réutilisent EXACTEMENT les mêmes méthodes
de service que l'affichage (mêmes filtres, mêmes règles, aucune divergence possible entre ce que
l'utilisateur voit et ce qu'il exporte). Génération compatible Excel : BOM UTF-8, séparateur `;`,
échappement RFC 4180 correct (jamais de concaténation naïve par virgule — une valeur contenant `;`,
`"` ou un retour à la ligne est entourée de guillemets doublés). Contenu jamais loggé.

### Endpoints

| Méthode | Route | Permission |
|---|---|---|
| GET | `/companies/:companyId/reports/accounts/:accountId/ledger` | `REPORT.READ` |
| GET | `/companies/:companyId/reports/trial-balance` | `REPORT.READ` |
| GET | `/companies/:companyId/reports/accounts/:accountId/ledger/export` | `REPORT.EXPORT` |
| GET | `/companies/:companyId/reports/trial-balance/export` | `REPORT.EXPORT` |

`companyId` provient exclusivement du paramètre d'URL authentifié via `PermissionsGuard` (jamais du
body ni d'un paramètre de requête alternatif — vérifié explicitement par test).

### Performance et index

Inventaire des index PostgreSQL effectué avant toute décision : les index existants
`(company_id, entry_date)`, `(company_id, status)`, `(company_id, period_id)` sur
`accounting_entries` et `(company_id, account_id)` sur `accounting_entry_lines` couvrent exactement
les besoins des requêtes de grand livre et de balance. **Aucun nouvel index créé** — conformément à
la consigne « ne pas créer automatiquement, inspecter d'abord ». Test de volumétrie (200+ écritures
supplémentaires) : requête de balance agrégée exécutée en quelques millisecondes.

### Permissions

`REPORT.READ` et `REPORT.EXPORT` — **aucune nouvelle permission créée**, la matrice existante depuis
l'Étape 5 couvrait déjà exactement les besoins (READ pour tous les rôles y compris VIEWER, EXPORT
réservé aux rôles avec responsabilité comptable).

### Frontend

`/accounting/general-ledger` (sélection de compte, filtres date/journal/recherche, tableau avec
solde progressif, pagination, export), `/accounting/trial-balance` (filtres période/classe/compte,
tableau avec totaux, indicateur ✓/⚠ d'équilibre, export).

### Tests (Étape 8)

| Suite | Résultat |
|---|---|
| `test/reports/reports_test.ts` (grand livre 1-16, balance 17-28, cohérence 29-32, sécurité 33-37, performance 38-40) | **35 PASS / 35** |
| Régression complète (Jest + auth + autorisation + Étape 6 + Étape 7 + concurrence + scénario critique) | **163 PASS / 163** |
| **Total cumulé (toutes étapes)** | **198 PASS / 198** |

Backend : `tsc --noEmit` (0 erreur), `nest build` (succès), ESLint (0 erreur). Frontend : `tsc
--noEmit` (0 erreur), `next build` (succès, 22 routes), `next lint` (0 avertissement).

## Lettrage des comptes de tiers (Étape 9)

### Objectif et définition

Le lettrage rapproche les mouvements débit et crédit d'un même compte pour identifier les opérations
soldées (ex. une facture client et son règlement). Un groupe de lignes est lettré lorsque
`SUM(débit) = SUM(crédit)` sur l'ensemble des lignes rattachées.

### Inventaire avant modification (résumé)

Le modèle `Lettering` existait déjà, complet, depuis l'Étape 2/3 : `code`, `companyId`, `accountId`,
`isBalanced`, `canceledAt`/`canceledById` (délettrage), relation vers `AccountingEntryLine`. Le
trigger `fn_check_lettering_balance` (Étape 3) vérifiait déjà exactement la règle demandée (somme
nulle, au moins 2 lignes) — réutilisé strictement sans modification. La classe comptable **4 —
Comptes de tiers** existait déjà dans `AccountClass` (Étape 6) et sert de métadonnée pour identifier
les comptes concernés, sans jamais coder un code de compte (401/411...) en dur.

### Modification de schéma réellement nécessaire

**Une seule** modification a été nécessaire, identifiée par inventaire : le trigger
`fn_protect_validated_entry_lines` (Étape 3) bloquait *toute* modification d'une ligne d'écriture
VALIDATED/REVERSED, y compris `lettering_id` — seul mécanisme par lequel le lettrage peut fonctionner
(une ligne DRAFT n'est jamais lettrable). Migration `20260823100000_lettering_engine` : le trigger
autorise désormais explicitement un UPDATE qui **ne change que `lettering_id`** — tout autre champ
(montant, sens, compte, date, libellé, tiers) reste strictement protégé, vérifié par test explicite
(modification du libellé toujours bloquée après cette migration). Ajout complémentaire de `LETTERING`
à l'enum `SequenceDocumentType` pour réutiliser `fn_next_document_number` (numérotation atomique
existante, Étape 3/7) plutôt que d'inventer un nouveau compteur.

### Comptes concernés — restriction stricte aux comptes de tiers

Le lettrage n'est autorisé que sur les comptes dont la classe comptable (`AccountClass.code`) est
**"4"** — identifiés via la métadonnée du référentiel, jamais via un code de compte en dur. Un compte
de charge, de produit ou de trésorerie, même postable, est explicitement refusé par le service à la
création d'un lettrage (message d'erreur explicite indiquant la classe trouvée vs attendue).

### Workflow — création puis clôture

1. `POST .../lettering` — sélection de lignes déjà équilibrées (vérifiées par recalcul serveur, jamais
   par le montant envoyé par le client), création du `Lettering` (`isBalanced=false`) et rattachement
   atomique des lignes.
2. `POST .../lettering/:id/close` — recalcul du solde depuis la base, bascule `isBalanced=true` : c'est
   cette transition que le trigger `fn_check_lettering_balance` vérifie réellement (défense en
   profondeur). Correspond à l'UX en deux temps (aperçu puis confirmation explicite avant clôture).

### Lettrage partiel

Le modèle n'admet que des lettrages équilibrés (règle du trigger, conservée sans modification). Un
« lettrage partiel » n'est donc jamais représenté par un objet `Lettering` déséquilibré : le reliquat
reste simplement une ligne non lettrée (`lettering_id IS NULL`), disponible pour un futur lettrage dès
qu'une contrepartie complète le solde à zéro. Exemple testé : facture 1 000 000 + règlement 600 000 →
aucun lettrage créé (reliquat 400 000) ; un second règlement de 400 000 permet alors de lettrer les 3
lignes ensemble en un seul `Lettering`.

### Délettrage

`POST .../lettering/:id/unletter` — détache toutes les lignes (`lettering_id = NULL`) et marque
`canceledAt`/`canceledById`, dans une transaction unique. Ne modifie **jamais** `AccountingEntry` ni
`AccountingEntryLine.amount`/`side`/date/compte — vérifié explicitement par test (montants et
écritures inchangés avant/après délettrage).

### Suggestions automatiques

`POST .../lettering/suggestions` — calcul en lecture seule, aucune écriture en base. Deux passes :
correspondances exactes 1↔1 (confiance « forte »), puis combinaisons multi-lignes bornées à 3 crédits
maximum (confiance « moyenne »). Jamais présenté comme un lettrage confirmé — l'utilisateur doit
explicitement sélectionner puis valider via le workflow normal.

### Concurrence

Deux lettrages simultanés sur la même ligne : le service revérifie `lettering_id IS NULL` dans la
clause `WHERE` de l'`UPDATE` d'association ; si le nombre de lignes affectées diffère du nombre
attendu, toute la transaction est annulée (`ConflictException`). Testé avec deux vraies connexions
PostgreSQL parallèles — un seul lettrage réussit, l'autre échoue proprement, aucun état incohérent.

### Permissions

`LETTERING.READ/CREATE/CLOSE/UNLETTER/AUTO` — **aucune permission équivalente n'existait**, ajoutées
et réparties dans la matrice RBAC existante (ADMIN/SUPER_ADMIN : tout ; ACCOUNTANT : tout sauf lecture
seule sur les autres ; ACCOUNTING_ASSISTANT : READ/CREATE/AUTO seulement, cohérent avec l'absence de
ENTRY.VALIDATE pour ce rôle ; DIRECTOR/AUDITOR/VIEWER : READ seul).

### Endpoints

| Méthode | Route | Permission |
|---|---|---|
| GET | `/companies/:companyId/accounts/:accountId/unlettered-lines` | `LETTERING.READ` |
| GET | `/companies/:companyId/lettering` | `LETTERING.READ` |
| GET | `/companies/:companyId/lettering/:id` | `LETTERING.READ` |
| POST | `/companies/:companyId/lettering` | `LETTERING.CREATE` |
| POST | `/companies/:companyId/lettering/:id/close` | `LETTERING.CLOSE` |
| POST | `/companies/:companyId/lettering/:id/unletter` | `LETTERING.UNLETTER` |
| POST | `/companies/:companyId/lettering/suggestions` | `LETTERING.AUTO` |

### Grand livre (Étape 8) — adaptation

Colonne « Lettrage » ajoutée (jointure `LEFT JOIN letterings` sur `lettering_id`) — additif uniquement,
**aucune modification** du calcul du solde progressif ni de la convention débit-crédit existante.

### Frontend

`/accounting/lettering` (comptes de tiers, recherche, liste des lettrages), `/accounting/lettering/account/[accountId]`
(sélection de lignes, totaux temps réel, suggestions, confirmation de clôture), `/accounting/lettering/[id]`
(détail, délettrage avec confirmation).

### Tests (Étape 9)

| Suite | Résultat |
|---|---|
| `test/lettering/lettering_test.ts` (base 1-14, partiel 15-18, clôture 19-22, délettrage 23-25, sécurité 26-34, grand livre 43-45) | **29 PASS / 29** |
| `test/lettering/concurrency_test.ts` (35-38, vraies connexions parallèles) | **3 PASS / 3** |
| `test/lettering/suggestions_test.ts` (39-42) | **4 PASS / 4** |
| `test/lettering/security_test.ts` (compte non-tiers, unicité de code, double lettrage) | **6 PASS / 6** |
| Régression (Jest + auth + autorisation + Étapes 6-8 + concurrence + scénario critique) | **198 PASS / 198** |
| **Total cumulé (toutes étapes)** | **240 PASS / 240** |

Backend : `tsc --noEmit` (0 erreur), `nest build` (succès), ESLint (0 erreur). Frontend : `tsc
--noEmit` (0 erreur), `next build` (succès, 25 routes), `next lint` (0 avertissement).

## Clients, fournisseurs, devis, factures et paiements (Étape 10)

### Inventaire avant modification (résumé)

`Customer`, `Supplier`, `Quote`, `QuoteItem`, `Invoice`, `InvoiceItem`, `Payment` existaient déjà
(schéma initial, Étape 2), avec `DocumentStatus`/`PaymentDirection`/`PaymentMethod`/`PartnerType`
déjà définis et `SequenceDocumentType` couvrant déjà `QUOTE`/`INVOICE`/`PAYMENT`. `Invoice` gère déjà
vente ET achat via `invoiceType` (`SALE`/`PURCHASE`) — **aucun second modèle de facture créé**.
`AccountingEntryLine.partnerType`/`partnerId` (Étape 2) fournit déjà le mécanisme de rattachement
d'une ligne à un tiers — réutilisé tel quel pour le calcul des soldes et l'intégration au lettrage.
14 permissions existaient déjà (`CUSTOMER.*`, `SUPPLIER.*`, `INVOICE.*`, `PAYMENT.*` partiels). Les 5
modules backend (`customers`, `suppliers`, `quotes`, `invoices`, `payments`) étaient des stubs vides.

### Modifications de schéma réellement nécessaires

Deux migrations, chacune justifiée par un manque fonctionnel concret identifié à l'inventaire :

1. **`Customer.accountId` / `Supplier.accountId`** (+ `InvoiceItem.accountId`, `Invoice.taxAccountId`)
   — le cahier des charges exige un compte comptable associé pour générer les écritures sans jamais
   coder de numéro de compte en dur ; ces champs référencent le plan comptable réel de l'entreprise
   (validé côté service : compte de tiers classe 4 pour `Customer`/`Supplier`, compte postable pour
   les comptes de produit/charge/TVA).
2. **Table `PaymentAllocation`** — `Payment.invoiceId` n'était qu'une FK unique vers une seule
   facture, incapable de représenter un paiement réparti sur plusieurs factures (§10 du cahier des
   charges). Trigger `fn_check_allocation_not_overpaid` en défense en profondeur.

### Bug de concurrence réel détecté et corrigé

Les tests avec deux connexions PostgreSQL parallèles ont révélé que `fn_check_allocation_not_overpaid`
ne verrouillait pas la ligne de la facture avant de calculer la somme des affectations — sous
isolation READ COMMITTED, deux transactions concurrentes pouvaient chacune passer le contrôle avant
que l'autre ne committe (race MVCC classique), permettant une sur-affectation. **Corrigé** :
`SELECT total FROM invoices WHERE id = NEW.invoice_id FOR UPDATE` avant le calcul — même principe que
le verrouillage déjà utilisé pour la contrepassation (Étape 7). Revérifié par test de concurrence
réel après correction (34/34 PASS).

### Workflow devis → facture

`DRAFT → SENT → ACCEPTED/REFUSED`, puis conversion atomique (`convertToInvoice`). La protection
anti-double-conversion repose sur la contrainte `@@unique` déjà présente sur `Invoice.quoteId`
(Étape 2) : si deux requêtes concurrentes passent la vérification applicative en même temps, une
seule insertion réussit, la seconde échoue proprement sur la contrainte PostgreSQL — **aucun nouveau
mécanisme de verrouillage inventé**, réutilisation pure. Testé avec deux connexions réelles.

### Génération des écritures comptables

Même pattern DRAFT → lignes → VALIDATED que l'Étape 7 (jamais de création directe VALIDATED avec
lignes imbriquées — le bug de ce type déjà corrigé à l'Étape 7 pour la contrepassation aurait pu se
reproduire ici, évité par construction).

- **Facture de vente** : Débit compte client (TTC, `partnerType=CUSTOMER`) / Crédit comptes de
  produits (HT par ligne) + Crédit TVA collectée si applicable.
- **Facture d'achat** : Débit comptes de charges (HT par ligne) + Débit TVA récupérable / Crédit
  compte fournisseur (TTC, `partnerType=SUPPLIER`).
- **Encaissement** : Débit trésorerie / Crédit compte client.
- **Décaissement** : Débit compte fournisseur / Crédit trésorerie.

Le journal est sélectionné automatiquement (premier journal actif du type `SALES`/`PURCHASES`/`CASH`/
`BANK` de l'entreprise — réutilise le module `journals` de l'Étape 7, n'en crée jamais un nouveau).
L'exercice comptable est **toujours** redéterminé côté serveur depuis la date de la facture/du
paiement (jamais fourni par le client), même règle qu'à l'Étape 7.

### Affectation des paiements

Un paiement peut être réparti sur plusieurs factures (`PaymentAllocation`), et une facture peut
recevoir plusieurs paiements partiels. Le statut de la facture (`PARTIALLY_PAID`/`PAID`) est
recalculé depuis la somme réelle des affectations, jamais depuis `Payment.amount` seul.

### Annulation

Une facture émise annulée déclenche une **contrepassation** de son écriture liée (même pattern
qu'à l'Étape 7 — création DRAFT + lignes inversées, passage VALIDATED, marquage REVERSED de
l'originale), jamais une modification directe. Une facture payée ou partiellement payée ne peut pas
être annulée directement.

### Intégration avec le lettrage (Étape 9)

Aucune modification du moteur de lettrage. Les lignes générées par les factures/paiements portent
`accountId` (compte de tiers) + `partnerType`/`partnerId`, ce qui les rend immédiatement lettrables
via le mécanisme existant. Testé explicitement : une facture (ligne débit) et ses deux paiements
(lignes crédit) ont été lettrés ensemble avec succès, puis délettrés — aucune modification du moteur
de l'Étape 9 nécessaire.

### Comptes de trésorerie — limite assumée

Les modules `cash`/`bank` (gestion complète de la trésorerie) restent des stubs non implémentés,
hors périmètre de cette étape (réservés à une étape ultérieure). Un endpoint minimal en lecture seule
(`GET .../payments/treasury-accounts`) a été ajouté pour permettre de sélectionner un compte de
caisse/banque déjà existant en base lors de la création d'un paiement — sans construire de CRUD
complet de gestion de trésorerie.

### Permissions

9 ajoutées (`CUSTOMER.DISABLE`, `SUPPLIER.DISABLE`, `QUOTE.READ/CREATE/UPDATE/SEND/ACCEPT/REJECT/
CONVERT`, `PAYMENT.UPDATE`) — 14 existaient déjà et ont été réutilisées sans modification. 72
permissions au total.

### Endpoints (résumé)

`/companies/:companyId/customers` (+`/balance`, `/history`, `/disable`, `/enable`),
`/companies/:companyId/suppliers` (symétrique), `/companies/:companyId/quotes` (+`/send`, `/accept`,
`/reject`, `/cancel`, `/convert`), `/companies/:companyId/invoices` (+`/issue`, `/cancel`),
`/companies/:companyId/payments` (+`/cancel`, `/treasury-accounts`).

### Frontend

`/customers` (liste/new/détail avec solde et historique/edit), `/suppliers` (symétrique),
`/accounting/quotes` (liste/new avec calcul HT/TVA/TTC en temps réel/détail avec workflow),
`/accounting/invoices` (liste/new/détail avec émission et annulation), `/accounting/payments`
(liste/new avec sélection multi-factures et calcul de solde restant/détail).

### Tests (Étape 10)

| Suite | Résultat |
|---|---|
| `test/customers-suppliers/step10_test.ts` (clients, fournisseurs, devis, conversion, factures, paiements, affectation, sur-affectation, concurrence, lettrage intégré, sécurité) | **34 PASS / 34** |
| `test/customers-suppliers/step10_extra_test.ts` (factures fournisseurs, concurrence code client, numérotation concurrente, membership désactivée) | **7 PASS / 7** |
| Régression complète (Jest + auth + autorisation + Étapes 6-9) | **240 PASS / 240** |
| **Total cumulé (toutes étapes)** | **281 PASS / 281** |

Backend : `tsc --noEmit` (0 erreur), `nest build` (succès), ESLint (0 erreur). Frontend : `tsc
--noEmit` (0 erreur), `next build` (succès, 40 routes), `next lint` (0 avertissement).

## Trésorerie — caisse, banques, rapprochement bancaire (Étape 11)

### Inventaire avant modification (résumé)

`CashAccount`, `CashTransaction`, `BankAccount`, `BankTransaction`, `BankReconciliation`
existaient déjà (schéma initial, Étape 2) — y compris `isReconciled`/`reconciliationId` sur
`BankTransaction`, prévus dès l'origine. 6 permissions existaient déjà (`BANK.CREATE/READ/
RECONCILE`, `CASH.CLOSE/CREATE/READ`). Les 3 modules backend (`cash`, `bank`,
`bank-reconciliation`) étaient des stubs vides.

### Modifications de schéma réellement nécessaires

Deux migrations, chacune justifiée par un manque fonctionnel concret :

1. **`code`/`description` sur `CashAccount`, `code`/`name`/`swiftBic`/`description` sur
   `BankAccount`** — champs explicitement requis par le cahier des charges, absents du modèle
   existant. **`source` (BOOK/STATEMENT) sur `BankTransaction`** — le modèle existant ne
   distinguait pas un mouvement généré par l'entreprise (avec écriture comptable liée) d'une
   ligne importée du relevé bancaire (sans écriture, en attente de rapprochement) — pourtant
   indispensable pour représenter un import bancaire sans le confondre avec un mouvement déjà
   comptabilisé. **Nouvelle table `BankReconciliationMatch`** — pointage plusieurs-à-plusieurs
   entre lignes de relevé et mouvements du livre au sein d'une session de rapprochement ; le
   modèle existant ne permettait qu'un rattachement 1-N via `reconciliationId`, insuffisant pour
   un pointage explicite ligne-à-ligne. **Traçabilité** (`createdById`/`canceledAt`/
   `canceledById`) ajoutée sur `BankReconciliation`.
2. **`CANCELED` ajouté à l'enum `ReconciliationStatus`** — un statut dédié pour l'annulation
   d'un rapprochement, plutôt que de surcharger `COMPLETED` avec un champ `canceledAt` ambigu.

### Convention de solde — jamais de valeur stockée modifiable

`CashAccount.currentBalance`/`BankAccount.currentBalance` existent dans le modèle mais **ne
sont jamais la source de vérité** — le cahier des charges interdit explicitement un solde
stocké modifiable manuellement. Le solde réel est toujours recalculé depuis les lignes
d'écriture validées du compte comptable associé, avec la **même convention que le Grand Livre**
(Étape 8) : solde = débit − crédit.

### Mouvements — même pattern DRAFT→lignes→VALIDATED

Chaque mouvement de caisse/banque génère une écriture comptable complète (jamais de création
directe VALIDATED avec lignes imbriquées — le bug de ce type déjà corrigé à l'Étape 7 pour la
contrepassation aurait pu se reproduire ici, évité par construction). Journal sélectionné
automatiquement (premier journal actif de type `CASH`/`BANK` — réutilise le module `journals`
de l'Étape 7). Exercice comptable toujours redéterminé côté serveur depuis la date du
mouvement.

### Transferts

Caisse↔caisse, banque↔banque, **et transferts croisés caisse↔banque** — chacun en une seule
écriture équilibrée, avec les mouvements de caisse/banque correspondants partageant la même
écriture génératrice (atomique, jamais deux écritures séparées pour un même transfert).

### Rapprochement bancaire

Modèle réutilisant `BankTransaction` pour représenter à la fois les mouvements du livre
(`source=BOOK`, toujours liés à une écriture validée) et les lignes importées du relevé
(`source=STATEMENT`, jamais liées à une écriture). Le pointage (`BankReconciliationMatch`) ne
modifie **jamais** les `BankTransaction`/`AccountingEntry` sous-jacents — c'est une information
complémentaire, jamais une altération d'une écriture validée (vérifié par test explicite).
Import CSV transactionnel avec détection de doublon (clé date/montant/référence), jamais le
contenu complet du fichier dans l'audit. Suggestions automatiques (lecture seule, correspondance
exacte de référence en confiance forte, montant identique + date proche en confiance moyenne).
Annulation d'un rapprochement : dé-pointage complet de toutes les lignes, tracé (`canceledAt`/
`canceledById`), statut `CANCELED` dédié.

### Sécurité — numéro de compte bancaire masqué

`GET .../bank-accounts` masque le numéro de compte (`••••1234`) — donnée sensible non exposée
inutilement en liste ; le détail complet reste accessible via `GET .../bank-accounts/:id`.

### Permissions

13 ajoutées (`CASH.UPDATE`, `CASH.MOVEMENT.CREATE/READ`, `BANK.UPDATE/DISABLE`,
`BANK.MOVEMENT.CREATE/READ`, `RECONCILIATION.READ/COMPLETE/CANCEL/IMPORT`) — 6 existaient déjà
et ont été réutilisées sans modification (`CASH.CLOSE` réutilisée comme permission de
désactivation/réactivation d'une caisse ; `BANK.RECONCILE` réutilisée pour l'ouverture d'une
session et le pointage). 83 permissions au total.

### Frontend

`/treasury/cash` (liste/new/détail avec solde et mouvements/mouvements), `/treasury/banks`
(symétrique, avec masquage du numéro de compte), `/treasury/reconciliation` (liste/détail avec
import, pointage, clôture, annulation).

### Tests (Étape 11)

| Suite | Résultat |
|---|---|
| `test/treasury/treasury_test.ts` (caisse 1-9, banque 10-16, rapprochement 17-24, sécurité 25-28, transferts croisés) | **31 PASS / 31** |
| `test/treasury/concurrency_test.ts` (numérotation concurrente caisse/banque, pointage concurrent) | **4 PASS / 4** |
| Régression complète (Jest + Étapes 4-10) | **281 PASS / 281** |
| **Total cumulé (toutes étapes)** | **316 PASS / 316** |

Backend : `tsc --noEmit` (0 erreur), `nest build` (succès), ESLint (0 erreur). Frontend : `tsc
--noEmit` (0 erreur), `next build` (succès, 50 routes), `next lint` (0 avertissement).

## Immobilisations et amortissements (Étape 12)

### Inventaire avant modification (résumé)

`FixedAsset` et `DepreciationEntry` existaient déjà (schéma initial, Étape 2), y compris la
contrainte unique `(fixedAssetId, fiscalYear)` sur `DepreciationEntry` — protection native contre
la double dotation, réutilisée telle quelle. Le module backend `fixed-assets` était un stub vide
(fichiers `.ts` présents mais à 0 octet), sans aucune permission `ASSET.*`, sans page frontend.

### Modifications de schéma réellement nécessaires

Une migration (`20260824100000_fixed_assets_step12`) :

1. **`ACQUIRED` ajouté à l'enum `FixedAssetStatus`** — état intermédiaire manquant : le cycle de
   vie existant démarrait directement à `IN_SERVICE`, sans distinguer une fiche créée d'une
   immobilisation réellement mise en service.
2. **Nouvelle table `AssetCategory`** — référentiel de comptes (immobilisation, amortissement,
   dotation) et méthode/durée par défaut, absent du schéma existant ; jamais de numéro de compte
   codé en dur (même principe que `AccountingFramework`/`AccountClass`).
3. **Colonnes ajoutées sur `FixedAsset`** : `categoryId`, `depreciationAccountId`,
   `depreciationExpenseAccountId`, `serviceDate`, `invoiceId`, `acquisitionEntryId`, `location`,
   `reference`, `notes`.
4. **Nouvelle table `AssetDisposal`** — trace structurée d'une cession, avec **contrainte unique
   sur `fixedAssetId`** : protection native et atomique contre la double cession, même principe
   que `depreciation_entries(fixedAssetId, fiscalYear)` — aucun trigger `FOR UPDATE` nécessaire,
   contrairement aux Étapes 10/11, car une contrainte unique suffit à sérialiser des `INSERT`
   concurrents sans fenêtre de course.

### Cycle de vie et amortissement — jamais avant la mise en service

`ACQUIRED → IN_SERVICE → (DISPOSED / FULLY_DEPRECIATED)`. Le plan d'amortissement s'ancre
**exclusivement** sur `serviceDate`, jamais sur `acquisitionDate` (règle explicite du cahier des
charges) — voir `depreciation-calculator.ts`. Linéaire : annuités égales, dernière période
absorbant le reliquat d'arrondi. Dégressif : taux double constant (2/durée) sur la valeur nette
comptable restante, avec **bascule automatique vers le linéaire restant** dès que celui-ci devient
plus favorable — même dernière période absorbant le reliquat. L'index d'annuité est calculé comme
`exercice_civil − année_de_mise_en_service + 1`, jamais utilisé directement comme index de
tableau.

### Écritures comptables — mêmes patterns que les Étapes 7/10/11

Toute écriture générée (acquisition directe, dotation, cession) réutilise **exactement** le
pattern DRAFT → lignes → VALIDATED et la numérotation atomique (`fn_next_document_number`) déjà en
place — jamais de seconde logique créée. Une immobilisation liée à une facture d'achat existante
n'entraîne **aucune** écriture d'acquisition générée par ce module (déjà comptabilisée par le
module `invoices`, Étape 10) — sans facture liée, ce module génère lui-même l'écriture (compte
d'immobilisation débité / compte de contrepartie crédité).

### Cession — plus-value/moins-value automatique

`résultat = prix de cession − valeur nette comptable`. Écriture générée : annulation des
amortissements cumulés, encaissement du prix si positif, sortie de la valeur brute, et compte de
résultat exceptionnel unique débité (moins-value) ou crédité (plus-value) selon le signe — même
principe qu'`Invoice.taxAccountId` pour la TVA collectée/récupérable (un seul compte pour les deux
sens).

### Permissions

8 ajoutées (`ASSET.READ/CREATE/UPDATE/DISABLE/SERVICE/DEPRECIATE/DISPOSAL/EXPORT`) — 91
permissions au total. `ASSET.DISABLE` couvre l'activation/désactivation d'une catégorie (aucune
permission `CATEGORY.*` distincte créée, même économie que `CASH.CLOSE` à l'Étape 11).
`ACCOUNTING_ASSISTANT` peut créer/modifier/mettre en service mais jamais déprécier ni céder.

### Frontend

`/accounting/assets` (liste, recherche, filtre par statut, pagination), `/accounting/assets/new`
(création), `/accounting/assets/[id]` (détail, mise en service, cession), `/accounting/assets/[id]/edit`
(modification), `/accounting/assets/[id]/depreciation` (plan d'amortissement, génération de
dotation), `/accounting/assets/categories` (liste/création/désactivation des catégories).

### Tests (Étape 12)

| Suite | Résultat |
|---|---|
| `test/fixed-assets/fixed_assets_test.ts` (catégorie, immobilisation, mise en service, plans linéaire/dégressif avec bascule, dotation, double dotation, écriture, facture liée, cession, plus/moins-value, double cession, permissions, isolation) | **34 PASS / 34** |
| Régression complète (Jest + Étapes 4-11) | **292 PASS / 292** |
| **Total cumulé (toutes étapes)** | **326 PASS / 326** |

Backend : `tsc --noEmit` (0 erreur), `nest build` (succès), ESLint (0 erreur). Frontend : `tsc
--noEmit` (0 erreur), `next build` (succès, 57 routes), `next lint` (0 avertissement).

## Taxes et déclarations fiscales (Étape 13)

### Inventaire avant modification (résumé)

`Tax` et `TaxDeclaration` existaient déjà (schéma initial, Étape 2) — `Tax` est un référentiel
**global par pays**, jamais dupliqué par entreprise (même principe que
`AccountingFramework`/`AccountClass`). Les modules backend `taxes`/`tax-declarations` étaient des
stubs vides. Les permissions `TAX.READ/CREATE/UPDATE` existaient déjà (seed initial, Étape 5) et
ont été réutilisées sans être recréées.

### Modifications de schéma réellement nécessaires

Une migration (`20260825100000_taxes_budgets_step13_14`, partagée avec l'Étape 14) :

1. **`type` (`TaxType`) ajouté sur `Tax`** — champ du cahier des charges absent du modèle
   existant.
2. **Nouvelle table `CompanyTaxSettings`** — configuration *par entreprise* des comptes réels
   portant la TVA collectée/déductible/à décaisser pour une taxe du référentiel global ; jamais de
   compte codé en dur (même principe qu'`AssetCategory`, Étape 12).
3. **Colonnes ajoutées sur `TaxDeclaration`** : montants calculés (`collectedAmount`,
   `deductibleAmount`, `netAmount`, `creditAmount`), `amountPaid`, `linkedEntryId`, traçabilité
   (`createdById`/`validatedById`/`validatedAt`) + **contrainte unique
   `(companyId, taxId, periodStart, periodEnd)`** protégeant nativement contre une déclaration en
   double.

### Décision d'architecture — pas de nouvelle notion de « période fiscale »

Le cahier des charges demandait la gestion de « périodes fiscales » ; aucune table dédiée n'a été
créée. `TaxDeclaration` porte déjà `periodStart`/`periodEnd`/`periodLabel`, et sa validation
vérifie que l'**exercice comptable réel** (`AccountingPeriod`, Étape 6) couvrant `periodEnd` est
`OPEN` — exactement le même mécanisme que les factures, la trésorerie et les immobilisations.
Créer un second modèle de période aurait dupliqué une notion déjà bien établie.

### Décision d'architecture — gestion du référentiel global réservée à `isSuperAdmin`

`PermissionsGuard` exige structurellement un `:companyId` dans l'URL (voir son code) : il ne peut
donc pas protéger une route globale par pays. `GET /taxes` est accessible à tout utilisateur
authentifié (même pattern que `/accounting-frameworks`) ; la création/modification/activation
d'une taxe est réservée à `user.isSuperAdmin` — réutilisation du mécanisme de séparation
plateforme/entreprise déjà présent, sans nouveau système d'autorisation.

### Calcul de la TVA — jamais de saisie manuelle

TVA collectée/déductible calculées par mouvement **net** (crédit − débit sur le compte collecté ;
débit − crédit sur le compte déductible) sur les écritures **validées** de la période, en une
requête agrégée — même principe que le Grand Livre/la Balance (Étape 8). Base imposable
reconstituée depuis la taxe collectée et le taux (`base = taxe / taux`), jamais resaisie. Une
déclaration reste modifiable/recalculable tant que `validatedAt` est `NULL` ; la validation la
verrouille définitivement et génère l'écriture de TVA à décaisser (ou de crédit de TVA reporté)
via le pattern DRAFT → lignes → VALIDATED déjà en place (Étapes 7/10/11/12).

### Cycle de vie d'une déclaration

`create` (calcul automatique) → `recalculate` (tant que non verrouillée) → `validate` (verrouille
+ génère l'écriture) → `declare` (statut `SUBMITTED`, nécessite une validation préalable) →
`recordPayment` (paiement total ou partiel, solde restant = `amountDue − amountPaid`, statut
`PAID` une fois soldée).

### Permissions

7 ajoutées (`TAX.VALIDATE/DECLARE/PAY/EXPORT` + les 3 déjà existantes reconfirmées) — 97
permissions au total avant l'Étape 14.

### Frontend

`/accounting/taxes` (référentiel global), `/accounting/taxes/settings` (configuration des comptes
par entreprise), `/accounting/taxes/declarations` (liste), `.../new` (création), `.../[id]`
(détail, calcul, validation, soumission, suivi du paiement).

### Tests (Étape 13)

| Suite | Résultat |
|---|---|
| `test/taxes/taxes_test.ts` (taxe, configuration, TVA collectée/déductible/nette/crédit, déclaration, double déclaration, validation, écriture, facture, période clôturée, isolation, permissions) | **20 PASS / 20** |

## Budgets et contrôle de gestion (Étape 14)

### Inventaire avant modification (résumé)

`Budget` et `BudgetLine` existaient déjà (schéma initial, Étape 2), y compris la contrainte unique
`(budgetId, accountId, month)` sur `BudgetLine` — protection native contre un doublon de ligne,
réutilisée telle quelle. Le module backend `budgets` était un stub vide. Aucun centre analytique
n'existe dans le projet — aucun n'a été créé (le cahier des charges le proscrivait explicitement
en l'absence d'architecture correspondante) : une ligne reste strictement (compte, mois).

### Modifications de schéma réellement nécessaires

Même migration que l'Étape 13 :

1. **`description`, `createdById` ajoutés sur `Budget`** — champs du cahier des charges absents.
2. **Contrainte unique `(companyId, periodId, name)` ajoutée sur `Budget`** — protection native
   contre un budget en double pour un même exercice.

### Réalisé — jamais une donnée saisie manuellement

`BudgetLine.actualAmount` (colonne existante depuis le schéma initial) **n'est jamais lue ni
écrite** comme source de vérité — même règle que `CashAccount.currentBalance` (Étape 11) : le
réalisé est **toujours** recalculé depuis les lignes d'écriture validées du compte, pour le mois
civil et l'exercice du budget, avec la même convention que le Grand Livre (débit − crédit), en une
seule requête agrégée par budget. Vérifié explicitement par test : `actual_amount` reste à `0` en
base pendant qu'un achat réel de 420 000 est correctement recalculé côté service.

### Cycle de vie d'un budget

`create` (DRAFT) → lignes ajoutées/modifiées tant que `DRAFT` → `activate` (`DRAFT` → `ACTIVE`,
verrouille les lignes) → `close` (`ACTIVE` → `CLOSED`). L'analyse budget vs réalisé (écart, taux
de consommation) est calculée à la lecture, quel que soit le statut.

**Exercices clôturés** *(ajouté lors de la finalisation pré-production)* : `create`, `update`,
`createLine`, `updateLine` et `activate` exigent un exercice `OPEN` — même règle et même message
que pour toute autre opération liée à une période dans ce projet (factures, trésorerie,
immobilisations, déclarations fiscales). `close()` reste volontairement possible même après
clôture de l'exercice (geste administratif, jamais un nouvel engagement) ; la consultation reste
toujours possible. Voir `budgets.service.ts` pour le raisonnement complet.

### Permissions

5 ajoutées (`BUDGET.VALIDATE/EXPORT` + les 3 déjà existantes reconfirmées) — 102 permissions au
total.

### Frontend

`/accounting/budgets` (liste), `.../new` (création), `.../[id]` (détail, lignes, analyse budget vs
réalisé, activation/clôture), `.../[id]/edit` (modification, tant que `DRAFT`).

### Tests (Étape 14)

| Suite | Résultat |
|---|---|
| `test/budgets/budgets_test.ts` (création, modification, doublons, lignes, réalisé calculé depuis les écritures réelles, écart, taux de consommation, activation/clôture, isolation, permissions) | **18 PASS / 18** |

### Vérifications finales (Étapes 13 + 14)

| Suite | Résultat |
|---|---|
| Régression complète (Jest + Étapes 4-12 + Étapes 13-14) | **364 PASS / 364** |

Backend : `tsc --noEmit` (0 erreur), `nest build` (succès), ESLint (0 erreur). Frontend : `tsc
--noEmit` (0 erreur), `next build` (succès, 66 routes), `next lint` (0 avertissement).

## Rapports avancés (Étape 15)

### Inventaire avant modification (résumé)

Le module `reports` couvrait déjà le Grand Livre et la Balance générale (Étape 8), avec une
convention déjà établie : agrégations SQL brutes (`$queryRaw`) plutôt qu'en mémoire, filtre
`status <> 'DRAFT'` systématique, export CSV via un utilitaire `toCsv` partagé. Cette étape
étend le même service plutôt que d'en créer un second, et réutilise explicitement
`BudgetsService`, `TaxDeclarationsService`, `CashService` et `BankService` pour les analyses
budgétaire/fiscale/trésorerie — jamais de recalcul parallèle qui diverge des modules sources de
vérité (Étapes 11/13/14).

### Rapports ajoutés

Journal comptable (filtrable période/journal/compte/statut, paginé), compte de résultat (produits/
charges par `AccountClass.category`, comparaison entre deux exercices), bilan (actif/passif/
capitaux propres, classement par catégorie et par signe de solde pour les comptes de tiers/
trésorerie), analyse budgétaire (délègue entièrement à `BudgetsService.get()`), analyse fiscale
(délègue à `TaxDeclarationsService.list()`, agrège collecté/déductible/net/crédit/dû/payé), analyse
de trésorerie (encaissements/décaissements/soldes caisse et banque sur une période).

### Bug corrigé pendant cette étape

`getBalanceSheet` utilisait un `LEFT JOIN accounting_entries ... AND e.status <> 'DRAFT'` — mais le
`SUM(CASE WHEN l.side = 'DEBIT' ...)` ne vérifiait jamais si la jointure avait réellement abouti.
Résultat : les écritures en brouillon (dont la ligne `accounting_entry_lines` existe toujours,
LEFT JOIN oblige) étaient malgré tout comptées dans le bilan. Corrigé en ajoutant une garde
`CASE WHEN e.id IS NULL THEN 0 WHEN ...` dans le `SUM` et le `HAVING`. Le Grand Livre/la Balance
(Étape 8) n'étaient pas affectés : leurs `CASE` filtrent sur `e.entry_date`, qui vaut `NULL`
(donc faux) exactement quand la jointure échoue — protection implicite absente sur le bilan,
maintenant alignée.

### Aucune modification de schéma

Conformément au cahier des charges de cette étape — les rapports ne sont que des vues calculées
sur les données déjà modélisées.

### Permissions

Aucune nouvelle permission : `REPORT.READ`/`REPORT.EXPORT` (Étape 5) couvrent déjà l'ensemble des
nouveaux rapports.

### Endpoints

`/companies/:id/reports/{journal,income-statement,balance-sheet,budget,taxes,treasury}`
(+`/journal/export`, `/income-statement/export`, `/balance-sheet/export`).

### Frontend

`/accounting/reports` (page d'accueil des rapports), `.../journal`, `.../income-statement`,
`.../balance-sheet`, `.../budget`, `.../taxes`, `.../treasury`.

### Tests (Étape 15)

| Suite | Résultat |
|---|---|
| `test/reports-advanced/reports_advanced_test.ts` (balance, Grand Livre, journal, compte de résultat, bilan, budget, fiscal, trésorerie, filtres dates/comptes, écritures brouillon exclues, comparaison multi-exercices, isolation, permissions, cas sans données, export CSV) | **22 PASS / 22** |

## Pièces jointes (Étape 16)

### Inventaire avant modification (résumé)

Le modèle `Attachment` existait déjà depuis le schéma initial (Étape 2) — conçu avec des **FK
multiples nullables** (`accountingEntryId`, `invoiceId`, `fixedAssetId`, `taxDeclarationId`) plutôt
qu'un système polymorphe, et déjà relié à `Company`/`User`. Recherche exhaustive : **aucun service
n'utilisait cette table** (zéro occurrence de `attachment.` dans tout `src/modules`, hors ce
nouveau module) — le modèle existait mais la fonctionnalité entière restait à construire. Aucun
système de stockage cloud (S3/MinIO) n'existe dans le projet.

### Décision d'architecture — FK multiples conservées, pas de polymorphisme

Le cahier des charges laissait le choix entre plusieurs FK et un système polymorphe. Le modèle
existant ayant déjà tranché pour les FK multiples, ajouter `budgetId` (seul rattachement manquant)
suit exactement le même principe plutôt que d'introduire une seconde conception qui romprait la
cohérence avec l'existant. Limite acceptée : une pièce jointe ne peut être liée qu'à **un seul**
objet métier à la fois (le service refuse explicitement plusieurs liens simultanés) — cohérent
avec la forme du modèle, pas une limitation artificielle ajoutée par ce module.

### Décision d'architecture — stockage local, jamais une URL publique

Aucun stockage cloud n'étant configuré, les fichiers sont écrits sur disque local sous
`ATTACHMENTS_STORAGE_PATH` (`./storage/attachments` par défaut, un sous-dossier par entreprise).
La colonne `fileUrl` (déjà nommée ainsi dans le schéma existant) est réutilisée comme **clé de
stockage interne relative**, jamais une URL publique : aucune route statique n'expose ce dossier,
le téléchargement passe exclusivement par un endpoint applicatif qui revérifie `companyId` et les
permissions à chaque appel.

### Sécurité de l'upload

Nom de fichier interne **toujours** généré (UUID + extension whitelistée) — jamais dérivé du nom
fourni par le client, ce qui élimine structurellement le path traversal et l'écrasement arbitraire
quel que soit le nom envoyé (testé avec `../../../etc/passwd` comme nom de fichier). Liste blanche
de types MIME (PDF, images courantes, Office, CSV/texte) ; taille plafonnée par
`ATTACHMENTS_MAX_SIZE_BYTES` (10 Mo par défaut) ; hash SHA-256 calculé pour intégrité/détection de
doublon. Suppression **réelle** (ligne DB + fichier physique) — pas de suppression logique, aucun
précédent de soft delete n'existant ailleurs dans le projet.

### Modifications de schéma

Une migration (`20260826100000_attachments_step16`) : colonnes `sha256`, `description`, `category`,
`budget_id` (+ FK, même politique `ON DELETE SET NULL` que les FK existantes de cette table — la
pièce jointe et son fichier survivent à la suppression de l'objet rattaché).

### Permissions

4 nouvelles (`ATTACHMENT.READ/CREATE/DELETE/EXPORT`) — 101 permissions au total. Aucune ne
préexistait (contrairement à `TAX.*`/`BUDGET.*` qui avaient des codes placeholder dès l'Étape 5).

### Endpoints

`/companies/:id/attachments` (liste filtrable par type/id d'objet et catégorie, upload
multipart), `/companies/:id/attachments/:id` (métadonnées), `.../:id/download` (téléchargement),
`.../:id` (suppression, `DELETE`).

### Intégration frontend

Composant réutilisable `AttachmentsPanel` (liste, upload, téléchargement, suppression), intégré
aux pages de détail où il apporte une vraie valeur : immobilisation, facture, écriture comptable,
déclaration fiscale, budget — pas de modification des autres pages existantes.

### Tests (Étape 16)

| Suite | Résultat |
|---|---|
| `test/attachments/attachments_test.ts` — utilise de VRAIS fichiers sur le VRAI stockage configuré (aucun mock du système de fichiers) : upload, métadonnées, téléchargement (comparaison binaire), suppression réelle (ligne + fichier), fichier orphelin, type interdit, taille excessive, nom de fichier dangereux, rattachements (facture/écriture/immobilisation/déclaration/budget), lien unique, isolation, permissions | **18 PASS / 18** |

### Vérifications finales (Étapes 15 + 16)

| Suite | Résultat |
|---|---|
| Régression complète (22 fichiers, Étapes 4-16) | **404 PASS / 404** |

Backend : `tsc --noEmit` (0 erreur), `nest build` (succès), ESLint (0 erreur). Frontend : `tsc
--noEmit` (0 erreur), `next build` (succès, 73 routes), `next lint` (0 avertissement).

## Journal d'audit consultable (Étape 17)

### Inventaire avant modification (résumé)

`AuditLog` existait déjà **en intégralité** depuis le schéma initial (Étape 2) : `companyId`,
`userId`, `action`, `entityType`/`entityId`, `oldValue`/`newValue` (JSON), `ipAddress`,
`userAgent`, `createdAt`, avec ses 4 index déjà en place (`companyId`, `userId`,
`[entityType, entityId]`, `createdAt`). **18 services écrivaient déjà** dans ce journal
(accounting-entries, invoices, fixed-assets, tax-declarations, budgets, attachments, auth, etc.).
Vérification explicite du contenu réellement audité : aucune donnée sensible (mot de passe, token,
secret) n'y transite — les événements d'authentification ne stockent que des indicateurs
(`{ reason: 'bad_password' }`, jamais le mot de passe lui-même). Ce module n'ajoute **aucune**
colonne ni écriture supplémentaire — uniquement la couche de consultation qui manquait, exactement
comme demandé : pas de second système d'audit parallèle.

### Décision d'architecture — immuabilité appliquée par PostgreSQL, pas seulement par convention

Un trigger (`trg_b_protect_audit_log_immutability`) rejette toute tentative d'`UPDATE` ou de
`DELETE` sur `audit_logs`, quel que soit le rôle applicatif — même principe que
`trg_b_protect_validated_entries` qui protège déjà les écritures comptables validées (Étape 7).
Aucune route `PATCH`/`PUT`/`DELETE` n'existe non plus côté `AuditLogController` : l'immuabilité est
garantie à **deux niveaux indépendants** (absence de route ET rejet en base), pas seulement par
l'absence de bouton côté frontend. Testé explicitement par de vraies tentatives d'`UPDATE`/`DELETE`
contre PostgreSQL (jamais simulées) — voir Tests ci-dessous. Quatre suites de tests préexistantes
(Étapes 7 et 5) nettoient des lignes `audit_logs` entre leurs scénarios : chacune désactive
temporairement ce trigger autour de son seul nettoyage, jamais pendant les scénarios métier
eux-mêmes.

### Isolation multi-tenant et événements globaux

Toute méthode de consultation filtre strictement sur `companyId` = paramètre de route. Les
événements d'authentification (`LOGIN`/`LOGOUT`/`REGISTER`/`PASSWORD_*`/`REFRESH`/`REVOKE`) ont
`companyId IS NULL` par conception — un utilisateur n'est pas encore rattaché à une entreprise au
moment de se connecter. Conséquence structurelle : `WHERE company_id = $1` exclut ces lignes de
toute consultation par entreprise, qu'aucun rôle ne peut donc voir via ce module — une éventuelle
administration plateforme distincte n'est pas demandée et n'a pas été construite.

### Permissions

`AUDIT.READ` existait déjà (placeholder Étape 5), déjà assignée à
SUPER_ADMIN/ADMIN/DIRECTOR/ACCOUNTANT/AUDITOR. Une seule permission ajoutée : `AUDIT.EXPORT`
(SUPER_ADMIN/ADMIN/DIRECTOR/AUDITOR — pas ACCOUNTANT, qui peut consulter mais pas produire
d'extraction) — 102 permissions au total.

### Endpoints

`GET /companies/:id/audit-logs` (liste, filtres, pagination, tri), `GET
/companies/:id/audit-logs/:id` (détail), `GET /companies/:id/audit-logs/export/csv` (export,
respecte les filtres actifs). Aucune route d'écriture.

### Filtres et performance

Utilisateur, action, type/ID d'entité, plage de dates, tri (`createdAt`/`action`/`entityType`,
asc/desc), pagination obligatoire (page/pageSize, 200 maximum) — jamais de chargement intégral en
mémoire. Les 4 index déjà en place (Étape 2) couvrent l'ensemble de ces filtres ; aucun index
supplémentaire n'était nécessaire.

### Frontend

`/accounting/audit-log` (liste, filtres, tri, pagination, export) et
`/accounting/audit-log/[id]` (détail : avant/après en JSON lisible, IP/user-agent). Lecture seule
assumée visuellement — aucun bouton modifier/supprimer.

### Tests (Étape 17)

| Suite | Résultat |
|---|---|
| `test/audit/audit_test.ts` (26 scénarios du cahier des charges + 6 vérifications d'intégration réelle avec les modules Étapes 7/10/12/13/14/16) | **32 PASS / 32** |

Couvre notamment : présence de tous les champs, consultation, pagination, tri, filtres
(utilisateur/action/entité/date), isolation entreprise A/B, permissions `AUDIT.READ`/`AUDIT.EXPORT`
(y compris le cas ACCOUNTANT qui peut lire mais pas exporter), **tentatives réelles d'`UPDATE` et de
`DELETE` rejetées par PostgreSQL**, export CSV, absence de données sensibles, et la trace réelle
d'une validation d'écriture, d'une création/modification de facture, d'une validation de
déclaration fiscale, d'une activation/clôture de budget, d'une cession d'immobilisation et d'une
suppression de pièce jointe.

### Vérifications finales (Étape 17)

| Suite | Résultat |
|---|---|
| Régression complète (23 fichiers, Étapes 4-17) | **436 PASS / 436** |

Backend : `tsc --noEmit` (0 erreur), `nest build` (succès), ESLint (0 erreur). Frontend : `tsc
--noEmit` (0 erreur), `next build` (succès, 75 routes), `next lint` (0 avertissement).

## Tableau de bord (Étape 18)

### Inventaire avant modification (résumé)

Aucun calcul comptable n'a été recréé — ce module est une couche de **présentation/agrégation
pure** au-dessus de services déjà existants et déjà testés : `ReportsService.getIncomeStatement`
(CA/charges/résultat, Étape 15), `ReportsService.getTreasuryReport` (caisse/banque, délègue à
`CashService`/`BankService`, Étape 11), `ReportsService.getTaxReport` (délègue à
`TaxDeclarationsService`, Étape 13), `ReportsService.getBudgetReport` (délègue à
`BudgetsService.get()`, dont le réalisé est déjà recalculé depuis les écritures réelles, Étape 14).
Seules trois agrégations n'existaient sous aucune forme exploitable ailleurs — créances/dettes par
échéance, synthèse immobilisations (valeur brute/amortissements cumulés/VNC), comptage des
écritures en brouillon — et ont été ajoutées comme la plus petite couche nécessaire, en SQL direct,
jamais en dupliquant une logique métier existante.

### Endpoint

`GET /companies/:id/dashboard` (filtre optionnel `periodId` ou `startDate`/`endDate` — même
convention de résolution de période que les rapports : exercice `OPEN` par défaut). `companyId`
provient exclusivement du paramètre d'URL, revérifié par `PermissionsGuard` à chaque requête —
un utilisateur ne peut jamais consulter le tableau de bord d'une autre entreprise en modifiant
l'URL sans y appartenir.

### Permissions

Aucune nouvelle permission : `REPORT.READ` (déjà existante) est réutilisée — le dashboard est une
vue agrégée des mêmes données que les rapports, pas une nouvelle catégorie nécessitant son propre
système d'autorisation.

### Indicateurs

Trésorerie disponible (caisse + banque), chiffre d'affaires, charges, résultat, créances clients
(total + échues), dettes fournisseurs (total + échues), TVA (collectée/déductible/nette/crédit/
restant dû), budget (budgété/réalisé/écart/taux de consommation), immobilisations (valeur brute/
amortissements cumulés/VNC), nombre d'écritures en brouillon sur la période.

### Graphiques

Évolution mensuelle CA/charges/résultat, évolution mensuelle de la trésorerie (variation nette
caisse+banque), budget vs réalisé — tous calculés depuis les écritures/mouvements réels de la
période sélectionnée, jamais une valeur générée pour remplir un graphique (un exercice sans
mouvement produit une liste vide, affichée comme telle côté frontend).

### Alertes — seuils explicites et documentés

Aucun seuil arbitraire non documenté :
- facture client/fournisseur échue non réglée, TVA restant due, écriture en brouillon,
  immobilisation acquise pas encore en service : signalées dès que le compte concerné est **> 0**
  (pas de seuil numérique au-delà de zéro) ;
- trésorerie disponible **< 0** : toujours signalée (un solde négatif est un fait, pas une
  convention) ;
- taux de consommation budgétaire **≥ 90 %** ("à surveiller") et **> 100 %** ("dépassé") —
  convention usuelle de contrôle de gestion, documentée en commentaire dans
  `dashboard.service.ts`, pas configurable en base à ce stade (hors périmètre de cette étape).

### Tests (Étape 18)

| Suite | Résultat |
|---|---|
| `test/dashboard/dashboard_test.ts` (résumé CA/charges/résultat avec exclusion des écritures brouillon, trésorerie, créances/dettes échues, immobilisations, TVA restant due, budget/réalisé/consommation, comptage brouillons, déclenchement correct des alertes, isolation `companyId`, réutilisation de `REPORT.READ`) | **18 PASS / 18** |

### Vérifications finales (Étape 18)

| Suite | Résultat |
|---|---|
| Régression complète (24 fichiers, Étapes 4-18) | **454 PASS / 454** |

Backend : `tsc --noEmit` (0 erreur), `nest build` (succès), ESLint (0 erreur). Frontend : `tsc
--noEmit` (0 erreur), `next build` (succès, 76 routes), `next lint` (0 avertissement). Aucune
migration nécessaire pour cette étape (couche d'agrégation pure, aucune colonne ajoutée).

## Mise en production / Production Deployment

Cette section couvre le déploiement en production — au-delà de l'installation de développement
documentée plus haut. Elle a été ajoutée lors de la finalisation pré-production du projet ; les
scripts et le endpoint qu'elle référence ont été réellement créés et testés dans cet environnement
(voir le détail de chaque sous-section).

**Guide complet et Docker Compose** : voir `PRODUCTION_DEPLOYMENT.md` à la racine du projet, qui
détaille la procédure manuelle (§1-22) et une alternative Docker Compose (`docker-compose.prod.yml`,
`backend/Dockerfile`, `frontend/Dockerfile`, `backend/scripts/docker-entrypoint.sh`) — la
seconde recommandée pour un premier déploiement, portable vers un VPS ou une plateforme cloud
supportant Docker. Le `docker-compose.yml` à la racine du projet ne sert, lui, qu'au
développement local (PostgreSQL + pgAdmin uniquement).

### 1. Prérequis

Node.js 20+, PostgreSQL 16+ (version testée dans cet environnement), un reverse proxy gérant le
TLS (nginx, Caddy, ou équivalent — ce projet n'implémente pas HTTPS lui-même, voir point 10), un
volume disque persistant pour le stockage des pièces jointes (voir point 15).

### 2. Variables d'environnement

Voir `.env.example` (backend) et `.env.local.example` (frontend) — listes exhaustives. Checklist
des variables les plus sensibles :

| Variable | Obligatoire en production | Documentée | Valeur par défaut dangereuse ? |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | **Oui, critique** | Oui (`.env.example`) | Oui si laissée à `change_me_...` — **le démarrage est maintenant refusé en production dans ce cas** (voir point 6) |
| `JWT_REFRESH_SECRET` | **Oui, critique** | Oui | Idem |
| `DATABASE_URL` | Oui | Oui | Non (pas de défaut, doit être fourni) |
| `NODE_ENV` | Oui (`production`) | Oui | Le comportement par défaut est `development` si absent — **doit être positionné explicitement** |
| `CORS_ORIGIN` | Oui | Oui | Défaut `http://localhost:3000` — à remplacer par le(s) domaine(s) réel(s) du frontend en production |
| `FRONTEND_URL` | **Oui, critique** | Oui | Défaut `http://localhost:3000` si absent — **produit des liens cassés dans les emails réels d'invitation/réinitialisation** (gap identifié et documenté lors de cette finalisation) |
| `ATTACHMENTS_STORAGE_PATH` | Oui | Oui | Défaut `./storage/attachments`, relatif au process — **doit pointer vers un volume persistant en production** (voir point 15) |
| `ATTACHMENTS_MAX_SIZE_BYTES` | Non | Oui | Défaut 10 Mo, raisonnable |
| `PORT`, `API_PREFIX` | Non | Oui | Défauts raisonnables |
| `MAX_LOGIN_ATTEMPTS`, `LOGIN_LOCKOUT_MINUTES` | Non | Oui | Défauts raisonnables (5 tentatives, 15 min) |

Aucun secret réel n'est présent dans `.env.example`/`.env.local.example` (uniquement des
placeholders explicites) ni ailleurs dans le dépôt — vérifié lors de l'audit pré-production.

### 3. PostgreSQL

Version 16 recommandée (celle utilisée pour tout le développement et les tests de ce projet).
Prévoir une instance dédiée, avec des identifiants distincts de ceux utilisés en développement.

### 4. Migrations

```bash
cd backend
export DATABASE_URL="postgresql://user:pass@host:5432/accounting_saas?schema=public"
for f in prisma/migrations/2026*/migration.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

17 migrations au total (Étapes 1 à 17 — l'Étape 18 n'en nécessitait aucune). Rejouabilité depuis
une base vide vérifiée à plusieurs reprises au fil du projet, dernière vérification lors de cette
finalisation (voir point 9 plus bas pour le détail).

### 5. Seeds

```bash
psql "$DATABASE_URL" -f prisma/seed/seed_permissions_roles.sql
# puis chaque seed_stepN_permissions.sql dans l'ordre (voir section "Seed" plus haut)
```

**Ne pas exécuter `seed.sql`** en production — il crée une entreprise de démonstration avec des
identifiants connus (`admin@demo.local` / `Demo1234!`), destinée uniquement au développement.

### 6. Build backend

```bash
cd backend && npm run build
```

Au démarrage (`node dist/main`), l'application **refuse désormais explicitement de démarrer** si
`NODE_ENV=production` et que `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` sont absents, font moins de
32 caractères, ou valent encore le placeholder de `.env.example` — protection ajoutée lors de la
finalisation pré-production (voir `src/main.ts`), vérifiée par un test direct de la logique.

### 7. Build frontend

```bash
cd frontend && npm run build && npm start
```

### 8. Démarrage production

Définir `NODE_ENV=production` avant de démarrer le backend (`node dist/main`). Le frontend Next.js
se lance avec `next start` après `next build`.

### 9. Health check

```
GET /health
```

Route volontairement **hors** du préfixe `/api/v1` (chemin fixe, sans authentification requise —
un load balancer ou un orchestrateur n'a ni compte ni jeton) — voir `src/modules/health/`.
Renvoie `{"status":"ok","database":"ok","timestamp":"..."}` (HTTP 200) ou un statut `503` avec
`{"status":"error","database":"error",...}` si PostgreSQL est injoignable — jamais de détail de
connexion, de secret ni de trace technique dans la réponse. Testé (`test/health/health_test.ts`,
4/4 PASS) et vérifié manuellement que le message d'erreur brut de PostgreSQL n'atteint jamais le
corps de la réponse.

### 10. Reverse proxy / HTTPS

Ce projet **n'implémente pas HTTPS lui-même** — à mettre en place via un reverse proxy (nginx,
Caddy, load balancer managé) devant le backend (port configuré via `PORT`) et le frontend. Le
cookie HttpOnly du refresh token (voir `auth.controller.ts`) est marqué `secure` uniquement quand
`NODE_ENV=production` — s'assurer que la connexion est bien en HTTPS de bout en bout dans ce cas,
sans quoi le navigateur rejettera ce cookie.

### 11. CORS

`CORS_ORIGIN` doit être positionné sur le(s) domaine(s) réel(s) du frontend en production (une
liste séparée par des virgules est supportée, voir `main.ts`) — jamais laissé à la valeur de
développement `http://localhost:3000`.

### 12. Rate limiting

`ThrottlerModule` (100 requêtes/minute/IP par défaut) est maintenant appliqué **globalement** via
un `APP_GUARD` (correction apportée lors de la finalisation pré-production — il était configuré
mais jamais réellement enregistré comme garde globale). Les endpoints d'authentification
conservent leurs limites plus strictes spécifiques (5/min inscription et connexion, 3/min
réinitialisation de mot de passe).

### 13. Sauvegardes PostgreSQL

Voir `backend/scripts/backup/README.md` pour la documentation complète. Résumé :
`scripts/backup/backup-db.sh` (dump `pg_dump -Fc`, purge automatique selon rétention). Fréquence
recommandée : quotidienne au minimum. **Réellement testé** dans cet environnement : dump exécuté,
restauré dans une base neuve, structure (43 tables, 121 clés étrangères, 16 triggers) et
comptages de données critiques identiques entre source et restauration.

### 14. Restauration

`scripts/backup/restore-db.sh` (confirmation interactive requise, jamais silencieux). Procédure de
test de restauration et procédure de sinistre complète documentées dans
`backend/scripts/backup/README.md`.

### 15. Sauvegarde des pièces jointes

`scripts/backup/backup-attachments.sh` archive `ATTACHMENTS_STORAGE_PATH` en `.tar.gz`. **À
sauvegarder impérativement dans la même fenêtre que le dump PostgreSQL** — les métadonnées
(`attachments`) et les fichiers physiques forment un seul ensemble cohérent. Restauration :
`scripts/backup/restore-attachments.sh`. Cycle complet réellement testé : fichier restauré
identique octet pour octet à l'original.

### 16. Volume persistant

`ATTACHMENTS_STORAGE_PATH` **doit pointer vers un volume persistant en production** (volume Docker
nommé, disque monté sur la VM, ou équivalent) — jamais un chemin éphémère qui disparaîtrait au
redémarrage du conteneur/processus. Le dossier est créé automatiquement s'il n'existe pas
(`fs.mkdir(..., { recursive: true })`, déjà en place), mais son **contenu** ne survit que si le
chemin configuré est lui-même persistant. Ce volume doit être inclus dans le plan de sauvegarde
(point 15) et n'est **jamais** exposé directement par une route HTTP statique — tout accès passe
par `GET /companies/:id/attachments/:id/download`, qui revérifie systématiquement `companyId` et
les permissions (vérifié par lecture de code et par les tests Étape 16 existants).

### 17. Logs

`Logger` de NestJS (pas de framework structuré externe ajouté — observabilité minimale
volontairement, conformément au périmètre de cette finalisation). Événements journalisés au
démarrage : connexion PostgreSQL réussie/échouée (avec la stack trace **côté serveur uniquement**,
jamais renvoyée au client), environnement actif, origine CORS configurée — **jamais** de secret,
de jeton, ni de mot de passe, y compris partiellement.

### 18. Monitoring

`GET /health` (point 9) est le seul mécanisme de supervision applicative actuellement en place —
à interroger périodiquement par l'infrastructure (sonde de vie/disponibilité). Aucune métrique
(latence, taux d'erreur, débit) n'est exposée par l'application elle-même — à mettre en place côté
infrastructure si nécessaire (hors périmètre du code applicatif).

### 19. Disaster recovery

Voir `backend/scripts/backup/README.md`, section "Procédure en cas de sinistre" — reconstruction
depuis une base vide (migrations) ou restauration directe d'un dump, restauration du stockage des
pièces jointes depuis la même sauvegarde, reconfiguration des variables d'environnement.
**Non testé dans ce sandbox** : bascule multi-serveurs, réplication géographique — responsabilité
d'infrastructure.

### 20. Checklist avant mise en production

- [ ] `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` uniques, ≥32 caractères, jamais les placeholders
- [ ] `NODE_ENV=production` positionné explicitement
- [ ] `CORS_ORIGIN` pointant vers le(s) domaine(s) réel(s)
- [ ] `FRONTEND_URL` pointant vers le domaine réel du frontend (sinon liens cassés dans les emails)
- [ ] `ATTACHMENTS_STORAGE_PATH` sur un volume persistant, sauvegardé
- [ ] Reverse proxy HTTPS devant backend et frontend
- [ ] Migrations appliquées, seed de permissions/rôles exécuté, `seed.sql` (démo) **non** exécuté
- [ ] `GET /health` accessible et surveillé par l'infrastructure
- [ ] Sauvegardes PostgreSQL + pièces jointes planifiées dans la même fenêtre, testées une fois
      manuellement (voir `backend/scripts/backup/README.md`)
- [ ] Rétention des sauvegardes conforme aux obligations légales/fiscales de l'entreprise
      utilisatrice (au-delà des 30 jours par défaut des scripts, à ajuster)

### Limitations qui restent réellement nécessaires

Aucun système de monitoring/métriques applicatif au-delà de `/health` ; aucune haute disponibilité
du stockage de fichiers ; aucune réplication PostgreSQL documentée ici (responsabilité
infrastructure) ; `prisma generate` reste indisponible dans le sandbox de développement de ce
projet (réseau restreint) — sans impact en production réelle avec un accès réseau standard (voir
section "Limites connues" ci-dessous pour le détail du workaround `pg` utilisé pour les tests).

## Limites connues de cet environnement











Le téléchargement des moteurs Prisma (`binaries.prisma.sh`) est bloqué par la politique réseau de
cet environnement de développement (sandbox) — testé sous plusieurs configurations (`prisma
validate`, `generate`, avec `engineType = "wasm"` + `previewFeatures = ["driverAdapters"]`,
`PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`), toutes échouent en `403 Forbidden`. Conséquences
précises :

- `npx prisma generate` ne fonctionne pas ici → `@prisma/client` expose `PrismaClient = any` (stub
  par défaut). Le code de production (`auth.service.ts` etc.) **compile** correctement dans ce
  sandbox, mais cette compilation ne peut **pas** détecter une erreur de typage spécifique à une
  requête Prisma (nom de champ erroné, etc.) — seul un vrai `prisma generate` chez vous le permettra.
  Relancez `npx tsc --noEmit` après un `prisma generate` réussi pour une vérification complète.
- Aucun test Jest piloté par le conteneur NestJS réel (`Test.createTestingModule`) n'a pu être
  exécuté pour cette même raison — remplacés par les tests d'intégration PostgreSQL directs décrits
  plus haut, qui valident le comportement réel de la base et du code métier non-Prisma, mais pas le
  câblage NestJS (guards, DTO, contrôleurs) lui-même.
- PostgreSQL 16 a néanmoins été installé et exécuté **réellement** dans ce sandbox pour permettre
  toutes les vérifications SQL/migrations/intégrité décrites dans ce document — rien n'est simulé.
- **Référentiel SYSCOHADA (Étape 6)** : seules les 9 classes (avec métadonnées) sont seedées, faute
  de source officielle/autorisée du plan comptable détaillé complet — voir la section dédiée
  ci-dessus. Les comptes utilisés dans les tests sont des exemples de démonstration, jamais présentés
  comme le référentiel officiel complet.
- **Bug de contrepassation (Étape 7)** : détecté et corrigé grâce aux tests d'intégration réels
  contre les vrais triggers PostgreSQL (voir section Étape 7 ci-dessus) — un exemple concret de
  l'utilité de tester contre la vraie base plutôt que des mocks, y compris dans un environnement où
  Prisma Client n'est pas généré.
- **Modification de trigger (Étape 9)** : `fn_protect_validated_entry_lines` a été modifié pour
  autoriser spécifiquement les mises à jour de `lettering_id` sur une ligne validée — seule
  modification de schéma de cette étape, justifiée et testée explicitement (voir section Étape 9
  ci-dessus). Toute autre colonne reste strictement protégée.
- **Bug de concurrence sur l'affectation de paiements (Étape 10)** : détecté par test avec deux
  connexions PostgreSQL parallèles (le trigger de sur-affectation ne verrouillait pas la ligne
  facture) et corrigé avec `SELECT ... FOR UPDATE` — voir section Étape 10 ci-dessus.
- **Gestion de trésorerie (Étape 10)** : les modules `cash`/`bank` complets étaient hors périmètre à
  cette étape (stubs non implémentés) ; un endpoint minimal de lecture avait été ajouté pour
  permettre la création de paiements — **complété à l'Étape 11** (voir section Étape 11 ci-dessus).
- **Module `fixed-assets` (Étape 12)** : les fichiers `controller`/`service`/`module` existaient
  dans l'arborescence mais étaient vides (0 octet) — le module a été implémenté entièrement à cette
  étape, aucune fonctionnalité préexistante à préserver.
- **`seed.sql` corrigé lors d'un audit post-Étape 12** : le script utilisait encore la colonne
  `account_class`, supprimée par la migration de l'Étape 6 (remplacée par `account_class_id` +
  `framework_id`) — le script de données de démonstration n'avait jamais été mis à jour depuis et
  échouait donc contre le schéma actuel. Corrigé sans toucher au schéma ni à la moindre logique
  métier (portée strictement limitée aux données fictives de développement) ; les 14 migrations,
  elles, n'étaient pas affectées et s'appliquaient déjà correctement depuis une base vide.
- **Modules `taxes`/`tax-declarations`/`budgets` (Étapes 13-14)** : stubs vides comme
  `fixed-assets` avant l'Étape 12 — implémentés entièrement, aucune fonctionnalité préexistante à
  préserver. Décision d'architecture notable : le référentiel `Tax` étant global par pays (comme
  `AccountingFramework`), sa gestion en écriture est réservée à `user.isSuperAdmin` plutôt que de
  contourner l'exigence structurelle de `PermissionsGuard` sur un `:companyId` — voir la section
  Étape 13 ci-dessus pour le détail du raisonnement.
- **Bug corrigé à l'Étape 15** : `getBalanceSheet` incluait par erreur les écritures en brouillon
  dans le bilan (garde manquante sur une jointure gauche) — voir la section Étape 15 ci-dessus.
- **Module `attachments` (Étape 16)** : stub vide comme les autres modules avant leur étape —
  implémenté entièrement. Stockage sur disque local uniquement (`ATTACHMENTS_STORAGE_PATH`),
  aucun système cloud (S3/MinIO) configuré dans cet environnement — voir la section Étape 16 pour
  le détail des décisions d'architecture (FK multiples conservées, clé de stockage interne jamais
  publique, suppression réelle sans soft delete).
- **Journal d'audit (Étape 17)** : `AuditLog` et son écriture existaient déjà en intégralité
  (schéma initial) — seule la consultation manquait. Un trigger d'immuabilité PostgreSQL a été
  ajouté (`trg_b_protect_audit_log_immutability`) ; quatre suites de tests préexistantes
  (Étapes 5/7) ont dû être adaptées pour désactiver ce trigger autour de leur seul nettoyage de
  données de test — voir la section Étape 17 pour le détail.
- **Tableau de bord (Étape 18)** : couche de présentation/agrégation pure, aucun nouveau calcul
  comptable — réutilise `ReportsService`/`CashService`/`BankService`/`TaxDeclarationsService`/
  `BudgetsService` déjà existants et testés. Alertes basées sur des seuils explicites et
  documentés (voir section Étape 18), pas de configuration en base pour ces seuils à ce stade.
- **Finalisation pré-production** : trois failles de sécurité réelles trouvées lors de l'audit
  pré-production ont été corrigées (rate limiting jamais réellement appliqué globalement malgré sa
  configuration, validation de type de fichier reposant uniquement sur une donnée client, absence
  de garde au démarrage contre le secret JWT par défaut) ; un endpoint `/health` et des scripts de
  sauvegarde/restauration PostgreSQL + pièces jointes ont été ajoutés et réellement testés (voir
  section "Mise en production" ci-dessus) ; la règle métier sur les budgets liés à un exercice
  clôturé a été explicitée et implémentée (voir la section Étape 14 pour le raisonnement complet).
- **Préparation au premier déploiement** : deux bugs réels trouvés en cartographiant le
  déploiement. (1) `prisma/seed.ts` (l'entrée `npx prisma db seed`) utilisait encore la colonne
  `account_class` supprimée à l'Étape 6 (le miroir SQL, `seed.sql`, avait déjà été corrigé lors de
  l'audit post-Étape 12, mais ce fichier TypeScript ne l'avait jamais été) — corrigé pour utiliser
  `frameworkId`/`accountClassId`. (2) Plus sérieusement : le mot de passe de l'utilisateur de
  démonstration (`seed.sql` ET `prisma/seed.ts`) était haché en **bcrypt**, alors que
  l'application vérifie exclusivement avec **Argon2id** (`password.util.ts`) — le login de
  démonstration documenté depuis le début du projet ne pouvait donc jamais réellement fonctionner.
  Vérifié empiriquement (`argon2.verify()` sur l'ancien hash renvoie `false`), corrigé avec un
  hash Argon2id généré avec les mêmes paramètres que l'application, revérifié positif après
  correction, et appliqué aux bases `accounting_saas`/`accounting_saas_test` déjà seedées. Aucun
  test de la suite ne couvrait ce chemin (chaque suite crée ses propres utilisateurs avec un hash
  Argon2id frais), ce qui explique que ce bug soit resté invisible jusqu'à cette vérification
  ciblée de la procédure de déploiement.

Chez vous, avec un accès réseau standard : `npx prisma generate` puis `npx prisma migrate dev`
fonctionneront directement, et vous pourrez ajouter des tests e2e Supertest complets sur
`AuthController`.
