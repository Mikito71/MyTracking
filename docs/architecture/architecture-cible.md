# Architecture cible

## Hypothese actuelle

La stack cible est definie pour transformer MyTracking en SaaS moderne :

- front web : Next.js ;
- mobile : React Native Expo ;
- API : NestJS ;
- base serveur : PostgreSQL ;
- base mobile : SQLite ;
- ORM : Prisma ;
- deploiement : Docker.

## Principes

- Maintenabilite avant sophistication.
- Separation claire entre logique metier, interface, donnees et integrations.
- Tests automatises sur les comportements critiques.
- Documentation des decisions structurantes.
- Migration progressive si l'ancien logiciel est en production.
- Architecture simple, decoupee par domaines metier.
- API backend responsable des regles serveur et de la coherence globale.
- Mobile concu pour fonctionner offline sur les actions terrain critiques.
- Synchronisation explicite, observable et testable.
- Aucun secret ni mot de passe dans les fichiers versionnes.

## Vue cible a completer

| Couche | Choix | Responsabilite | Notes |
| --- | --- | --- | --- |
| Web | Next.js | Interface bureau SaaS pour exploitation, administration, facturation et suivi | Priorite aux workflows denses et efficaces |
| Mobile | React Native Expo | Application Android/iPhone terrain avec offline | SQLite local et synchronisation |
| API | NestJS | Cas d'usage, validation, securite, orchestration, synchronisation | Modules par domaine metier |
| ORM serveur | Prisma | Modele PostgreSQL, migrations, acces donnees serveur | Schema derive du metier, pas copie brute WinDev |
| Base serveur | PostgreSQL | Donnees centrales, multi-utilisateurs, historique, audit | Base dediee par societe cliente |
| Base mobile | SQLite | Donnees operationnelles locales et file de mutations | Perimetre limite aux besoins terrain |
| Deploiement | Docker | Environnements reproductibles | Compose local puis cible cloud a definir |
| Integrations | API/Workers a definir | GLS, PTV, ERP, EDI, exports/imports | Compatibilite a cartographier |

## Organisation par metiers

La cible SaaS doit distinguer deux espaces metier.

### Espace Exploitation / Livraison

Pour les utilisateurs qui recoivent, preparent, suivent et livrent des expeditions.

Priorites UX :

- vue operationnelle des expeditions a traiter ;
- affectation tournee ou confrere ;
- statuts temps reel ;
- scans et preuves ;
- incidents et retards ;
- synchronisation mobile terrain.

### Espace Affretement

Pour les utilisateurs qui confient des transports a des affretes/partenaires.

Priorites UX :

- dossiers d'affretement ;
- selection affrete ;
- achat/vente/marge ;
- confirmations ;
- documents ;
- suivi administratif.

### Socle commun

Les espaces partagent un socle :

- clients ;
- expeditions ;
- documents ;
- statuts ;
- facturation ;
- historique ;
- integrations ;
- droits utilisateurs.

Cette separation doit guider la navigation, le modele de droits, les modules API et les ecrans. Elle evite de reduire MyTracking a un dashboard unique trop vague.

## Architecture logique proposee

```text
apps/
  web/        Next.js
  mobile/     Expo
  api/        NestJS
packages/
  shared/     types, schemas, helpers partages
  database/   Prisma schema, migrations, seed
infra/
  docker/     Dockerfiles et compose
docs/
  analyse/
  architecture/
  decisions/
```

Cette structure est une proposition de depart. Elle devra etre confirmee avant creation du code applicatif.

## Multi-tenant par base dediee

Decision cible : chaque societe cliente dispose de sa propre base PostgreSQL metier.

Cette approche separe deux plans :

### Control plane

Base centrale minimale geree par la plateforme MyTracking.

Responsabilites :

- lister les societes clientes ;
- stocker le statut du tenant ;
- connaitre l'emplacement de la base de chaque societe ;
- gerer le provisioning initial ;
- suivre les versions de schema/migration ;
- gerer les operations d'administration plateforme.

Exemples d'entites :

- `Tenant`
- `TenantDatabase`
- `TenantProvisioningJob`
- `PlatformUser`

Le premier ecran a construire cote plateforme est le backoffice administrateur de creation des societes clientes. Voir `docs/architecture/backoffice-administrateur.md`.

### Tenant plane

Base dediee a une societe cliente.

Responsabilites :

- agences ;
- employes ;
- profils ;
- expeditions ;
- clients ;
- facturation ;
- tournees ;
- affretement ;
- historique ;
- synchronisation mobile.

### Pourquoi ce choix

- isolation forte des donnees entre societes ;
- gros volumes plus faciles a isoler ;
- sauvegarde/restauration par societe ;
- deplacement d'une societe vers un autre serveur plus simple ;
- maintenance ou migration progressive par tenant ;
- possibilite de dimensionner differemment les gros clients.

### Contraintes

- provisioning plus complexe ;
- migrations Prisma a appliquer sur plusieurs bases ;
- monitoring par tenant obligatoire ;
- gestion des connexions plus stricte ;
- backoffice plateforme indispensable.

### Regle

Une nouvelle societe creee depuis le backoffice plateforme doit provisionner une nouvelle base metier independante.

Les relations metier internes d'une societe restent dans sa base dediee. Le control plane ne doit pas porter les expeditions, factures, clients ou donnees operationnelles.

## Synchronisation offline

Principes initiaux :

- Le serveur PostgreSQL reste la source de verite globale.
- Le mobile stocke localement dans SQLite les donnees utiles a l'utilisateur connecte.
- Les actions offline sont enregistrees comme mutations locales.
- La synchronisation pousse les mutations locales puis recupere les changements serveur.
- Les conflits doivent etre visibles, explicites et resolus par regles metier.
- Chaque module mobile doit declarer ce qui est consultable offline et ce qui est modifiable offline.

## Questions techniques

- La refonte doit-elle remplacer l'ancien logiciel en une fois ou progressivement ?
- Quelles donnees doivent etre migrees ?
- Quels systemes externes doivent rester compatibles ?
- Quels volumes et contraintes de performance sont connus ?
- Le SaaS doit-il etre multi-tenant des le depart ?
- Quels roles utilisateurs sont necessaires ?
- Quelles operations mobiles doivent fonctionner sans reseau ?
- Quelle strategie de resolution de conflits est acceptable metier par metier ?
- Les utilisateurs doivent-ils pouvoir basculer entre espace Exploitation et espace Affretement ?
- Une expedition confiee a un confrere releve-t-elle de l'exploitation, de l'affretement, ou d'un pont entre les deux ?
- Le provisioning d'une base societe doit-il etre automatique des le MVP ou semi-automatique au debut ?
- Quel niveau d'isolation technique faut-il prevoir : base par societe sur le meme serveur PostgreSQL, ou serveur PostgreSQL dedie pour les gros clients ?
