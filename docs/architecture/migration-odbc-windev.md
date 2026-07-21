# Migration ODBC WinDev

## Objectif

Permettre de recuperer les donnees d'un client MyTracking existant depuis sa base WinDev via ODBC, sans perte, puis de les importer dans sa base SaaS dediee.

Cas cible :

1. Un client existe deja sur le systeme WinDev.
2. On cree son tenant SaaS.
3. On connecte temporairement une source ODBC WinDev.
4. On importe les donnees dans la base PostgreSQL dediee de ce client.
5. On verifie l'integrite avant ouverture du SaaS.

## Principes

- Ne jamais stocker de secrets ODBC dans les fichiers versionnes.
- Ne jamais migrer directement sans simulation.
- Conserver les IDs WinDev dans des champs `legacy*`.
- Importer par domaines et par lots.
- Produire un rapport de controle apres chaque import.
- Pouvoir relancer un import sans creer de doublons.
- Garder une trace de chaque execution d'import.

## Architecture proposee

### SourceConnector

Connecteur temporaire vers la base WinDev existante.

Il peut utiliser :

- DSN ODBC local ;
- chaine de connexion fournie par variable d'environnement ;
- compte technique en lecture seule si possible.

Les secrets restent hors depot :

- variables d'environnement ;
- coffre de secrets ;
- configuration serveur non versionnee.

### ImportJob

Execution d'une migration pour un tenant.

Etats possibles :

- `DRAFT`
- `DRY_RUN`
- `READY`
- `RUNNING`
- `FAILED`
- `COMPLETED`
- `CANCELLED`

### ImportBatch

Lot d'import par table ou domaine.

Exemples :

- societes/agences ;
- utilisateurs/employes/chauffeurs ;
- clients ;
- expeditions ;
- colis/PCI ;
- historique ;
- factures.

### LegacyMapping

Table de correspondance entre les IDs WinDev et les IDs SaaS.

Exemple :

| Type | Legacy | SaaS |
| --- | --- | --- |
| `Societe` | `IDSociete` | `Company.id` |
| `Agence` | `Idagence` | `Agency.id` |
| `Expedition` | `IDExpedition` | `Shipment.id` |

## Workflow d'import

### 1. Preparation

- Verifier que le tenant SaaS existe.
- Verifier que sa base dediee est creee.
- Configurer la source ODBC hors depot.
- Tester la connexion en lecture seule.
- Lire les compteurs source par table.

### 2. Dry-run

Le dry-run ne modifie pas la base cible.

Il doit produire :

- nombre de lignes par table source ;
- tables detectees ;
- champs obligatoires absents ;
- conflits de correspondance ;
- estimation des volumes ;
- anomalies bloquantes.

### 3. Import initial

Ordre recommande :

1. Societe.
2. Agences.
3. Employes/utilisateurs/chauffeurs.
4. Profils et rattachements.
5. Clients et referentiels.
6. Expeditions.
7. Colis/PCI.
8. Historique/evenements.
9. Factures et details.
10. Documents ou references de documents.

### 4. Controle de non-perte

Controles minimaux :

- comptage source/cible ;
- verification des IDs legacy ;
- verification des rattachements agence ;
- verification des relations principales ;
- rapport des lignes ignorees ou en erreur ;
- echantillonnage metier sur expeditions, factures, clients.

### 5. Rattrapage delta

Si le client continue a utiliser WinDev pendant la preparation, prevoir un delta :

- importer les enregistrements crees/modifies depuis le dernier import ;
- figer temporairement WinDev au moment de la bascule si necessaire ;
- relancer les controles.

### 6. Bascule

Avant ouverture SaaS :

- valider les rapports ;
- valider un panel d'utilisateurs ;
- sauvegarder la base SaaS initiale ;
- garder un plan de retour arriere.

## Idempotence

Un import doit pouvoir etre relance.

Regles :

- utiliser les champs `legacyId` et `legacyUniqueKey` pour retrouver les donnees deja importees ;
- ne pas creer de doublon si une ligne source existe deja en cible ;
- mettre a jour les donnees cibles seulement si la regle d'import l'autorise ;
- historiser les erreurs sans bloquer tout le lot si l'erreur est non critique.

## Tables prioritaires pour le premier import

| Domaine | Tables source |
| --- | --- |
| Organisation | `Societe`, `Agence`, `Utilisateur`, `Chauffeur` |
| Exploitation | `Expedition`, `Pci`, `Historique`, `Enlevement` |
| Clients | `Clients`, `Destinataire`, `Affretes`, `Affretes_Contact` |
| Facturation | `Facture_Entete`, `Facture_Detail`, `Facture_regroup` |
| Tournees | `Tournee`, `PreTournee_Entete`, `PreTournee_Detail`, `Tournee_Numerique` |

## Questions ouvertes

- Le client WinDev peut-il etre mis en lecture seule pendant la bascule ?
- Existe-t-il des timestamps fiables de modification sur les tables principales ?
- Faut-il migrer toutes les archives ou seulement une periode ?
- Les documents physiques/PDF sont-ils en base, sur disque, ou les deux ?
- Le connecteur ODBC WinDev permet-il une lecture stable des gros volumes sans timeout ?
