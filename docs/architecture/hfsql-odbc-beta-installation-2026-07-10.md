# Installation HFSQL ODBC beta

## Contexte

Le bouton de synchronisation WinDev vers beta doit lire la base HFSQL `Opentrans_aff` depuis le serveur beta MyTracking.

Le driver Linux officiel PC SOFT a ete recupere depuis :

```text
https://download.windev.com/fr/download/neo/HFSQL/2026.awp
```

Fichier telecharge :

```text
wxpack_iodbclinux315010.zip
```

## Installation serveur beta

Paquets Ubuntu ajoutes :

- `unzip`
- `unixodbc`
- `unixodbc-dev`
- `odbcinst`
- `libiodbc2`
- `libiodbc2-dev`
- `build-essential`

Le driver PC SOFT est installe dans :

```text
/opt/mytracking/hfsql-odbc/wx315010
```

Le script officiel `install_iodbc.sh` a enregistre le driver dans `/etc/odbcinst.ini` :

```text
[HFSQL]
Description = HFSQL iODBC Driver
Driver = /opt/mytracking/hfsql-odbc/wx315010/wd310hfo64.so
```

Un DSN systeme de test a ete cree dans `/etc/odbc.ini` :

```text
[MyTrackingWinDevSGA]
Driver=HFSQL
Description=HFSQL WinDev SGA beta sync
Server Name=217.182.143.218
Server Port=4900
Database=Opentrans_aff
UID=Admin
PWD=
```

Aucun mot de passe n'est stocke dans le depot.

## Verification

Le driver depend de iODBC. Le test via `unixODBC/isql` detecte le DSN mais echoue au chargement du driver, ce qui confirme qu'il ne faut pas melanger les gestionnaires ODBC pour l'execution reelle.

Un mini test compile contre `libiodbc` sur l'hote beta execute :

```sql
SELECT COUNT(*) FROM Clients;
```

Resultat verifie le 10/07/2026 :

```text
Clients=814
```

## Decision technique

La synchro applicative ne doit pas utiliser le module Node `odbc` classique tant que le pilote PC SOFT reste lie a iODBC.

Le service `admin-auth` beta a ete adapte pour utiliser une image Debian `node:22-bookworm-slim`, monter le driver PC SOFT en lecture seule et compiler un petit precontrole iODBC au demarrage.

Le precontrole est appele via :

```text
HFSQL_PREFLIGHT_COMMAND=/tmp/mytracking-iodbc-count
```

L'extraction reelle HFSQL est appelee via :

```text
HFSQL_QUERY_COMMAND=/tmp/mytracking-hfsql-query
```

## Synchronisation branchee

Le script `admin-auth/sync-windev-sga.js` realise maintenant :

- controle de connexion HFSQL ;
- lecture des tables `Produit`, `Affretes`, `Affretes_Contact`, `Clients`, `Expedition` ;
- purge transactionnelle des donnees beta SGA du perimetre ;
- import PostgreSQL par lots ;
- reconstruction des adresses expediteurs client depuis les expeditions ;
- import du personnel utile depuis les createurs d'expedition, normalise sur Ali, Elodie, Loan et Loris ;
- rapport de comptage dans `windev_sync_runs`.

Derniere verification beta du 10/07/2026 :

```text
Import produits: 2
Import affretes: 3722
Import contacts affretes: 4841
Import clients: 814
Import expeditions: 18562
Liens expedition-affrete: 18562
Import personnel: 4
Expediteurs client reconstruits: 2428
```

Points connus :

- certains champs visibles dans un `SELECT *` HFSQL ne sont pas requetables explicitement par le driver (`Code_tourn`, `Sold`) ; ils sont ignores dans cette V1 de synchro ;
- le statut ferme est deduit de la validation facture importee.
