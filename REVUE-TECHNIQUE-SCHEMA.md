# Revue technique — Architecture & Schéma Prisma (avant Étape 3)

Revue menée sans ajout de fonctionnalité, uniquement sur la robustesse du modèle de données
existant (`backend/prisma/schema.prisma`, 30 modèles).

---

## 1. Éléments correctement conçus

- **UUID** partout, **`Decimal(18,2)`** systématique sur tous les montants (écritures, factures,
  paiements, immobilisations, budgets) — aucun `Float`, c'est le bon choix pour éviter les erreurs
  d'arrondi.
- **Isolation par `companyId`** présente sur toutes les entités « racine » (`Account`, `Journal`,
  `AccountingEntry`, `Customer`, `Supplier`, `Invoice`, `Payment`, `CashAccount`, `BankAccount`,
  `FixedAsset`, `TaxDeclaration`, `Budget`, `Attachment`).
- **Fiscalité non codée en dur** : `Tax` est piloté par `country` + `code` + `rate` + dates de
  validité, sans aucune valeur figée dans le code.
- **Contraintes d'unicité par entreprise** (`@@unique([companyId, code])`, etc.) correctement
  posées sur `Account`, `Journal`, `Customer`, `Supplier`, `Invoice.invoiceNumber`, `Quote.quoteNumber`.
- **`EntryStatus`** (`DRAFT` / `VALIDATED` / `REVERSED`) pose la bonne base pour l'immuabilité, et
  `JournalType` inclut déjà `OPENING`/`CLOSING`, nécessaires aux reports à nouveau et à la clôture.
- **`AuditLog`** générique (`entityType` + `entityId` + `oldValue`/`newValue` en `Json`) est une
  bonne base extensible sans migration à chaque nouveau type d'événement.

---

## 2. Problèmes potentiels identifiés

### 2.1 Intégrité comptable (critique)
- Rien n'empêche, **au niveau base de données**, qu'une écriture passe en `VALIDATED` alors que
  `totalDebit ≠ totalCredit` : ce sont des colonnes ordinaires, alimentées uniquement par le service
  NestJS. Si un bug applicatif ou un accès direct à la base contourne le service, une écriture
  déséquilibrée peut être validée.
- Rien n'empêche, **au niveau base de données**, la modification ou la suppression d'une
  `AccountingEntryLine` appartenant à une écriture `VALIDATED`. La protection n'existe qu'au niveau
  service — c'est une garantie insuffisante pour un logiciel comptable réglementaire.
- Le mécanisme de contrepassation actuel (`reversedEntryId` porté par l'écriture **d'origine**,
  pointant vers l'écriture de contrepassation) a une sémantique inversée par rapport à l'usage
  naturel (« quelle écriture a contrepassé celle-ci ? ») et est source d'erreurs de lecture pour un
  développeur qui rejoint le projet.

### 2.2 Multi-tenant (critique)
- **Fuite possible par les tables de détail** : `AccountingEntryLine`, `InvoiceItem`, `QuoteItem`,
  `CashTransaction`, `BankTransaction`, `BankReconciliation`, `DepreciationEntry` et `BudgetLine`
  **n'ont pas de colonne `companyId` propre** — l'entreprise ne se déduit que par une jointure
  (`entryId → AccountingEntry.companyId`, `cashAccountId → CashAccount.companyId`, etc.). Si un
  développeur écrit un jour une requête directe sur une de ces tables sans reconstituer la jointure
  complète (`prisma.accountingEntryLine.findMany({ where: { accountId } })` par exemple), rien
  n'empêche techniquement de retourner des lignes d'une autre entreprise partageant, par erreur, un
  même `accountId`. C'est la faille multi-tenant la plus concrète du schéma actuel.
- **`linkedEntryId` en simple `String`** (sur `Invoice`, `Payment`, `CashTransaction`,
  `BankTransaction`, `DepreciationEntry`) : ce n'est **pas une vraie clé étrangère**. Rien ne garantit
  que l'écriture référencée existe, ni qu'elle appartient à la même entreprise que le document source.
  C'est à la fois un problème d'intégrité référentielle et un point d'entrée théorique pour relier un
  document à une écriture d'une autre entreprise.
- `AccountingPeriod.closedBy` est un `String` libre (pas une relation vers `User`) : aucune garantie
  que la valeur correspond à un utilisateur réel, et impossible à exploiter pour un rapport
  d'audit fiable.

### 2.3 Suppression / CASCADE (élevé)
`onDelete: Cascade` est actuellement posé sur la quasi-totalité des relations partant de `Company`
(`AccountingPeriod`, `Account`, `Journal`, `AccountingEntry`, `Customer`, `Supplier`, `Quote`,
`Invoice`, `Payment`, `CashAccount`, `BankAccount`, `FixedAsset`, `TaxDeclaration`, `Budget`,
`Attachment`, `AuditLog`...). Concrètement, **supprimer une ligne `Company` en base efface aujourd'hui
la totalité de la comptabilité de cette entreprise sans laisser de trace.** C'est inacceptable pour un
logiciel réglementaire (obligation légale de conservation des pièces comptables sur plusieurs années
en zone OHADA).

### 2.4 Numérotation (élevé)
- `entryNumber`, `invoiceNumber`, `quoteNumber` sont de simples `String` uniques : la génération du
  prochain numéro doit être gérée entièrement côté application. Sans mécanisme dédié, l'implémentation
  naturelle (`count() + 1`) est **sujette aux conditions de course** en environnement multi-utilisateur
  (deux comptables validant une facture à la même seconde peuvent obtenir le même numéro avant que le
  premier `INSERT` ne soit committé).
- **Aucun numéro de paiement** n'existe sur le modèle `Payment` (seul un `reference` libre et optionnel
  est présent), alors que la traçabilité des paiements est demandée explicitement.

