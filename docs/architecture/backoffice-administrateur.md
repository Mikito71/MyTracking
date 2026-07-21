# Backoffice administrateur plateforme

## Objectif V1

Creer une premiere version du backoffice administrateur permettant de gerer les societes clientes MyTracking au niveau plateforme.

Ce backoffice appartient au `control plane`. Il ne contient pas les donnees metier d'une societe cliente : pas d'expeditions, pas de factures, pas de clients transport, pas de documents operationnels.

## Utilisateur cible

Administrateur plateforme MyTracking.

Ce role peut :

- consulter la liste des societes clientes ;
- creer une nouvelle societe cliente ;
- suivre l'etat de creation de sa base dediee ;
- suspendre ou reactiver l'acces d'une societe ;
- voir les informations techniques non sensibles de rattachement a une base ;
- preparer une migration ODBC pour un client WinDev existant.

## Navigation V1

```text
Backoffice plateforme
  Societes
    Liste des societes
    Creation societe
    Detail societe
      Informations generales
      Base dediee
      Provisioning
      Migration WinDev
```

## Ecran : liste des societes

Objectif : voir rapidement les clients SaaS et leur etat.

Colonnes proposees :

- nom societe ;
- code societe ;
- statut ;
- base ;
- version schema ;
- derniere mise a jour ;
- action principale.

Filtres V1 :

- recherche par nom ou code ;
- statut : `DRAFT`, `PROVISIONING`, `ACTIVE`, `SUSPENDED`, `MIGRATION`, `ERROR`, `ARCHIVED`.

Actions V1 :

- creer une societe ;
- ouvrir le detail ;
- relancer un provisioning en erreur ;
- suspendre une societe active ;
- reactiver une societe suspendue.

## Ecran : creation societe

Objectif : creer le tenant plateforme et preparer la base dediee.

Champs V1 :

| Champ | Obligatoire | Notes |
| --- | --- | --- |
| Nom societe | Oui | Nom visible dans le backoffice |
| Code societe | Oui | Code court unique, stable |
| Contact principal | Non | Nom du contact client |
| Email contact | Non | Pour invitation future |
| Telephone | Non | Information administrative |
| Type de creation | Oui | Nouvelle societe ou reprise WinDev |
| Mode base | Oui | Base partagee serveur PostgreSQL ou base dediee gros client |
| Commentaire interne | Non | Note admin, sans secret |

Types de creation :

- `NEW_COMPANY` : creation d'une societe neuve ;
- `WINDEV_IMPORT` : creation d'une societe issue d'un client WinDev existant.

Regles :

- le code societe doit etre unique ;
- aucun mot de passe ni chaine de connexion complete ne doit etre saisi dans ce formulaire ;
- la creation met le tenant en statut `DRAFT` ou `PROVISIONING` selon le niveau d'automatisation choisi ;
- une base metier dediee doit etre creee avant activation complete du client.

## Ecran : detail societe

### Informations generales

Affiche :

- identifiant tenant ;
- nom ;
- code ;
- statut ;
- contact principal ;
- dates de creation et modification.

### Base dediee

Affiche uniquement les informations non sensibles :

- fournisseur ;
- hote ou alias technique ;
- nom de base ;
- port si utile ;
- version schema ;
- statut base ;
- derniere migration appliquee.

Interdit :

- mot de passe ;
- chaine de connexion complete ;
- secret ODBC ;
- token d'acces.

### Provisioning

Affiche l'historique des operations :

- creation tenant ;
- creation base ;
- application migrations ;
- creation societe initiale dans la base tenant ;
- creation ou invitation de l'administrateur societe ;
- erreur eventuelle.

Statuts proposes :

- `PENDING`
- `RUNNING`
- `FAILED`
- `COMPLETED`
- `CANCELLED`

### Migration WinDev

Pour un client existant, le detail societe doit permettre de suivre une reprise ODBC.

Informations affichees :

- statut de preparation ;
- dernier dry-run ;
- dernier import reel ;
- ecarts source/cible ;
- erreurs bloquantes ;
- date de derniere synchronisation delta.

