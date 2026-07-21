# Cartographie fonctionnelle

| Domaine | Module | Fonctionnalites | Utilisateurs | Donnees | Criticite |
| --- | --- | --- | --- | --- | --- |
| Exploitation transport | Expeditions / positions | Saisie, modification, recherche, archivage, taxation, suivi, editions | Exploitants, agence, administratif | Expedition, PCI, historique, evenements | Elevee |
| Exploitation transport | Enlevements / ramasses | Saisie et suivi des enlevements, bons, tournées de ramasse | Exploitants, chauffeurs | Enlevement, tournee ramasse, client | Elevee |
| Exploitation transport | Livraisons / tournees | Affectation, creation de tournees, retour de tournees, tournee numerique | Exploitants, chauffeurs | Tournee, chauffeur, expedition, emarge | Elevee |
| Affretement | Affretes et dossiers | Liste, fiche, notes, bordereaux, saisie affretement | Exploitants affretement | Affrete, contact, expedition, dossier | Elevee |
| Commercial / client | Clients et tarifs | Fiches clients, tarifs, types d'emballage, prestations | Commercial, administratif | Client, tarif, TVA, prestations | Elevee |
| Facturation | Factures, avoirs, regroupements | Validation, edition, reedition, exports, pointage reglement | Facturation, comptabilite | Facture entete/detail, avoir, reglement | Elevee |
| Editions | Recepisses, etiquettes, bordereaux | Etats WinDev, etiquettes GLS/messagerie, documents client | Exploitants, chauffeurs, clients | Etats, etiquettes, documents | Elevee |
| Integrations | GLS / PTV / ERP / EDI / webservices | Consignation, geoloc/optimisation, exports, imports, webservices | Systeme, exploitation | Messages, XML, references externes | Elevee |
| Reporting | Statistiques et suivi | CA, ventes, clients perdus, tournees, livraisons, produits | Direction, commercial, exploitation | Agregats expedition/facturation | Moyenne |
| Administration | Utilisateurs et parametrage | Droits, agences, pays, TVA, produits, localites, services | Administrateurs | Parametres, referentiels | Elevee |

## Axes metier

### Metier 1 - Transporteur / livreur

Objectif : recevoir des expeditions, les exploiter et les livrer, ou les confier a un confrere.

Objets centraux :

- expedition / position ;
- colis / PCI ;
- quai ;
- tournee ;
- chauffeur ;
- confrere / sous-traitant ;
- evenement de suivi ;
- preuve de livraison ;
- incident.

Parcours typique :

1. Reception ou creation de l'expedition.
2. Controle des informations de livraison.
3. Affectation a une tournee interne ou remise a un confrere.
4. Scan / chargement / depart.
5. Livraison ou incident.
6. Retour de preuve, emargement, statut final.
7. Facturation ou transmission administrative.

### Metier 2 - Affreteur

Objectif : organiser et suivre des transports confies a des affretes/partenaires.

Objets centraux :

- dossier d'affretement ;
- affrete ;
- contact affrete ;
- prix d'achat ;
- prix de vente ;
- confirmation ;
- bordereau ;
- statut dossier ;
- marge.

Parcours typique :

1. Creation ou reception d'un besoin transport.
2. Recherche ou selection d'un affrete.
3. Negociation/validation prix et conditions.
4. Confirmation et edition des documents.
5. Suivi de l'execution.
6. Controle administratif et facturation.

### Objets communs

Les deux metiers partagent une partie du vocabulaire, mais pas le meme rythme d'utilisation :

- client ;
- expedition ;
- statut ;
- document ;
- facture ;
- historique ;
- integration EDI/API.

La refonte doit donc distinguer les parcours tout en conservant une base de donnees coherente.

## Flux principaux

### Flux expedition standard - livraison interne

- Declencheur : creation ou import d'une expedition.
- Etapes : saisie expedition, taxation, edition recepisse/etiquette, affectation tournee, suivi evenements, livraison/emarge, facturation.
- Resultat attendu : expedition traitee, suivie, facturee et historisee.
- Exceptions : annulation, modification, non livraison, souffrance, duplicata, regroupement, expedition multi-colis.

### Flux expedition confiee a un confrere

- Declencheur : expedition que l'entreprise ne livre pas directement.
- Etapes : selection confrere, remise ou transmission, suivi statut externe, reception preuve/statut final, controle facturation.
- Resultat attendu : expedition livree par un partenaire avec trace de responsabilite et documents associes.
- Exceptions : refus confrere, prix divergent, preuve manquante, incident livraison, retard.

### Flux affretement

- Declencheur : besoin de transport gere en affretement.
- Etapes : creation dossier, choix affrete, validation prix, confirmation, edition bordereau, suivi execution, controle marge/facturation.
- Resultat attendu : dossier affretement execute, suivi et rentable.
- Sources observees : `Affretement_table.wdw`, `FEN_Saisie_Affretement.wdw`, `_Affretes.wdc`, `_Affretes_Contact.wdc`.

### Flux consignation GLS

- Declencheur : expedition dont le produit demande une consignation par webservice GLS.
- Etapes : construction des colis, appel webservice GLS, edition etiquettes, creation PCI et eventuelles positions de service.
- Resultat attendu : etiquettes GLS creees et references associees aux colis.
- Source observee : `COL_Webservice.wdg`, procedures `p_Traitement_webservice` et `p_traitement_webservice_gls`.

### Flux facturation

- Declencheur : selection de positions ou prestations a facturer.
- Etapes : controle facturation en cours, generation facture, validation, edition, reedition/export.
- Resultat attendu : facture validee et exploitable en comptabilite.
- Sources observees : `REQ_ValidationFacture*`, `_Facture_Entete.wdc`, `_Facture_Detail.wdc`, `edition_facture.wdw`.

## Regles metier

| ID | Regle | Source | Criticite | Statut |
| --- | --- | --- | --- | --- |
| RM-001 | Une expedition peut avoir plusieurs colis/PCI ; le traitement GLS peut creer une position de service par colis supplementaire | `COL_Webservice.wdg` | Elevee | A verifier |
| RM-002 | La facturation semble controlee par des codes de validation et des statuts de facture en cours | `_Expedition.wdc`, `REQ_*Facture*` | Elevee | A analyser |
| RM-003 | Le numero de position/reference EDI est construit a partir de l'annee, du mois et d'un numero d'ordre | `COL_Webservice.wdg` | Elevee | A verifier |
| RM-004 | Les montants d'une expedition couvrent transport, TVA, CR, valeur declaree, sous-traitance, traction, enlevement et prestations | `_Expedition.wdc` | Elevee | A analyser |
| RM-005 | Une expedition peut etre traitee en livraison interne ou confiee a un confrere ; le parcours et les responsabilites doivent etre explicites | Besoin utilisateur | Elevee | A documenter |
| RM-006 | L'affretement doit etre gere comme un metier distinct, avec ses propres dossiers, affretes, prix, confirmations et documents | Besoin utilisateur | Elevee | A documenter |