### 2.5 Exercices comptables (moyen)
- Rien n'empêche, dans le schéma, la création de deux `AccountingPeriod` aux dates chevauchantes pour
  la même entreprise.
- Aucun champ ne distingue une clôture d'une réouverture contrôlée (`reopenedAt`, `reopenedBy`,
  motif) — seul `closedAt`/`closedBy` existe.

### 2.6 SYSCOHADA — lettrage (élevé, fonctionnalité manquante)
Le **lettrage** (rapprochement des lignes débit/crédit d'un compte auxiliaire client ou fournisseur
pour identifier les factures soldées) n'existe pas du tout dans le schéma actuel. C'est une fonction
centrale de toute comptabilité SYSCOHADA/OHADA sur les comptes de tiers (401x, 411x) et son absence
est un manque fonctionnel, pas seulement un détail technique.

### 2.7 Performance (moyen)
- Aucun index composite `[companyId, entryDate]` sur `AccountingEntry` (seul un index simple sur
  `entryDate` existe) — dans un système multi-tenant, la quasi-totalité des requêtes filtrent d'abord
  par entreprise, donc l'index doit commencer par `companyId`.
- Aucun index pour la recherche par tiers (`partnerId`) sur `AccountingEntryLine`, ni pour la
  recherche de factures par échéance (`dueDate`), ni de paiements par date.

---

## 3. Modifications obligatoires

Ces points seraient bloquants pour un usage réel multi-entreprise et sont corrigés dans le schéma
livré ci-dessous.

1. **Dénormaliser `companyId`** sur `AccountingEntryLine`, `InvoiceItem`, `QuoteItem`,
   `CashTransaction`, `BankTransaction`, `BankReconciliation`, `DepreciationEntry`, `BudgetLine`.
   Objectif : chaque requête sur une table de détail peut (et **doit**, au niveau service) filtrer
   directement sur `companyId` sans dépendre d'une jointure — filet de sécurité en profondeur, en plus
   du guard applicatif.
2. **Remplacer tous les `linkedEntryId: String` par de vraies relations** vers `AccountingEntry`
   (`onDelete: Restrict`), sur `Invoice`, `Payment`, `CashTransaction`, `BankTransaction`,
   `DepreciationEntry`. Une écriture référencée par un document ne peut plus être supprimée tant que
   le lien existe.
3. **`AccountingPeriod.closedBy` → relation réelle vers `User`** (`closedById`), et ajout de
   `reopenedAt` / `reopenedById` / `reopenReason` pour une réouverture tracée et non anonyme.
