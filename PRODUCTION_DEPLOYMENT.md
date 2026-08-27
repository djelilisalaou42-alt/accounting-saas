# Déploiement en production — accounting-saas

Ce document permet de déployer le projet sans connaître son historique de développement. Il
complète (sans les dupliquer intégralement) le README principal et `backend/scripts/backup/README.md`.

**Deux façons de déployer** : la procédure manuelle ci-dessous (§1-22, `npm`/`psql` directement sur
le serveur), ou **Docker Compose** (voir la section dédiée après la checklist, §22bis) — recommandé
pour un premier déploiement, portable vers un VPS ou la plupart des plateformes cloud (Railway,
Render, Fly.io) sans rien reconstruire.

**Portée honnête** : les procédures ci-dessous ont été réellement exécutées et vérifiées dans
l'environnement de développement de ce projet (migrations, seeds, scripts de sauvegarde/
restauration, `/health`, build backend/frontend). Ce qui dépend d'un vrai serveur de production
multi-machines (réplication, bascule géographique, montée en charge réelle) est signalé comme tel
et reste à valider sur votre infrastructure réelle.

## 1. Prérequis serveur

- Linux (toute distribution récente), ou tout OS supportant Node.js et PostgreSQL.
- Accès réseau sortant standard (contrairement à l'environnement de développement de ce projet,
  dont le sandbox restreint l'accès à `binaries.prisma.sh` — voir point 7).

## 2. Node.js

Version 20 ou supérieure (celle utilisée pour tout le développement de ce projet).

## 3. PostgreSQL

Version 16 ou supérieure. Créer un rôle et une base dédiés à l'application (jamais le rôle
superutilisateur applicatif de développement) :

```sql
CREATE USER accounting_prod WITH PASSWORD 'un_mot_de_passe_fort_genere_aleatoirement';
CREATE DATABASE accounting_saas OWNER accounting_prod;
```

## 4. Installation backend

```bash
cd backend
npm install
```

## 5. Installation frontend

```bash
cd frontend
npm install
```

## 6. Variables d'environnement

Copier `backend/.env.example` vers `backend/.env` et `frontend/.env.local.example` vers
`frontend/.env.local`, puis renseigner de vraies valeurs — **jamais de valeur réelle dans les
fichiers `.env.example`/`.env.local.example` eux-mêmes, jamais commitées dans Git** (déjà exclues
via `.gitignore`, vérifié).

Variables backend critiques :

| Variable | Obligatoire | Remarque |
|---|---|---|
| `DATABASE_URL` | Oui | Connexion au rôle/base créés au point 3 |
| `JWT_ACCESS_SECRET` | **Oui, critique** | ≥32 caractères aléatoires, jamais le placeholder — le démarrage est **refusé** en production sinon (vérifié) |
| `JWT_REFRESH_SECRET` | **Oui, critique** | Idem |
| `NODE_ENV` | Oui | `production` |
| `CORS_ORIGIN` | Oui | Domaine(s) réel(s) du frontend |
| `FRONTEND_URL` | **Oui** | Domaine réel du frontend — sinon les emails d'invitation/réinitialisation contiennent des liens `localhost` (gap trouvé et documenté lors de la finalisation pré-production) |
| `ATTACHMENTS_STORAGE_PATH` | Oui | Chemin vers un **volume persistant** (voir point 10) |
| `PORT`, `API_PREFIX` | Non | Défauts raisonnables (`3001`, `api/v1`) |

## 7. Génération / build

```bash
# Prisma generate nécessite un accès réseau vers binaries.prisma.sh —
# indisponible dans le sandbox de développement de ce projet, mais
# fonctionnera normalement sur un serveur avec accès réseau standard.
cd backend
npx prisma generate   # une fois réellement possible sur votre serveur
npm run build          # nest build

cd ../frontend
npm run build           # next build
```

Si `prisma generate` reste indisponible pour une raison quelconque, le projet reste fonctionnel :
tout le code métier utilise `PrismaService`/le client généré normalement pour les opérations CRUD,
et une poignée de requêtes agrégées utilisent du SQL brut paramétré (`$queryRaw`/`$queryRawUnsafe`
avec liaison de paramètres, jamais de concaténation) — voir README, section "Limites connues",
pour le détail du contournement utilisé pendant le développement.

## 8. Migrations