Le parametrage technique ODBC reste hors depot et hors affichage sensible.

## Modele control plane V1

### Tenant

```text
id
companyName
companyCode
status
creationType
primaryContactName
primaryContactEmail
primaryContactPhone
internalNote
createdAt
updatedAt
```

### TenantDatabase

```text
id
tenantId
provider
hostAlias
port
databaseName
schemaVersion
status
createdAt
updatedAt
```

`hostAlias` peut etre un alias ou une reference technique non sensible. Les secrets restent dans l'environnement ou un coffre de secrets.

### TenantProvisioningJob

```text
id
tenantId
status
currentStep
errorCode
errorMessage
startedAt
finishedAt
createdAt
updatedAt
```

### TenantProvisioningEvent

```text
id
jobId
level
step
message
createdAt
```

Les messages doivent rester techniques mais non sensibles.

## API V1

Endpoints proposes :

```text
GET    /platform/tenants
POST   /platform/tenants
GET    /platform/tenants/:tenantId
POST   /platform/tenants/:tenantId/provision
POST   /platform/tenants/:tenantId/suspend
POST   /platform/tenants/:tenantId/reactivate
GET    /platform/tenants/:tenantId/provisioning-jobs
GET    /platform/tenants/:tenantId/migration-jobs
```

## Comportement de creation V1

Version simple recommandee pour demarrer :

1. L'administrateur remplit le formulaire de creation.
2. L'API cree un `Tenant` en statut `DRAFT`.
3. L'administrateur lance le provisioning.
4. L'API cree un `TenantProvisioningJob`.
5. Le job cree ou reference la base dediee.
6. Le job applique les migrations Prisma tenant.
7. Le job cree la societe initiale dans la base tenant.
8. Le tenant passe en `ACTIVE` si tout est valide.

Cette version semi-automatique est plus prudente pour le MVP. L'automatisation complete pourra venir ensuite.

## Visuel attendu

Direction ergonomique :

- interface dense, lisible, orientee administration ;
- tableau clair avec statuts visibles ;
- formulaire en deux colonnes sur desktop ;
- detail societe organise par onglets ;
- couleurs de statut sobres ;
- aucune page marketing ;
- pas de carte decorative inutile.

Premiere structure visuelle :

```text
+-------------------------------------------------------------+
| MyTracking Admin                         Creer une societe   |
+----------------------+--------------------------------------+
| Societes             | Societes clientes                    |
| Bases                | [Recherche] [Statut]                 |
| Migrations           |                                      |
| Plateforme           | Nom        Code    Statut   Base     |
|                      | TransPlus  TPL     ACTIVE   OK       |
|                      | Demo Sud   DMS     DRAFT    -        |
|                      | Client X   CLX     ERROR    Erreur   |
+----------------------+--------------------------------------+
```

## Hors perimetre V1

- gestion complete des droits plateforme ;
- paiement ou abonnement ;
- monitoring avance ;
- edition directe des secrets ;
- import complet des donnees WinDev depuis l'interface ;
- administration metier des agences et employes dans la base tenant.

## Regle d'acces client

L'acces client ne doit pas demander le code societe si le compte utilisateur est deja rattache a une societe.

Principe V1 :

- l'utilisateur client saisit son email et son mot de passe ;
- le systeme retrouve le tenant et la societe a partir du compte ;
- les agences visibles et profils disponibles sont ensuite calcules depuis les rattachements internes ;
- le code societe reste utile au backoffice et a la migration, mais pas comme champ obligatoire de connexion client.

Cas a trancher plus tard :

- un meme email peut-il etre membre de plusieurs societes clientes ?
- si oui, faut-il afficher un choix de societe apres authentification ?

## Definition of Done V1

- un administrateur peut creer une fiche societe cliente ;
- le tenant est visible dans la liste ;
- le statut de provisioning est visible ;
- les informations de base non sensibles sont consultables ;
- aucun secret n'est affiche ou stocke dans les fichiers ;
- le mode `WINDEV_IMPORT` est prevu pour les clients existants ;
- la creation d'une base dediee reste tracable.
