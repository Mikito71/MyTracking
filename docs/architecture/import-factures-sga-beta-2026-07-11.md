# Import factures SGA beta - 2026-07-11

## Objectif

Importer les factures SGA depuis les tables WinDev `Facture_Entete` et `Facture_Detail`, puis fournir une interface client de consultation des factures et de leurs lignes.

## Perimetre importe

- Societe SaaS : `SGA`
- Societe WinDev : `IDSociete = 1970324836974592001`
- Tables sources : `Facture_Entete`, `Facture_Detail`
- Factures importees : `3526`
- Lignes importees : `63490`

## Mapping retenu

La V1 beta reprend les champs utiles pour consulter les factures :

- entete : identifiant WinDev, numero facture, date facture, date echeance, code validation ;
- client : code compte, client rattache, nom client, libelle de reglement ;
- produit : code et libelle produit lorsque disponibles ;
- produit deduit : si `Code_produit` est vide, le code peut etre deduit de `Libelle_Produit` pour les libelles fiables (`AFFRETEMENT` -> `AF`, `Litige` -> `LT`) ;
- montants : total HT, TVA calculee depuis `Total_Ttc - Total_HT`, total TTC, remise ;
- volumetrie : positions, colis, poids ;
- nature : avoir depuis le booleen WinDev `Avoir`, acompte depuis `Acompte` ;
- envoi client : statut `sent_to_client`, initialise a `oui` pour les factures datees jusqu'au 30/06/2026 inclus ;
- lignes : numero ligne, prestation, rubrique, colis, poids, quantite taxee, prix unitaire, montant, TVA, TTC, remise.

## Lignes detail exclues

Les lignes `Facture_Detail` qui ne sont que des ruptures de periode ne sont pas importees :

- `Date Du JJ/MM/AAAA`
- `Total Date Du JJ/MM/AAAA`

Elles ne representent pas une prestation facturee exploitable dans le SaaS et polluent la lecture du detail facture.

## Tables cible

```text
billing_invoices
billing_invoice_lines
billing_fiscal_events
billing_fiscal_closures
```

Les numeros de facture WinDev ne sont pas rendus uniques dans la beta, car l'historique importe peut contenir des doublons ou des cas d'avoir. L'unicite technique repose sur l'identifiant WinDev par societe.

## Preparation anti-fraude TVA

La base actuelle WinDev ne contient pas tous les marqueurs necessaires pour porter seule les obligations francaises liees aux logiciels de caisse/facturation.

Pour preparer la suite, la beta ajoute deja :

- un statut fiscal (`fiscal_status`) ;
- une version fiscale (`fiscal_version`) ;
- un hash de la facture importee (`fiscal_hash`) ;
- un chainage avec le hash precedent (`previous_fiscal_hash`) ;
- une empreinte de la source WinDev (`source_payload_hash`) ;
- des dates de scellement, cloture et archivage ;
- une table d'evenements fiscaux ;
- une table de clotures fiscales.

Ces champs preparent les principes d'inalterabilite, de securisation, de conservation et d'archivage, mais ne constituent pas a eux seuls une certification.

## Points de conformite a traiter avant emission SaaS

Avant de produire des factures directement depuis MyTracking, il faudra ajouter :

- numerotation sequentielle sans trou par entite fiscale et exercice ;
- scellement au moment exact de validation de facture ;
- interdiction de modifier une facture validee, avec avoir obligatoire ;
- journal d'evenements append-only ;
- clotures periodiques ;
- export d'archive fiscal horodate ;
- conservation des justificatifs de certification logicielle ;
- separation claire entre brouillon, facture validee, avoir et annulation.

## Interface

Page ajoutee :

```text
/client-invoices.html
```

Fonctions disponibles :

- recherche par numero, client, compte ou produit ;
- filtre par date et statut d'envoi client ;
- KPI factures, HT, TVA, TTC et factures envoyees client ;
- consultation du detail d'une facture ;
- affichage des lignes ;
- affichage dans la liste du statut d'envoi client a la place de la colonne fiscale technique.

## Sources reglementaires consultees

- Impots.gouv.fr : obligation de detenir un logiciel ou systeme de caisse satisfaisant aux conditions d'inalterabilite, securisation, conservation et archivage.
- BOFiP BOI-CF-COM-20-60 : commentaires administratifs sur les logiciels de caisse et les justificatifs attendus.
- Economie.gouv.fr : rappel des obligations sur les logiciels de caisse et certification.
