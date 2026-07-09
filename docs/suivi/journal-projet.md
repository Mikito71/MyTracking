# Journal projet

## 2026-07-05

### Evenement

Creation de l'agent IA de pilotage de refonte logicielle dans cette conversation.

### Livrables initialises

- instructions de l'agent ;
- workflow de refonte ;
- backlog initial ;
- fiche logiciel existant ;
- cartographie fonctionnelle ;
- architecture cible ;
- plan de migration ;
- registre des risques ;
- template de decision.

### Prochaines actions

- Renseigner le nom du logiciel a refondre.
- Identifier la technologie actuelle.
- Identifier la stack cible souhaitee.
- Lister les modules fonctionnels principaux.

## 2026-07-05 - Analyse initiale du projet source

### Source fournie

`C:\Mes Projets\Projet_texte\MY TRACKING\mytracking`

### Constats

- Projet WinDev principal : `mulcol.WDP`.
- Description projet observee : `Multi colis`.
- Application desktop generee en `mulcol.exe`.
- Base/analyse WinDev observee dans `Analyse`.
- La racine contient notamment 290 fenetres `.wdw`, 232 requetes `.WDR`, 128 etats `.wde`, 62 classes `.wdc` et 12 collections `.wdg`.
- Le domaine central semble etre l'expedition/position, avec facturation, tournees, affretement, editions et integrations autour.

### Livrables mis a jour

- `docs/analyse/fiche-logiciel-existant.md`
- `docs/analyse/inventaire-source.md`
- `docs/analyse/cartographie-fonctionnelle.md`
- `docs/architecture/plan-migration.md`
- `docs/risques/registre-risques.md`
- `backlog/epics.md`

### Prochaines actions

- Extraire le modele de donnees depuis l'analyse WinDev.
- Analyser le domaine expedition en detail.
- Inventorier les editions obligatoires.
- Cartographier les integrations GLS, PTV, ERP, EDI et XML.

## 2026-07-05 - Cadrage SaaS MyTracking

### Decision

La cible de refonte est maintenant formulee comme application SaaS moderne.

### Stack cible

- Web : Next.js
- Mobile : React Native Expo
- API : NestJS
- Base serveur : PostgreSQL
- Base mobile : SQLite
- ORM : Prisma
- Deploiement : Docker

### Regles de travail ajoutees

- Travailler par petites etapes.
- Lire les fichiers existants avant d'agir.
- Proposer un plan court avant modification.
- Modifier uniquement les fichiers necessaires.
- Ne jamais supprimer de code sans expliquer.
- Ne jamais toucher aux secrets ou mots de passe.
- Creer des fichiers clairs et documentes.
- Garder une architecture simple.
- Donner les commandes de test quand il y a du code a verifier.
- Resumer chaque changement.

### Livrables mis a jour

- `README.md`
- `agent/instructions.md`
- `workflows/saas.md`
- `docs/architecture/architecture-cible.md`

### Prochaines actions

- Creer une decision ADR pour confirmer la stack cible.
- Decider si le SaaS est multi-tenant des le depart.
- Choisir le premier domaine a transformer en module SaaS, probablement `Expedition`.

## 2026-07-05 - Clarification des deux metiers

### Decision fonctionnelle

MyTracking doit gerer deux metiers differents :

- transporteur / livreur : l'entreprise recoit des expeditions, les livre elle-meme ou les confie a un confrere ;
- affreteur : l'entreprise organise des transports via des affretes/partenaires, avec dossiers, prix, confirmations, suivi et marge.

### Impact

La refonte ne doit pas etre pensee comme un cockpit unique generique. Elle doit distinguer :

- un espace Exploitation / Livraison ;
- un espace Affretement ;
- un socle commun pour clients, expeditions, documents, statuts, facturation, historique et integrations.

### Livrables mis a jour

- `docs/analyse/fiche-logiciel-existant.md`
- `docs/analyse/cartographie-fonctionnelle.md`
- `docs/architecture/architecture-cible.md`
- `backlog/epics.md`
- `docs/risques/registre-risques.md`

## 2026-07-05 - Extraction initiale du modele de donnees

### Sources

- `C:\Mes Projets\Projet_texte\MY TRACKING\mytracking\Analyse\mulcol.xdd`
- `C:\Mes Projets\Projet_texte\MY TRACKING\mytracking\Analyse\mulcol.wdd`
- classes WinDev `_*.wdc`

### Resultats

- `mulcol.xdd` est lisible en XML.
- 167 tables et 2856 rubriques ont ete extraites depuis l'analyse.
- 646 champs mappes ont ete extraits depuis les classes WinDev.
- La table `Expedition` est le coeur du modele avec 240 champs dans l'analyse.