4. **Corriger la direction de la contrepassation** : le champ porteur passe de l'écriture d'origine
   vers l'écriture de contrepassation elle-même — `reversalOfEntryId` sur l'écriture **de
   contrepassation**, pointant vers l'écriture **d'origine**. Lecture naturelle : « cette écriture
   contrepasse l'écriture X », consultable dans les deux sens (`entry.reversalOfEntry`,
   `originalEntry.reversedByEntry`).
5. **`onDelete: Restrict`** (au lieu de `Cascade`) sur toutes les relations partant de `Company` vers
   les entités comptables et documentaires (`AccountingPeriod`, `Account`, `Journal`,
   `AccountingEntry`, `Customer`, `Supplier`, `Quote`, `Invoice`, `Payment`, `CashAccount`,
   `BankAccount`, `FixedAsset`, `TaxDeclaration`, `Budget`, `Attachment`). Une entreprise avec des
   données ne pourra plus jamais être supprimée physiquement — uniquement archivée
   (`CompanyStatus.ARCHIVED`, déjà présent). `AuditLog.company` passe en `onDelete: SetNull` pour
   conserver la trace même si l'entreprise disparaît un jour.
6. **Ajout du lettrage** : nouveau modèle `Lettering` (compte auxiliaire, code, statut soldé,
   créateur, date, annulation tracée) + `AccountingEntryLine.letteringId`. C'est la fonctionnalité
   SYSCOHADA manquante la plus importante du schéma actuel.
7. **Ajout d'un modèle `NumberingSequence`** (entreprise + type de document + clé de portée + valeur
   courante + préfixe) pour générer les numéros d'écritures, factures, devis et paiements de façon
   atomique (`SELECT ... FOR UPDATE` dans une transaction Prisma), au lieu d'un `count() + 1`
   non sécurisé en concurrence.
8. **Ajout de `Payment.paymentNumber`**, généré via `NumberingSequence`, avec
   `@@unique([companyId, paymentNumber])`.
9. **Index composites orientés multi-tenant** : `[companyId, entryDate]` sur `AccountingEntry`,
   `[companyId, dueDate]` sur `Invoice`, `[companyId, paymentDate]` sur `Payment`,
   `[partnerType, partnerId]` sur `AccountingEntryLine`.

---

## 4. Modifications recommandées

Non bloquantes pour l'Étape 3, mais fortement conseillées avant la mise en production réelle.

- **Contrainte d'équilibre au niveau base de données** : un `CHECK` simple ne peut pas vérifier une
  somme sur des lignes enfants. Il faudra un **trigger PostgreSQL** (`BEFORE UPDATE` sur
  `accounting_entries`, déclenché au passage à `VALIDATED`) qui recalcule `SUM(debit) = SUM(credit)`
  sur `accounting_entry_lines` et lève une exception sinon. Ce trigger ne peut pas s'exprimer dans
  `schema.prisma` (Prisma ne gère pas les triggers) : il devra être ajouté en SQL brut dans le dossier
  de migration généré (`prisma/migrations/.../migration.sql`), documenté et versionné comme le reste.
- **Trigger d'immuabilité** : `BEFORE UPDATE OR DELETE` sur `accounting_entry_lines`, qui vérifie le
  statut de l'écriture parente et rejette toute modification si `status = 'VALIDATED'`. Même remarque
  : migration SQL manuelle, pas de syntaxe Prisma native.
- **Contrainte d'exclusion PostgreSQL** (extension `btree_gist`) sur `AccountingPeriod` pour interdire
  deux périodes aux dates chevauchantes pour la même entreprise — également hors du langage Prisma
  natif, à ajouter en SQL brut dans la migration.
- **Index de recherche par nom** : `[companyId, name]` sur `Customer` et `Supplier`.
- **Enum `AuditAction`** enrichie avec `CLOSE_PERIOD`, `REOPEN_PERIOD`, `SETTINGS_CHANGE`,
  `LETTERING`, `UNLETTERING` pour couvrir explicitement les actions sensibles citées dans votre
  cahier des charges (clôture, réouverture, paramétrage).
- **Middleware Prisma d'isolation** (`$use` / Prisma Client Extensions côté service, à implémenter à
  l'Étape 4/5) qui injecte automatiquement `companyId` dans chaque requête issue d'une session
  utilisateur, en complément — jamais en remplacement — du `CompanyAccessGuard` HTTP.

---

## 5. Modifications facultatives

À envisager plus tard, sans impact sur la robustesse immédiate du socle :

