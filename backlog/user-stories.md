# User Stories

## Format

```text
US-XXX - Titre
En tant que [role],
je veux [objectif],
afin de [benefice].

Critères d'acceptation :
- [ ] ...

Notes :
- ...
```

## Socle Organisation

### US-000A - Creer une societe cliente depuis le backoffice plateforme

En tant qu'administrateur plateforme,
je veux creer une fiche societe cliente depuis le backoffice,
afin de preparer sa base dediee et son activation SaaS.

Critères d'acceptation :

- [ ] Le formulaire demande au minimum un nom, un code societe et un type de creation.
- [ ] Le code societe est unique dans le control plane.
- [ ] Le type de creation peut etre `NEW_COMPANY` ou `WINDEV_IMPORT`.
- [ ] La societe creee apparait dans la liste des tenants.
- [ ] Le tenant affiche un statut : draft, provisioning, active, suspended, migration, error ou archived.
- [ ] Aucun secret, mot de passe ou chaine de connexion complete n'est saisi dans le formulaire.
- [ ] Le detail societe affiche les informations non sensibles de la base dediee.

Notes :

- Voir `docs/architecture/backoffice-administrateur.md`.

### US-000 - Provisionner une societe cliente

En tant qu'administrateur plateforme,
je veux creer une nouvelle societe cliente avec une base dediee,
afin d'isoler ses donnees et de pouvoir la deplacer facilement si son volume augmente.

Critères d'acceptation :

- [ ] La creation d'une societe cree un tenant plateforme.
- [ ] Une base PostgreSQL dediee est provisionnee pour cette societe.
- [ ] Les migrations du schema tenant sont appliquees.
- [ ] La societe initiale est creee dans la base dediee.
- [ ] Le backoffice connait l'emplacement de la base sans exposer les secrets.
- [ ] Le statut du tenant est visible : provisioning, actif, suspendu, erreur.

Notes :

- Le control plane ne doit pas stocker les expeditions ni les donnees metier.
- Les secrets de connexion ne doivent pas etre versionnes.

### US-000B - Importer un client existant depuis WinDev

En tant qu'administrateur plateforme,
je veux importer les donnees d'un client WinDev existant via ODBC,
afin de creer sa base SaaS sans perte de donnees.

Critères d'acceptation :

- [ ] L'import utilise une source ODBC configuree hors depot.
- [ ] Un mode dry-run est disponible avant tout import reel.
- [ ] Les IDs WinDev sont conserves dans les champs `legacy*`.
- [ ] L'import est relancable sans creer de doublons.
- [ ] Un rapport compare les volumes source et cible.
- [ ] Les erreurs sont journalisees avec table, identifiant source et cause.
- [ ] Aucun secret ODBC n'est affiche ni versionne.

Notes :

- Voir `docs/architecture/migration-odbc-windev.md`.

### US-001 - Creer une societe

En tant qu'administrateur societe ou processus de provisioning,
je veux creer une societe,
afin d'initialiser un espace client MyTracking.

Critères d'acceptation :

- [ ] Une societe possede un nom et un code unique.
- [ ] Une societe importee peut conserver son `IDSociete` WinDev.
- [ ] Les informations de contact peuvent etre renseignees.
- [ ] La societe peut contenir plusieurs agences.
- [ ] La societe est creee dans sa base tenant dediee.

Notes :

- Correspondance WinDev probable : table `Societe`.

### US-002 - Creer une agence

En tant qu'administrateur societe,
je veux creer une agence rattachee a ma societe,
afin de separer l'exploitation par site.

Critères d'acceptation :

- [ ] Une agence appartient a une seule societe.
- [ ] Le code agence est unique dans la societe.
- [ ] Une agence importee peut conserver son `Idagence` WinDev.
- [ ] L'agence peut conserver une cle historique WinDev pour la migration.
- [ ] Une agence peut etre active ou inactive.

Notes :

- Correspondance WinDev probable : `Agence.cle_unique_agence`.

### US-003 - Gerer les employes

En tant qu'administrateur societe,
je veux creer et modifier les employes,
afin de gerer les utilisateurs internes de MyTracking.

Critères d'acceptation :

- [ ] Un employe appartient a une societe.
- [ ] Un employe importe peut conserver son `IDUtilisateur` ou son `IDChauffeur` WinDev.
- [ ] Un employe peut avoir un compte utilisateur.
- [ ] Aucun mot de passe en clair n'est stocke.
- [ ] Un employe peut etre actif ou inactif.
- [ ] Un compte client peut se connecter avec son email sans saisir de code societe.
- [ ] Le tenant et la societe sont deduits du compte utilisateur.

Notes :

- Correspondance WinDev probable : table `Utilisateur`.
- Les mots de passe WinDev ne doivent pas etre repris.

### US-003B - Connexion client par email

En tant qu'utilisateur client,
je veux me connecter avec mon email et mon mot de passe,
afin d'acceder directement a ma societe sans saisir de code societe.

Critères d'acceptation :

- [ ] Le formulaire client ne demande pas de code societe.
- [ ] L'email permet de retrouver le compte utilisateur.
- [ ] Le compte utilisateur permet de retrouver le tenant et la societe.
- [ ] Apres connexion, les agences visibles dependent des rattachements de l'employe.
- [ ] Si un email appartient a plusieurs societes, le comportement attendu est explicitement defini avant developpement.

Notes :

- Le code societe reste une information d'administration, pas un champ de connexion client obligatoire.

### US-004 - Rattacher un employe a une agence

En tant qu'administrateur societe,
je veux rattacher un employe a une ou plusieurs agences,
afin de controler son perimetre d'exploitation.

Critères d'acceptation :

- [ ] Un employe peut etre rattache a une agence.
- [ ] Un employe peut avoir plusieurs rattachements si autorise.
- [ ] Un rattachement peut etre defini comme agence par defaut.

### US-005 - Attribuer plusieurs profils a un employe

En tant qu'administrateur societe,
je veux attribuer un ou plusieurs profils a un employe,
afin de lui donner les bons acces metier.

Critères d'acceptation :

- [ ] Un employe peut avoir plusieurs profils.
- [ ] Un profil peut etre global societe ou limite a une agence.
- [ ] Les profils initiaux couvrent administration, exploitation, affretement, comptabilite, chauffeur et lecture seule.
- [ ] Les droits effectifs tiennent compte a la fois des agences rattachees et des profils attribues.

Notes :

- Exemples de profils : `COMPANY_ADMIN`, `AGENCY_MANAGER`, `OPERATIONS`, `AFFREIGHTER`, `ACCOUNTING`, `DRIVER`, `READ_ONLY`.

### US-006 - Filtrer les expeditions par agence

En tant qu'utilisateur d'agence,
je veux voir uniquement les expeditions de mon agence,
afin de travailler sur mon perimetre operationnel.

Critères d'acceptation :

- [ ] Une expedition est rattachee a une agence.
- [ ] Un utilisateur d'agence ne voit que les expeditions des agences auxquelles il est rattache.
- [ ] Un administrateur societe peut voir les expeditions de toutes les agences de sa societe.
- [ ] Les anciennes expeditions pourront etre migrees via `Expedition.cle_unique_agence`.
- [ ] Une expedition importee conserve son `IDExpedition` WinDev dans un champ de migration.
