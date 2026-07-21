# Statistiques personnel SGA beta - 2026-07-09

## Decision

La page `client-analytics.html` rapproche les expeditions au personnel via le champ importe `transport_shipments.legacy_created_by`.

## Regle de rapprochement

- `ALI` -> Ali
- `LOAN` -> Loan
- `LORIS` -> Loris
- `ELO` ou `ELODIE` -> Elodie
- createur vide -> Non renseigne

Cette regle evite de modifier les expeditions importees et conserve la trace WinDev d'origine.

## KPI exposes

- marge de la periode ;
- marge par membre du personnel ;
- chiffre, achat affrete, taux de marge ;
- nombre d'expeditions ;
- comparaison avec la periode precedente de meme duree ;
- evolution quotidienne chiffre et marge ;
- repartition par personnel et par produit ;
- top clients par volume d'expeditions ;
- top clients par chiffre.

## Periodes

La page propose : jour courant, mois courant, mois precedent, 7 derniers jours, 30 derniers jours, annee courante et intervalle libre.

## Definition des montants

- chiffre : `transport_amount` ;
- achat affrete : `agreed_price` ;
- marge : `transport_amount - agreed_price`.