- **Table de soldes matérialisés** (`AccountBalance` : entreprise + compte + période + solde
  d'ouverture/clôture) pour accélérer la balance et le grand livre sur de gros volumes, plutôt que de
  recalculer par agrégation à chaque consultation. Utile aussi pour fiabiliser les reports à nouveau.
- **Mapping compte → poste de bilan/compte de résultat SYSCOHADA** (table de correspondance), pour
  générer automatiquement les états financiers normalisés plutôt que de le coder en dur dans le module
  `reports` plus tard.
- **Support multi-devise sur les écritures** (`originalCurrency`, `originalAmount`, `exchangeRate` sur
  `AccountingEntryLine`) si le logiciel doit un jour traiter des opérations hors zone XOF/XAF — non
  nécessaire pour un socle SYSCOHADA/OHADA stricto sensu, où les livres légaux sont tenus en devise
  locale.
- **Stratégie d'arrondi de TVA configurable** (par ligne vs sur le total) au niveau `Company` ou `Tax`.

---

## 6. Schéma Prisma corrigé

Le fichier complet corrigé est fourni séparément : **`schema.prisma`** (ci-joint). Il intègre
l'ensemble des points de la section 3 (obligatoires) et les index de la section 4 qui s'expriment
nativement en Prisma. Les triggers et contraintes d'exclusion (section 4) devront être ajoutés en SQL
brut dans le dossier de migration au moment de l'Étape 3 — je vous fournirai ce SQL à ce moment-là,
une fois la première migration générée.

---

## 7. Explication des principales modifications

- **`companyId` dénormalisé sur les tables de détail** : c'est un compromis assumé de dénormalisation.
  La source de vérité reste la relation parente (`entryId`, `cashAccountId`, etc.), mais avoir la
  colonne directement sur la ligne permet (a) d'indexer et de filtrer sans jointure, ce qui compte pour
  la performance sur un grand livre volumineux, et (b) d'ajouter un filtre `where: { companyId }`
  systématique dans le service même sur les tables de détail, en filet de sécurité si jamais un
  `entryId` ou `accountId` était mal transmis par erreur applicative.
- **Vraies relations au lieu de `linkedEntryId: String`** : sans clé étrangère, la base ne peut pas
  garantir que l'écriture référencée existe ni qu'elle appartient à la bonne entreprise. Avec une
  relation Prisma/PostgreSQL, ces deux garanties deviennent automatiques, et on peut naviguer
  directement (« quelles factures ont généré cette écriture ? ») sans requête manuelle.
- **`Lettering`** en modèle séparé (plutôt qu'un simple champ « code » sur la ligne) : le lettrage
  regroupe potentiellement plus de deux lignes (une facture + deux acomptes, par exemple), et doit
  pouvoir être annulé (« délettré ») en conservant la trace de qui l'a fait et quand — ce qu'un simple
  champ texte ne permettrait pas de tracer proprement.
- **`NumberingSequence`** : centralise la génération de tous les numéros séquentiels (écritures,
  factures, devis, paiements) dans un seul mécanisme, verrouillable en transaction, plutôt que de
  réinventer une logique de comptage différente dans chaque service métier — plus sûr et plus facile à
  auditer.
- **`onDelete: Restrict` généralisé sur les données financières** : c'est le changement le plus
  important du point de vue conformité. Une suppression physique de données comptables ne doit jamais
  pouvoir se produire par accident (erreur applicative, script de maintenance mal ciblé) ; en la
  rendant impossible au niveau base de données, on protège l'obligation légale de conservation même
  contre un bug côté service.

---

## Conclusion

**MODIFICATIONS NÉCESSAIRES AVANT L'ÉTAPE 3**

Le socle est solide sur la forme (types, `Decimal`, `companyId` sur les entités racines, fiscalité
configurable), mais présente trois lacunes bloquantes pour un usage professionnel réel : l'absence de
vraies clés étrangères sur les liens vers les écritures comptables, des `CASCADE` qui permettraient la
perte physique de données comptables, et l'absence totale du lettrage. Le schéma corrigé ci-joint
traite ces points ; une fois validé de votre côté, nous pourrons enchaîner sur l'Étape 3
(configuration PostgreSQL, incluant les triggers et contraintes d'exclusion mentionnés en section 4).
