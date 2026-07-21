# Plan de migration

## Strategie recommandee a ce stade

Migration progressive par domaines, avec extraction prealable des donnees et comportements critiques.

Le projet est trop vaste pour une reecriture "big bang" sans cartographie. La priorite est de stabiliser le modele metier autour de l'expedition, puis de reconstruire les domaines adjacents : clients/tarifs, tournees, affretement, facturation, editions, integrations.

Pour un client existant, la reprise des donnees doit passer par un import controle depuis la base WinDev via ODBC, avec dry-run, controle de comptage, conservation des IDs historiques et rapport de non-perte.

## Strategie a definir

Options possibles :

- remplacement complet ;
- migration module par module ;
- coexistence ancien/nouveau ;
- reecriture avec import initial des donnees ;
- refonte progressive autour du coeur existant.

## Etapes proposees

| Etape | Objectif | Pre-requis | Risques | Statut |
| --- | --- | --- | --- | --- |
| M-001 | Inventorier les donnees a migrer | Acces a l'existant | Donnees incompletes | A demarrer |
| M-002 | Identifier les comportements critiques | Analyse fonctionnelle | Oublis metier | A demarrer |
| M-003 | Definir la strategie de bascule | Architecture cible | Interruption de service | A demarrer |
| M-004 | Extraire le modele expedition | Lecture `_Expedition.wdc` et analyse `.wdd` | Modele trop couple | A demarrer |
| M-005 | Cartographier les editions obligatoires | Inventaire `.wde` | Documents clients oublies | A demarrer |
| M-006 | Cartographier les integrations | Lecture `COL_Webservice`, composants GLS/PTV/ERP, XML | Rupture partenaire | A demarrer |
| M-007 | Definir l'import ODBC WinDev | Client ODBC, acces lecture, mapping legacy | Perte ou doublons de donnees | En cours |
| M-008 | Creer les controles de non-perte | Comptages source/cible, relations, rapports | Bascule non fiable | A demarrer |

## Criteres de bascule

- Les scenarios critiques sont testes.
- Les donnees essentielles sont migrees et verifiees.
- Les utilisateurs pilotes valident les flux principaux.
- Un plan de retour arriere existe si necessaire.
- Les rapports d'import ODBC ne montrent aucune perte bloquante.
- Les IDs WinDev sont conserves dans les champs `legacy*`.
