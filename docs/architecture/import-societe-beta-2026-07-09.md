# Import societe beta - 2026-07-09

## Objectif

Importer dans PostgreSQL beta uniquement la societe WinDev demandee.

- table source : `Societe`
- base source : `Opentrans_aff`
- filtre corrige : `IDSociete = 1970324836974592001`

## Cible

Environnement : `mytracking-beta`

Base PostgreSQL cible :

- conteneur Docker : `mytracking-beta-postgres-1`
- base : `mytracking_control_beta`
- table : `companies`

La table `companies` a ete creee si absente avec les champs minimaux utiles pour conserver la societe et sa correspondance WinDev.

## Donnee importee

| legacy_id | code | name | postal_code | city |
| --- | --- | --- | --- | --- |
| 1970324836974592001 | 998 | SGA | 01330 | VILLARS-LES-DOMBES |

## Regles appliquees

- Import limite a `IDSociete = 1970324836974592001`.
- Conservation de l'identifiant historique dans `companies.legacy_id`.
- Upsert idempotent sur `legacy_id` pour permettre une relance sans doublon.
- Aucun secret n'a ete copie dans le depot.
- L'identifiant WinDev est conserve en base pour la migration, mais il n'est pas affiche dans le formulaire admin.

## Verification

Requete de controle executee apres import :

```sql
select count(*) from companies;
select legacy_id, code, name, postal_code, city, source_system
from companies
where legacy_id = 1970324836974592001;
```

Resultat observe :

- nombre de lignes dans `companies` : `1`
- ligne `legacy_id = 1970324836974592001` presente avec `code = 998`

## Correction du 2026-07-09

Un premier import avait ete fait par erreur avec `IDSociete = 1`. Il a ete remplace par la societe correcte `IDSociete = 1970324836974592001`.

## Note infrastructure

La documentation locale mentionne `/opt/mytracking-beta`, mais les labels Docker du serveur indiquent le dossier compose actif suivant :

```text
/home/ubuntu/saas/mytracking-beta
```

Ce point devra etre aligne dans la documentation d'environnement.
