# Tickets techniques

## Format

```text
TT-XXX - Titre
Objectif :

Contexte :

Taches :
- [ ] ...

Definition of Done :
- [ ] ...
```

## Tickets initiaux

### TT-001 - Initialiser le socle projet de refonte

Objectif : preparer l'environnement de developpement de la nouvelle version.

Taches :

- [ ] Choisir la stack cible.
- [ ] Creer le repository ou l'arborescence applicative.
- [ ] Definir les conventions de code.
- [ ] Mettre en place les tests de base.
- [ ] Documenter le lancement local.

### TT-002 - Modeliser le control plane plateforme

Objectif : definir le modele minimal permettant de creer une societe cliente SaaS et de suivre sa base dediee.

Contexte :

Le backoffice administrateur doit creer des tenants sans stocker les donnees metier dans la base plateforme.

Taches :

- [ ] Creer le modele `Tenant`.
- [ ] Creer le modele `TenantDatabase`.
- [ ] Creer le modele `TenantProvisioningJob`.
- [ ] Creer le modele `TenantProvisioningEvent`.
- [ ] Prevoir les statuts de tenant et de provisioning.
- [ ] Garantir l'unicite du code societe.
- [ ] Exclure les secrets et chaines de connexion completes du modele versionne.

Definition of Done :

- [ ] Le schema control plane permet de creer une fiche societe cliente.
- [ ] Le statut de provisioning est tracable.
- [ ] Les informations sensibles restent hors schema applicatif documente.

### TT-003 - Creer les premiers endpoints backoffice plateforme

Objectif : exposer l'API minimale pour la V1 du backoffice administrateur.

Contexte :

La V1 doit permettre de lister, creer, consulter, suspendre et reactiver une societe cliente.

Taches :

- [ ] `GET /platform/tenants`
- [ ] `POST /platform/tenants`
- [ ] `GET /platform/tenants/:tenantId`
- [ ] `POST /platform/tenants/:tenantId/provision`
- [ ] `POST /platform/tenants/:tenantId/suspend`
- [ ] `POST /platform/tenants/:tenantId/reactivate`
- [ ] `GET /platform/tenants/:tenantId/provisioning-jobs`

Definition of Done :

- [ ] Les endpoints valident les donnees d'entree.
- [ ] Les erreurs fonctionnelles sont explicites.
- [ ] Aucun secret n'est retourne par l'API.

### TT-004 - Creer l'ecran web de liste et creation des societes

Objectif : construire la premiere interface Next.js du backoffice administrateur.

Contexte :

L'administrateur plateforme doit pouvoir creer une societe cliente et voir son statut.

Taches :

- [ ] Creer une page liste des societes.
- [ ] Ajouter recherche par nom ou code.
- [ ] Ajouter filtre par statut.
- [ ] Creer le formulaire de creation.
- [ ] Ajouter le choix `NEW_COMPANY` ou `WINDEV_IMPORT`.
- [ ] Creer une page detail avec onglets informations, base dediee, provisioning et migration WinDev.

Definition of Done :

- [ ] Une societe peut etre creee depuis l'interface.
- [ ] La liste affiche le nouveau tenant.
- [ ] Le detail n'affiche aucun secret.
