# Test connexion ODBC HFSQL - Opentrans_aff

## Date

2026-07-09

## Objectif

Verifier qu'il est possible de se connecter a une base HFSQL Client/Serveur existante via le driver ODBC HFSQL installe localement.

## Parametres testes

```text
Serveur : 217.182.143.218
Port : 4900
Base : Opentrans_aff
Utilisateur : Admin
Mot de passe : vide
Driver ODBC : HFSQL 64-bit
```

Aucun mot de passe n'a ete stocke dans ce document.

## Resultat connexion

Connexion reussie avec la chaine DSN-less :

```text
Driver={HFSQL};Server Name=217.182.143.218;Server Port=4900;Database=Opentrans_aff;UID=Admin;PWD=;
```

Le driver retourne :

```text
Driver : wd310hfo64.dll
ServerVersion : 20.00.0000
```

## Tables observees

Extrait des premieres tables visibles :

```text
Affecremise
Affectation
Affretes
Affretes_Contact
Agence
Appareil_Mobile
arch_Expedition
arch_Historique
arch_Pci
Avoir
Banque
Chauffeur
Clients
Expedition
```

Tables liees aux utilisateurs/personnel observees :

```text
Chauffeur
ParamUser
POSITION_CHAUFFEUR
UserCaisse
```

La table `Utilisateur` n'est pas visible dans cette base.

## Comptages de lecture

```text
Societe = 2
Agence = 1
Chauffeur = 0
Clients = 814
Expedition = 18532
Affretes = 3721
```

La requete sur `Utilisateur` echoue car le fichier de donnees est inconnu dans cette base.

## Point technique

Les requetes ODBC retournent bien les donnees, mais le processus PowerShell s'est termine brutalement apres fermeture de la connexion ODBC.

Impact :

- la lecture via ODBC est possible ;
- il faudra privilegier un outil d'import robuste, avec traitement par lots ;
- il faudra tester la stabilite sur gros volumes ;
- il faudra eviter de dependre d'une longue connexion unique.

## Suite recommandee

1. Exporter la liste complete des tables et champs depuis cette base via ODBC.
2. Comparer avec le schema WinDev extrait depuis `mulcol.xdd`.
3. Identifier les tables reelles pour societe, agence, personnel, clients et expeditions.
4. Construire un premier import dry-run sur `Societe`, `Agence`, `Clients`, `Expedition`.