### Livrables crees

- `docs/analyse/modele-donnees-initial.md`
- `knowledge/schema/xdd-schema.csv`
- `knowledge/schema/xdd-tables-summary.csv`
- `knowledge/schema/classes-mapping.csv`
- `knowledge/schema/classes-summary.csv`

### Prochaines actions

- Produire une matrice ancien -> cible pour le domaine expedition.
- Identifier les tables temporaires, archives et tables réellement metier.
- Commencer un premier schema Prisma cible, sans copier le modele WinDev tel quel.

## 2026-07-05 - Demarrage du socle Organisation

### Decision

Le premier module de la refonte SaaS sera la gestion de l'organisation :

- societe ;
- agences ;
- employes ;
- roles ;
- portee agence des expeditions.

### Regle metier de depart

Une societe peut avoir plusieurs agences. Chaque agence voit ses expeditions.

### Sources WinDev concernees

- `Societe`
- `Agence`
- `Utilisateur`
- `Chauffeur`
- `Expedition.cle_unique_agence`

### Livrables crees ou mis a jour

- `docs/architecture/module-organisation.md`
- `backlog/user-stories.md`
- `backlog/epics.md`
- `docs/analyse/modele-donnees-initial.md`

## 2026-07-05 - Strategie IDs historiques WinDev

### Clarification

Les identifiants WinDev doivent etre conserves pour la migration :

- `Societe.IDSociete`
- `Agence.Idagence`
- `Utilisateur.IDUtilisateur`
- `Chauffeur.IDChauffeur`
- `Expedition.IDExpedition`

### Decision

Le SaaS aura ses propres IDs applicatifs, mais conservera les IDs WinDev dans des champs `legacyId` ou `legacy*Id`.

### Impact

- Les relations nouvelles utiliseront les IDs SaaS.
- Les IDs WinDev serviront a la migration, aux controles et a la tracabilite.
- `Expedition.cle_unique_agence` restera la cle principale pour rattacher les anciennes expeditions a une agence via `Agency.legacyUniqueKey`.

## 2026-07-05 - Profils multiples par employe

### Clarification

Un employe peut avoir plusieurs profils : comptabilite, exploitation, affretement, chauffeur, administration, lecture seule.

### Decision

Le rattachement a une agence et les droits metier sont separes :

- `AgencyMembership` definit les agences auxquelles l'employe est rattache ;
- `Profile` definit un profil de droits ;
- `EmployeeProfileAssignment` attribue un profil a un employe, globalement ou pour une agence precise.

## 2026-07-05 - Backoffice administrateur plateforme V1

### Decision

La premiere version du backoffice administrateur commence par la creation des societes clientes.

### Perimetre V1

- liste des societes clientes ;
- creation d'une societe cliente ;
- choix entre nouvelle societe et reprise WinDev ;
- suivi du statut de provisioning ;
- affichage des informations non sensibles de la base dediee ;
- preparation du suivi migration ODBC pour les clients existants.

### Regles

- Le backoffice appartient au control plane.
- Les donnees metier restent dans la base dediee du tenant.
- Aucun secret, mot de passe ou chaine de connexion complete ne doit etre saisi ou affiche dans cette interface.

### Livrables crees ou mis a jour

- `docs/architecture/backoffice-administrateur.md`
- `docs/architecture/architecture-cible.md`
- `backlog/epics.md`
- `backlog/user-stories.md`
- `backlog/tickets-techniques.md`
- `docs/suivi/tableau-avancement.md`

## 2026-07-05 - Environnement beta OVH

### Decision

Creer un espace de test `mytracking-beta` deplacable facilement vers un autre serveur.

### Architecture retenue

- dossier cible serveur : `/opt/mytracking-beta` ;
- orchestration : Docker Compose ;
- configuration : fichier `.env` hors depot ;
- base beta : PostgreSQL dans un volume nomme ;
- reverse proxy local pour exposer web et API ;
- sauvegarde/restauration documentee.

### Regles

- Aucun secret n'est versionne.
- Le beta reste separe de la production.
- Le dossier et la sauvegarde PostgreSQL doivent permettre un deplacement serveur rapide.

### Livrables crees

- `infra/environments/mytracking-beta/docker-compose.yml`
- `infra/environments/mytracking-beta/.env.example`
- `infra/environments/mytracking-beta/nginx/default.conf`
- `infra/environments/mytracking-beta/README.md`
- `infra/environments/mytracking-beta/backup-restore.md`
- `docs/architecture/deploiement-mytracking-beta.md`

## 2026-07-05 - Recherche informations OVH dans Qualisol

### Source consultee

`C:\Users\mikae\OneDrive\Documents\DTDICT-qualisol`

### Informations trouvees

