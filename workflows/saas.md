# Workflow MyTracking SaaS

Ce workflow guide la transformation de MyTracking en application SaaS web/API/mobile avec offline et synchronisation.

## 1. Extraire le metier existant

But : comprendre les domaines WinDev avant de les reconstruire.

Sorties attendues :

- domaines metier ;
- regles critiques ;
- donnees principales ;
- ecrans sources ;
- requetes et editions liees ;
- comportements a conserver.

Fichiers :

- `docs/analyse/cartographie-fonctionnelle.md`
- `docs/analyse/inventaire-source.md`
- `docs/analyse/matrice-ancien-nouveau.md`

## 2. Definir le domaine SaaS

But : transformer un module existant en modele SaaS clair.

Sorties attendues :

- entites metier ;
- schema Prisma ;
- ownership des donnees ;
- multi-tenant si necessaire ;
- evenements metier ;
- droits et roles.

Fichiers :

- `docs/architecture/architecture-cible.md`
- `docs/decisions/`

## 3. Concevoir l'API NestJS

But : exposer les cas d'usage via une API simple.

Sorties attendues :

- modules NestJS ;
- routes REST ;
- DTO ;
- validations ;
- services ;
- tests API.

Principes :

- API orientee cas d'usage, pas simple copie des tables WinDev.
- Validation stricte en entree.
- Erreurs explicites.
- Pagination et filtres pour les listes.

## 4. Concevoir le web Next.js

But : couvrir les workflows bureau avec une interface web moderne.

Sorties attendues :

- pages ;
- composants ;
- formulaires ;
- tables ;
- filtres ;
- etats de chargement/erreur ;
- tests front si necessaire.

Principes :

- Interface efficace pour l'exploitation quotidienne.
- Pas de page marketing dans l'application metier.
- Navigation claire entre liste, fiche, detail et actions.

## 5. Concevoir le mobile Expo

But : couvrir les usages terrain Android/iPhone.

Sorties attendues :

- ecrans mobiles ;
- stockage SQLite ;
- file de mutations offline ;
- indicateurs de synchronisation ;
- gestion des erreurs reseau ;
- tests des scenarios offline.

Principes :

- Le mobile doit rester utilisable sans reseau pour les actions terrain critiques.
- Les donnees locales doivent etre limitees au besoin operationnel.
- Toute mutation offline doit etre idempotente ou reconciliable.

## 6. Synchroniser les donnees

But : garantir la coherence serveur/mobile.

Sorties attendues :

- strategie de sync ;
- horodatage et versions ;
- resolution des conflits ;
- endpoints de pull/push ;
- journal des mutations ;
- tests de conflits.

Questions a traiter :

- Quelle donnee est modifiable sur mobile ?
- Qui gagne en cas de conflit ?
- Quels statuts sont visibles par l'utilisateur ?
- Quels volumes doivent etre synchronises ?

## 7. Conteneuriser et deployer

But : rendre le projet reproductible.

Sorties attendues :

- `Dockerfile` par service si necessaire ;
- `docker-compose.yml` local ;
- PostgreSQL local ;
- migrations Prisma ;
- commandes de lancement ;
- commandes de test.

## 8. Verifier la continuite

But : prouver que le nouveau module remplace correctement l'ancien.

Sorties attendues :

- matrice ancien/nouveau ;
- scenarios de recette ;
- tests automatises ;
- ecarts documentes ;
- decision de bascule.