```bash
cd backend
export DATABASE_URL="postgresql://accounting_prod:MOT_DE_PASSE@host:5432/accounting_saas?schema=public"
for f in prisma/migrations/2026*/migration.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

17 migrations, aucune destructive (vérifié par relecture : uniquement des `CREATE TABLE`/`ALTER
TABLE ADD COLUMN`/`CREATE INDEX`/`CREATE TRIGGER`, jamais de `DROP TABLE` ni de suppression de
données). Rejouabilité depuis une base vide vérifiée à plusieurs reprises au fil du projet.

## 9. Permissions (seed de rôles — jamais le seed de démonstration)

```bash
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
```

**Ne jamais exécuter `prisma/seed/seed.sql` en production** — il crée une entreprise et un
utilisateur de démonstration avec des identifiants connus publiquement
(`admin@demo.local` / `Demo1234!`, documentés dans ce dépôt). Ces scripts sont idempotents
(`ON CONFLICT DO NOTHING`) — rejouables sans risque de doublon.

Après cette étape, il n'existe encore **aucune entreprise ni aucun utilisateur** — créer le
premier compte administrateur via `POST /api/v1/auth/register` (ou l'écran d'inscription du
frontend), puis la première entreprise.

## 10. Stockage des pièces jointes

`ATTACHMENTS_STORAGE_PATH` **doit pointer vers un volume persistant** — un volume Docker nommé, un
disque réseau monté, ou un répertoire sur un disque qui survit aux redéploiements/redémarrages du
conteneur ou du processus. Le dossier est créé automatiquement s'il n'existe pas
(`fs.mkdir(..., { recursive: true })`, déjà en place et vérifié), mais son **contenu** ne persiste
que si le chemin configuré lui-même est stable dans le temps. Jamais exposé par une route
statique — vérifié par inspection du code (`grep` exhaustif, aucun `ServeStaticModule` ni
`express.static` dans tout le projet) : tout accès passe par
`GET /companies/:id/attachments/:id/download`, qui revérifie systématiquement `companyId` et les
permissions.

## 11. Démarrage backend

```bash
cd backend
NODE_ENV=production node dist/main
```

Au démarrage, le backend :
- refuse de démarrer si les secrets JWT sont absents/trop courts/laissés au placeholder (vérifié) ;
- journalise la connexion PostgreSQL (succès ou échec, sans jamais exposer de secret) ;
- expose `GET /health` immédiatement.

## 12. Démarrage frontend

```bash
cd frontend
NODE_ENV=production npm start   # next start, après next build
```

## 13. Reverse proxy

Voir `deploy/nginx.conf.example` — configuration de référence (nginx choisi pour sa simplicité et
sa documentation abondante, pas une dépendance imposée par le projet). Elle route `/health` et
`/api/v1/*` vers le backend, tout le reste vers le frontend, avec redirection HTTP → HTTPS et
limite de taille de requête alignée sur `ATTACHMENTS_MAX_SIZE_BYTES`.

```
Internet → HTTPS (reverse proxy, ex. nginx) → Frontend Next.js (:3000)
                                             → Backend NestJS  (:3001) — /api/v1/*, /health
                                             → PostgreSQL (non exposé publiquement)
```

## 14. HTTPS

Non implémenté par l'application elle-même — à terminer au niveau du reverse proxy (Let's Encrypt/
certbot ou certificat fourni par votre hébergeur). Le cookie HttpOnly du refresh token est marqué
`secure` uniquement quand `NODE_ENV=production` (déjà en place) : s'assurer que la chaîne est bien
HTTPS de bout en bout, sans quoi le navigateur rejettera ce cookie et les rafraîchissements de
session échoueront silencieusement.

## 15. Sauvegardes

Voir `backend/scripts/backup/README.md` (procédure complète, déjà réellement testée : cycle
dump/restauration PostgreSQL et backup/restauration des pièces jointes, comparaison de structure
et de contenu après restauration). Résumé :

```bash
# Base PostgreSQL
DATABASE_URL="$DATABASE_URL" ./backend/scripts/backup/backup-db.sh /chemin/vers/backups/db

# Pièces jointes — DANS LA MÊME FENÊTRE que le dump ci-dessus
ATTACHMENTS_STORAGE_PATH="$ATTACHMENTS_STORAGE_PATH" ./backend/scripts/backup/backup-attachments.sh /chemin/vers/backups/attachments
```

**Un backup uniquement stocké sur le même serveur que la production ne constitue pas une vraie
stratégie de disaster recovery** — une perte de ce serveur (disque, VM, datacenter) emporterait
alors aussi les sauvegardes. Répliquer les sauvegardes vers un emplacement **physiquement
distinct** (autre zone/région, stockage objet managé, autre datacenter) — décision et mise en
œuvre côté infrastructure, hors périmètre du code applicatif.

Fréquence recommandée : quotidienne au minimum. Rétention par défaut des scripts : 30 jours,
purgée automatiquement — à ajuster selon les obligations légales/fiscales applicables (souvent
plus longues pour des données comptables).

## 16. Restauration

Voir `backend/scripts/backup/README.md`, section "Test de restauration" — procédure complète
avec vérification de structure et de comptages de données. Toujours restaurer le dump PostgreSQL
**et** l'archive de pièces jointes de la **même** sauvegarde ensemble : les métadonnées et les
fichiers physiques forment un seul ensemble cohérent.

## 17. Health check

```
GET /health
```

Hors du préfixe `/api/v1`, sans authentification (un load balancer/orchestrateur n'a ni compte ni
jeton). Réponse `200 {"status":"ok","database":"ok","timestamp":"..."}` ou `503
{"status":"error","database":"error",...}` si PostgreSQL est injoignable — jamais de détail de
connexion exposé. Testé (`backend/test/health/health_test.ts`, 4/4 PASS).

## 18. Logs

`Logger` de NestJS, volontairement minimal (pas de framework structuré externe ajouté à ce stade).
Événements journalisés : démarrage (connexion DB réussie/échouée, environnement actif, origine
CORS configurée), erreurs de connexion (stack trace **côté serveur uniquement**). Jamais de
secret, de jeton, ni de mot de passe — vérifié par relecture de tous les appels `logger.*` du
projet.

## 19. Monitoring

**Minimum viable actuellement en place** : `GET /health`, à interroger périodiquement par votre
infrastructure (sonde de vie). **Ce qui n'existe pas dans le code applicatif et doit être
configuré côté infrastructure** :
- Surveillance CPU/RAM/disque du serveur (outil standard de votre hébergeur/orchestrateur).
- Surveillance de la disponibilité et des ressources PostgreSQL (connexions actives, latence,
  espace disque du volume de données).
- Surveillance de l'espace disque du volume `ATTACHMENTS_STORAGE_PATH` — **critique** : si ce
  volume se remplit, les uploads échoueront (l'application renverra une erreur propre, mais sans
  alerte proactive côté infrastructure, le problème ne serait détecté qu'au moment d'un échec
  utilisateur réel).
- Alertes automatiques : serveur indisponible (health check en échec répété), PostgreSQL
  indisponible, disque presque plein (seuil recommandé : alerte à 80%, action à 90%).

Aucune métrique applicative (latence par endpoint, taux d'erreur, débit) n'est actuellement
exposée par le code — à ajouter ultérieurement si le besoin se confirme (hors périmètre de cette
préparation, pour ne pas transformer une observabilité minimale en refonte complète).

## 20. Procédure de mise à jour

```
1. Sauvegarder (PostgreSQL + pièces jointes, §15) AVANT toute mise à jour.
2. Arrêter le backend (le frontend peut rester actif pendant une mise à jour backend seule).
3. Déployer la nouvelle version du code.
4. npm install (backend et/ou frontend selon ce qui a changé).
5. Appliquer les nouvelles migrations UNIQUEMENT (ne jamais rejouer celles déjà appliquées —
   tenir un registre externe des migrations déjà appliquées, ce projet n'a pas de table de suivi
   automatique puisque `prisma migrate` n'est pas utilisé pour déployer, voir §7).
6. npm run build (backend et/ou frontend).
7. Redémarrer le backend, puis le frontend.
8. Vérifier GET /health.
9. Exécuter les smoke tests (section suivante).
10. Valider avant de considérer la mise à jour terminée.
```

### Rollback applicatif

Redéployer la version précédente du code (backend et/ou frontend), `npm install` si les
dépendances ont changé, `npm run build`, redémarrer. Rapide et sans risque si aucune migration
n'a été appliquée entre-temps.

### Rollback base de données

**Plus délicat — ne jamais improviser.** Si une migration a été appliquée et doit être annulée :
1. Vérifier d'abord si la migration est réellement réversible (une `ALTER TABLE ADD COLUMN`
   nullable est réversible par un `DROP COLUMN` ; une migration qui a transformé ou supprimé des
   données ne l'est généralement pas sans perte).
2. Si réversible et sans risque de perte de données réelles : écrire et tester la migration
   inverse sur une copie de la base avant de l'appliquer en production.
3. Si non réversible sans perte, ou en cas de doute : **restaurer depuis la sauvegarde
   précédente** (§16) plutôt que de tenter une migration inverse risquée.
4. Ne jamais exécuter de rollback de migration destructif sans l'avoir d'abord vérifié sur une
   copie de la base.

## 21. Procédure d'urgence (sinistre)

Voir `backend/scripts/backup/README.md`, section "Procédure en cas de sinistre" — reconstruction
depuis une base vide (migrations) ou restauration directe d'un dump, restauration du stockage des
pièces jointes depuis la même sauvegarde, reconfiguration des variables d'environnement,
vérification `GET /health`.

## 22. Checklist avant mise en production

- [ ] `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` uniques, ≥32 caractères, jamais les placeholders
- [ ] `NODE_ENV=production` positionné explicitement
- [ ] `CORS_ORIGIN` et `FRONTEND_URL` pointant vers le(s) domaine(s) réel(s)
- [ ] `ATTACHMENTS_STORAGE_PATH` sur un volume persistant, sauvegardé
- [ ] Reverse proxy HTTPS devant backend et frontend (voir `deploy/nginx.conf.example`)
- [ ] Migrations appliquées, seed de permissions/rôles exécuté, `seed.sql` (démo) **non** exécuté
- [ ] `GET /health` accessible et surveillé par l'infrastructure
- [ ] Sauvegardes PostgreSQL + pièces jointes planifiées dans la même fenêtre, répliquées vers un
      emplacement physiquement distinct, testées une fois manuellement
- [ ] Rétention des sauvegardes conforme aux obligations légales/fiscales de l'entreprise
      utilisatrice
- [ ] Smoke tests post-déploiement exécutés (section suivante)

## 22bis. Option Docker Compose (alternative recommandée à §1-12)

Remplace les étapes §1, §2, §4, §5, §7, §8, §9, §11, §12 ci-dessus par une seule commande — les
étapes §3 (PostgreSQL — géré par le conteneur), §6 (variables d'environnement), §13-21 restent
identiques quelle que soit l'option choisie.

### Fichiers fournis

`backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.prod.yml` (racine du projet, distinct
de `docker-compose.yml` qui ne sert qu'au développement local — PostgreSQL + pgAdmin uniquement),
`.env.production.example`, `backend/scripts/docker-entrypoint.sh`.

### Ce que fait `docker-entrypoint.sh` au démarrage du conteneur backend

Ce projet applique ses migrations en SQL brut via `psql` (jamais `prisma migrate deploy` — voir
§7 et le README, section "Limites connues"). L'entrypoint tient donc son propre registre minimal
(`_manual_migrations`, une seule table de suivi) pour rester **idempotent** : à chaque démarrage
du conteneur, il applique uniquement les migrations pas encore enregistrées, puis rejoue les
seeds de permissions/rôles (déjà idempotents par construction), puis démarre l'application.
**Réellement testé dans ce sandbox** : script exécuté deux fois de suite contre une vraie base
PostgreSQL neuve — 17 migrations appliquées au premier passage, toutes correctement ignorées
("déjà appliquée") au second, sans aucune erreur.

`SEED_DEMO_DATA=true` déclenche `seed.sql` (données 100% fictives) — **jamais la valeur par
défaut**, à ne positionner que pour un environnement de démonstration explicitement voulu.

### Point d'attention — `NEXT_PUBLIC_API_URL`

Cette variable est **inlinée dans le bundle JavaScript au moment du build** du frontend (comportement
standard de Next.js pour toute variable `NEXT_PUBLIC_*`), jamais relue dynamiquement au démarrage
du conteneur. Elle est donc passée comme `build arg` dans `docker-compose.prod.yml` (`args:` sous
le service `frontend`), pas comme simple variable d'environnement au runtime — la définir
uniquement dans `environment:` serait sans effet. Toujours l'URL **publique** réelle de l'API
(via le reverse proxy), jamais `localhost`, dès que le build vise la production.

### Démarrage

```bash
cp .env.production.example .env.production
# éditer .env.production avec de vraies valeurs (secrets JWT, domaines, mot de passe PostgreSQL)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Nécessite Docker Compose V2 (`docker compose`, pas l'ancien `docker-compose` Python) pour le
`condition: service_healthy` utilisé entre les services `postgres` et `backend`.

### Volumes persistants

`postgres_data_prod` (données PostgreSQL) et `attachments_data_prod` (pièces jointes) — deux
volumes Docker **nommés**, jamais anonymes, pour survivre aux recréations de conteneur. Pour les
sauvegarder avec les scripts déjà fournis (§15), localiser leur point de montage réel sur l'hôte :

```bash
docker volume inspect accounting-saas_attachments_data_prod   # -> "Mountpoint"
```

puis pointer `ATTACHMENTS_STORAGE_PATH` de `backup-attachments.sh` vers ce chemin.

### Reverse proxy avec Docker

Le reverse proxy (§13, `deploy/nginx.conf.example`) reste **hors** de `docker-compose.prod.yml` —
il tourne sur l'hôte (nginx installé nativement, pointant vers `127.0.0.1:3000`/`127.0.0.1:3001`,
exactement les ports publiés par ce fichier compose) ou dans son propre conteneur séparé selon
votre préférence. Ce choix évite de dupliquer la gestion des certificats TLS dans le contexte
Docker et garde l'orchestration de l'application elle-même simple.

### Limite honnête de cette vérification

**Docker n'est pas installé dans le sandbox de développement de ce projet** — les Dockerfiles et
`docker-compose.prod.yml` n'ont donc pas pu être construits/exécutés en conteneur réel ici. Ce qui
a été réellement vérifié à la place : syntaxe YAML du fichier compose (`python3 -m yaml`), syntaxe
shell de l'entrypoint (`bash -n`), la sortie `standalone` de Next.js (construite avec succès dans
ce sandbox), et surtout **la logique métier de l'entrypoint elle-même** — exécutée directement
(hors conteneur) contre une vraie base PostgreSQL neuve, migrations + idempotence + seed de
démonstration conditionnel, tous confirmés fonctionnels. Reste à valider sur un vrai moteur
Docker : le build des images (résolution des dépendances natives comme `argon2` dans l'image
`node:20-slim`, taille finale des images) et le réseau inter-conteneurs.

## 22ter. Option Render (gratuit, pour démonstration — "voir l'application tourner")

Pour simplement voir l'application fonctionner sans gérer de serveur ni payer quoi que ce soit —
**pas adapté à une vraie production durable** (voir les limites ci-dessous). Utilise
`render.yaml` à la racine du projet (format "Blueprint" de Render), qui provisionne
automatiquement PostgreSQL + backend + frontend en une seule fois.

### Limites honnêtes du tier gratuit Render — à lire avant de commencer

- La base PostgreSQL gratuite est **supprimée après 30 jours** (14 jours de grâce pour upgrader
  avant suppression définitive). Largement suffisant pour une démonstration, pas pour un usage
  réel durable.
- Le tier gratuit ne permet **pas** d'attacher un disque persistant à un service web : les pièces
  jointes uploadées ne survivent **pas** à un redémarrage/redéploiement du conteneur backend
  (toutes les autres données, stockées en PostgreSQL, persistent normalement).
- Le service backend s'endort après 15 minutes sans requête ; la requête suivante prend
  30 à 60 secondes (démarrage à froid) — normal, pas un bug.
- 750 heures d'instance gratuites par mois et par espace de travail, partagées entre les services.

### Étapes

1. **Pousser le code sur GitHub** (dépôt public ou privé — Render peut se connecter aux deux) :
   ```bash
   cd accounting-saas
   git init && git add -A && git commit -m "Initial commit"
   # créer un dépôt vide sur github.com, puis :
   git remote add origin https://github.com/VOTRE-COMPTE/accounting-saas.git
   git push -u origin main
   ```
2. Créer un compte gratuit sur [render.com](https://render.com).
3. **New** → **Blueprint** → connecter le dépôt GitHub → Render détecte automatiquement
   `render.yaml` à la racine → **Apply**.
4. Render provisionne les 3 ressources (`accounting-saas-db`, `accounting-saas-backend`,
   `accounting-saas-frontend`). Le premier déploiement prend quelques minutes (build des deux
   images Docker).
5. **Vérifier les URLs réellement attribuées** — `render.yaml` suppose que Render attribue
   exactement `accounting-saas-backend.onrender.com` et `accounting-saas-frontend.onrender.com`
   (déduit du champ `name:` de chaque service). Si l'un de ces noms est déjà pris par un autre
   compte Render (espace de noms global à toute la plateforme), Render ajoute un suffixe
   aléatoire. Dans ce cas uniquement :
   - noter les URLs réelles affichées dans le tableau de bord Render pour chaque service ;
   - mettre à jour `CORS_ORIGIN` et `FRONTEND_URL` du service backend (Dashboard → service →
     Environment) avec l'URL réelle du frontend ;
   - mettre à jour la valeur de `NEXT_PUBLIC_API_URL` dans `dockerBuildArgs` du service frontend
     (Dashboard → service → Settings → Build) avec l'URL réelle du backend, puis déclencher un
     redéploiement manuel du frontend (cette variable est inlinée au build, un simple redémarrage
     ne suffit pas — voir §22bis).
6. Une fois les deux services "Live" : ouvrir l'URL du frontend. Se connecter avec le compte de
   démonstration (`SEED_DEMO_DATA: "true"` par défaut dans ce fichier) :
   - email : `admin@demo.local`
   - mot de passe : `Demo1234!`
7. Vérifier `GET https://VOTRE-BACKEND.onrender.com/health` → `{"status":"ok","database":"ok"}`.

### Mises à jour

Un `git push` sur la branche connectée déclenche automatiquement un redéploiement des deux
services Docker (comportement par défaut de Render pour un déploiement depuis un dépôt Git).

## Smoke tests post-déploiement

Vérification légère après chaque déploiement — **ne remplace pas** la suite de tests automatisés
exécutée en développement, sert uniquement à confirmer qu'un déploiement particulier fonctionne :

1. `GET /health` → `200 {"status":"ok","database":"ok"}`
2. Connexion (`POST /api/v1/auth/login`) avec un compte réel
3. Sélection d'une entreprise
4. Consultation du tableau de bord (`GET /companies/:id/dashboard`)
5. Consultation d'un rapport (`GET /companies/:id/reports/journal`)
6. Création d'une écriture comptable (brouillon)
7. Validation de cette écriture
8. Consultation du journal d'audit (`GET /companies/:id/audit-logs`) — l'événement de validation
   ci-dessus doit y apparaître
9. Upload d'une pièce jointe
10. Téléchargement de cette même pièce jointe
11. Consultation des taxes (`GET /companies/:id/tax-declarations`)
12. Consultation des budgets (`GET /companies/:id/budgets`)
13. Isolation : avec un compte d'une autre entreprise, vérifier qu'aucune des ressources créées
    aux points 6-12 n'est visible

Si l'un de ces points échoue, ne pas considérer le déploiement comme terminé — revenir à la
version précédente (§20, rollback applicatif) le temps de diagnostiquer.

## Ce qui a été réellement testé dans ce sandbox vs. ce qui reste à valider en production réelle

**Réellement testé ici** : migrations rejouées depuis une base vide (17/17, structure identique),
chaîne complète de seeds (permissions + démo), cycle backup/restauration PostgreSQL complet avec
comparaison de structure et de données, cycle backup/restauration des pièces jointes avec
comparaison binaire, `GET /health` (succès et échec simulé), correction du login de démonstration
vérifiée avec le vrai algorithme Argon2id de l'application, la suite de tests automatisés complète
contre PostgreSQL réel, tous les builds (`tsc`, `nest build`, `next build`, `next lint`).

**Reste à valider sur un vrai serveur de production** : accès réseau réel vers
`binaries.prisma.sh` pour `prisma generate` (non testable dans ce sandbox), certificat TLS réel et
chaîne HTTPS complète, comportement sous charge réelle (volumétrie, plusieurs utilisateurs
simultanés), réplication PostgreSQL/haute disponibilité, réplication géographique des sauvegardes,
supervision infrastructure (CPU/RAM/disque/alertes).