- hote public Qualisol : `https://51-210-14-228.sslip.io` ;
- IP serveur deduite : `51.210.14.228` ;
- API Qualisol documentee sur `/api-docs` et `/api-docs-json` ;
- ports locaux documentes : API `3010`, web `3001`, PostgreSQL `5433`.

### Informations non trouvees

- utilisateur SSH ;
- cle SSH ;
- chemin serveur exact ;
- configuration reverse proxy reelle ;
- script de deploiement distant.

### Impact MyTracking

L'environnement beta MyTracking peut etre prepare pour l'URL provisoire `https://mytracking-beta.51-210-14-228.sslip.io`, tout en restant isole du service Qualisol.

### Livrables mis a jour

- `docs/architecture/serveur-ovh-observe.md`
- `docs/architecture/deploiement-mytracking-beta.md`
- `infra/environments/mytracking-beta/.env.example`

## 2026-07-05 - Installation mytracking-beta sur OVH

### Action realisee

Creation de l'espace beta MyTracking sur le serveur OVH.

### Serveur

```text
ubuntu@51.210.14.228
hostname: vps-05b8f147
```

### Emplacement

```text
/home/ubuntu/saas/mytracking-beta
```

### URL

```text
https://mytracking-beta.51-210-14-228.sslip.io
```

### Configuration

- Docker Compose ;
- PostgreSQL beta dans le volume `mytracking-beta-postgres-data` ;
- reverse proxy beta local sur `127.0.0.1:3100` ;
- Caddy public vers `127.0.0.1:3100` ;
- `.env` genere sur le serveur, non versionne, permission `600`.

### Verification

- les conteneurs `mytracking-beta` sont demarres ;
- PostgreSQL est healthy ;
- l'URL publique repond en HTTP 200 via HTTPS ;
- le fichier Caddy a ete sauvegarde avant modification.

## 2026-07-06 - Prototypes login admin et client

### Action realisee

Creation de deux premieres pages statiques de connexion :

- login administrateur plateforme ;
- login client societe.

### Objectif

Valider une premiere direction visuelle avant integration Next.js.

### Livrables crees

- `prototypes/auth/login-admin.html`
- `prototypes/auth/login-client.html`
- `prototypes/auth/auth.css`
- `prototypes/auth/assets/login-operations-bg.png`

### Publication beta

Les pages ont ete copiees dans l'environnement beta statique :

- `infra/environments/mytracking-beta/static/login-admin.html`
- `infra/environments/mytracking-beta/static/login-client.html`

URLs de test :

- `https://mytracking-beta.51-210-14-228.sslip.io/login-admin.html`
- `https://mytracking-beta.51-210-14-228.sslip.io/login-client.html`

Verification : les deux pages et l'image de fond repondent en HTTP 200.

## 2026-07-06 - Simplification connexion client

### Decision

Le code societe n'est pas demande sur la page de connexion client.

### Raison

Si l'email utilisateur est rattache a une societe, le systeme peut retrouver automatiquement le tenant, la societe, les agences et les profils.

### Impact

- la page client demande seulement email et mot de passe ;
- le code societe reste utile au backoffice, a la migration et aux imports ;
- le cas d'un meme email rattache a plusieurs societes reste a trancher avant developpement.

### Livrables mis a jour

- `prototypes/auth/login-client.html`
- `docs/architecture/module-organisation.md`
- `docs/architecture/backoffice-administrateur.md`
- `backlog/user-stories.md`

## 2026-07-06 - Page admin creation societe et acces personnel

### Action realisee

Creation d'une premiere page statique de backoffice admin pour :

- creer une societe cliente ;
- renseigner SIRET/Kbis ;
- preparer les premiers acces du personnel ;
- visualiser le principe de base dediee.

### Securite

L'email administrateur est affiche comme identifiant de demo, mais le mot de passe n'est pas stocke dans les fichiers du projet.

### Livrables crees ou mis a jour

- `prototypes/auth/admin-create-company.html`
- `prototypes/auth/login-admin.html`
- `prototypes/auth/auth.css`

### Publication beta

La page admin est publiee sur :

```text
https://mytracking-beta.51-210-14-228.sslip.io/admin/create-company.html
```

L'acces `/admin/*` est protege cote Caddy par authentification basique avec l'email administrateur fourni. Le mot de passe n'est pas stocke en clair dans le projet.

Verification :

- sans authentification : HTTP 401 ;
- avec authentification admin : HTTP 200.

## 2026-07-06 - Remplacement Basic Auth par page login admin

### Probleme constate

La protection Basic Auth du navigateur affichait `Nom d'utilisateur` au lieu d'une vraie page MyTracking demandant l'email administrateur.

### Correction

