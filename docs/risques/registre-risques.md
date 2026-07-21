# Registre des risques

| ID | Risque | Probabilite | Impact | Niveau | Mitigation | Responsable | Statut |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-001 | Perte de comportements metier non documentes | Moyenne | Eleve | Eleve | Cartographier l'existant et valider avec les utilisateurs | A definir | Ouvert |
| R-002 | Migration de donnees incomplete | Moyenne | Eleve | Eleve | Inventaire des donnees, tests d'import, recette | A definir | Ouvert |
| R-003 | Perimetre trop large pour un premier lot | Elevee | Moyen | Eleve | Prioriser un MVP et differer le secondaire | A definir | Ouvert |
| R-004 | Logique metier dispersee entre fenetres, classes, requetes et procedures globales | Elevee | Eleve | Eleve | Extraire par domaine et produire une matrice fonction/source | A definir | Ouvert |
| R-005 | Rupture d'integration GLS/PTV/ERP/EDI | Moyenne | Eleve | Eleve | Identifier les contrats d'echange et creer des tests de compatibilite | A definir | Ouvert |
| R-006 | Oubli d'editions obligatoires | Elevee | Moyen | Eleve | Inventorier les `.wde`, classer les documents par criticite | A definir | Ouvert |
| R-007 | Confusion entre version courante et sauvegardes `Svg_*` / caches | Moyenne | Moyen | Moyen | Definir la racine comme source initiale et traiter les sauvegardes separement | A definir | Ouvert |
| R-008 | Melanger exploitation/livraison et affretement dans une interface unique confuse | Elevee | Eleve | Eleve | Concevoir deux espaces metier avec socle commun | A definir | Ouvert |
| R-009 | Mal gerer le cas intermediaire d'une expedition confiee a un confrere | Moyenne | Eleve | Eleve | Documenter les responsabilites, statuts et impacts facturation | A definir | Ouvert |
| R-010 | Import ODBC incomplet ou non idempotent | Moyenne | Eleve | Eleve | Dry-run, legacy IDs, imports par lots, rapports de comptage et relance sans doublons | A definir | Ouvert |
| R-011 | Modification des donnees WinDev pendant la migration | Moyenne | Eleve | Eleve | Prevoir delta import, fenetre de bascule, ou lecture seule temporaire | A definir | Ouvert |
| R-012 | Secrets ODBC ou mots de passe exposes dans le projet | Faible | Eleve | Moyen | Variables d'environnement/coffre de secrets, jamais de secrets versionnes | A definir | Ouvert |

## Regles

- Ajouter un risque des qu'il est identifie.
- Associer chaque risque important a une mitigation.
- Revoir ce registre a chaque jalon.