Ajout d'un petit service beta `admin-auth` qui :

- affiche `/admin/login.html` avec le champ `Email administrateur` ;
- verifie l'email admin et le hash du mot de passe cote serveur ;
- cree un cookie de session admin ;
- redirige vers `/admin/create-company.html` apres connexion ;
- protege `/admin/*` sans afficher la fenetre native du navigateur.

### Verification

- `/admin/login.html` repond en HTTP 200 ;
- `/admin/create-company.html` redirige vers `/admin/login.html` sans session ;
- la connexion admin redirige vers `/admin/create-company.html` ;
- le mot de passe n'est pas stocke en clair dans les fichiers du projet.

## 2026-07-09 - Test connexion ODBC HFSQL Opentrans_aff

### Source

Serveur HFSQL Client/Serveur fourni :

```text
217.182.143.218:4900
Base : Opentrans_aff
Utilisateur : Admin
Mot de passe : vide
```

### Resultat

Connexion ODBC reussie avec le driver HFSQL 64-bit installe localement.

Tables et volumes verifies :

- `Societe` : 2
- `Agence` : 1
- `Clients` : 814
- `Expedition` : 18532
- `Affretes` : 3721
- `Chauffeur` : 0

### Point d'attention

La table `Utilisateur` n'est pas visible dans cette base. Les tables utilisateur/personnel visibles sont `ParamUser`, `UserCaisse`, `Chauffeur` et `POSITION_CHAUFFEUR`.

Le driver retourne les donnees, mais le processus PowerShell se termine brutalement apres fermeture de connexion. Il faudra donc tester un import par lots robuste.

### Livrable cree

- `docs/analyse/test-connexion-odbc-hfsql-opentrans-aff.md`

## 2026-07-09 - Tableau recapitulatif admin societes

### Demande

Dans la partie admin, afficher en premier lieu un tableau recapitulatif des societes clientes avec un bouton `Nouveau`.

### Action realisee

Creation d'une page admin d'accueil :

```text
/admin/index.html
```

Elle contient :

- indicateurs rapides ;
- recherche ;
- filtre statut ;
- tableau des societes clientes ;
- bouton `Nouveau` vers la creation societe ;
- exemples de lignes pour actif, migration et brouillon.

### Publication beta

Apres connexion admin, l'utilisateur est redirige vers :

```text
https://mytracking-beta.51-210-14-228.sslip.io/admin/index.html
```

### Verification

- sans session : redirection vers `/admin/login.html` ;
- apres connexion : redirection vers `/admin/index.html` ;
- la page contient `Societes clientes`, `Nouveau`, `TransPlus Demo` et `Opentrans Affretement`.

## 2026-07-09 - Synthese fonctionnalites TMS et affretement

### Action realisee

Stockage dans le projet de la recherche web sur les fonctionnalites possibles d'un TMS et d'un logiciel d'affretement.

### Livrable cree

- `docs/analyse/fonctionnalites-tms-affretement.md`

### Usage

Ce document sert de reference pour enrichir le backlog MyTracking et prioriser le futur MVP.

### Impact

Cette approche permet de gerer les cas mixtes, par exemple exploitation + compta, compta multi-agence, ou affretement limite a une agence.

## 2026-07-05 - Multi-tenant par base dediee

### Clarification

Le SaaS doit gerer plusieurs societes clientes. Chaque societe doit disposer d'une base metier independante afin de pouvoir isoler les gros volumes et deplacer une societe rapidement si necessaire.

### Decision cible

Adopter une architecture avec :

- un control plane plateforme pour referencer les tenants et leurs bases ;
- une base PostgreSQL dediee par societe cliente pour les donnees metier.

### Impact

- La creation d'une nouvelle societe depuis le backoffice doit provisionner une nouvelle base.
- Les agences, employes, expeditions, factures et documents vivent dans la base de la societe.
- Les secrets de connexion ne doivent pas etre stockes dans les documents ni dans le code versionne.
- Les migrations devront etre appliquees par tenant.

## 2026-07-05 - Import ODBC WinDev pour clients existants

### Clarification

Un client deja existant dans WinDev doit pouvoir etre importe dans le SaaS via un client ODBC, sans perte de donnees.

### Decision

Prevoir un workflow d'import controle :

- source ODBC configuree hors depot ;
- dry-run obligatoire ;
- conservation des IDs WinDev dans des champs `legacy*` ;
- import par lots ;
- rapports de comptage source/cible ;
- relance idempotente sans doublons ;
- controle avant bascule.

### Livrables

- `docs/architecture/migration-odbc-windev.md`
- `docs/architecture/plan-migration.md`
- `backlog/user-stories.md`
- `docs/risques/registre-risques.md`
