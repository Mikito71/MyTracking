# Fiche logiciel existant

## Identite

- Nom du logiciel : MY TRACKING / mulcol
- Utilisateurs principaux :
- Domaine metier : transport, logistique, suivi d'expeditions, livraison, remise a confrere, affretement, tournees, facturation
- Criticite : a confirmer, probablement elevee car l'application couvre la saisie, l'exploitation, l'edition, la facturation et le suivi

## Technologie actuelle

- Langage : WinDev / WLangage
- Framework : WinDev, projet `mulcol.WDP`
- Base de donnees : Analyse WinDev / HyperFileSQL probable, dossier `Analyse`, fichiers `.fic`, `.ndx`, `.mmo`, `.wdd`
- Hebergement : application Windows generee en executable `mulcol.exe`, a confirmer
- Integrations : GLS, PTV, ERP, webservices, EDI, etiquettes, exports/imports XML probables

## Objectifs de refonte

- Objectif 1 : cartographier l'existant avant de definir la cible
- Objectif 2 : isoler les domaines metier critiques
- Objectif 3 : preparer une migration progressive et verifiable

## Contraintes

- Budget :
- Delai :
- Equipe :
- Donnees a conserver : expeditions, clients, factures, tournees, chauffeurs, agences, tarifs, historiques, parametrages, a confirmer
- Compatibilite : conserver les comportements critiques, les editions, les integrations externes et les formats d'echange
- Reglementation :

## Fonctionnalites principales

## Deux metiers a gerer

MyTracking doit gerer deux metiers proches mais differents.

### 1. Transporteur / livreur

Le transporteur recoit des expeditions, les prend en charge, les organise, puis :

- les livre avec ses propres moyens ;
- ou les confie a un autre confrere / sous-traitant / partenaire.

Ce metier est centre sur l'exploitation quotidienne : arrivees, quais, tournees, chauffeurs, scans, preuves, statuts, incidents, retours de tournee, synchronisation mobile.

### 2. Affreteur

L'affreteur gere des dossiers de transport confies a des affretes ou partenaires. Il doit suivre les demandes, les prix, les confirmations, les documents, les statuts et la rentabilite.

Ce metier est centre sur la relation avec les affretes, le choix du transporteur, les tarifs, les confirmations, les bordereaux, les achats/ventes et le suivi administratif.

### Consequence pour la refonte

La future interface ne doit pas etre un cockpit unique generique. Elle doit proposer deux espaces metier, avec des objets communs mais des parcours differents :

- espace Exploitation / Livraison ;
- espace Affretement.

| Module | Description | Criticite | Notes |
| --- | --- | --- | --- |
| Expeditons / positions | Saisie, recherche, archive, suivi, taxation et edition des expeditions | Elevee | Domaine central observe via `_Expedition.wdc`, `Expedition_table.wdw`, nombreuses requetes `REQ_Expedition_*` |
| Clients / expediteurs / destinataires | Gestion clients, contacts, tarifs, adresses, types d'emballage | Elevee | Observe via `_Clients.wdc`, `Clients_fiche.wdw`, `Clients_table.wdw` |
| Affretement | Saisie, liste, notes, bordereaux, affretes | Elevee | Observe via `Affretement_table.wdw`, `FEN_Saisie_Affretement.wdw`, `_Affretes.wdc` |
| Tournees / chauffeurs | Creation, affectation, suivi, geolocalisation, tournee numerique | Elevee | Observe via `_Tournee.wdc`, `Chauffeur_*`, `FEN_Tournée_Numérique.wdw` |
| Facturation / avoirs / reglements | Edition, validation, regroupement, exports, suivi des encaissements | Elevee | Observe via `_Facture_*`, `edition_facture.wdw`, `validation_facture.wdw`, `REQ_ValidationFacture*` |
| Editions / etiquettes | Etats WinDev, etiquettes GLS/messagerie, recepisses, bordereaux | Elevee | 128 etats `.wde` a la racine, nombreux `ETAT_*` |
| Statistiques / reporting | Stats client, CA, tournees, livraisons, produits | Moyenne a elevee | Observe via `Stat_*`, `REQ_stat_*`, `proc_Stat.wdc` |
| Parametrage / referentiels | Agences, pays, TVA, produits, services, localites, utilisateurs | Elevee | Nombreuses fiches/table et classes `_Agence`, `_Tva`, `_Utilisateur`, etc. |
| Integrations | GLS, PTV, ERP, webservices, EDI, XML | Elevee | Observe via `COL_Webservice.wdg`, `COL_Ptv.wdg`, composants `Composant_*` |

## Douleurs connues

- A documenter avec les utilisateurs.
- Dette technique probable liee a une application WinDev volumineuse avec beaucoup de fenetres, requetes et etats.
- Risque de logique metier dispersee entre fenetres, classes, requetes et procedures globales.

## Questions ouvertes

- Quelle est la stack cible souhaitee ?
- Quelles fonctionnalites doivent absolument etre conservees ?
- Quels sont les principaux risques de migration ?
- Quels modules sont encore utilises en production ?
- Quelles editions sont obligatoires pour les clients ou partenaires ?
- Quelles integrations externes doivent rester strictement compatibles ?
- Quels utilisateurs travaillent surtout en mode transporteur/livreur ?
- Quels utilisateurs travaillent surtout en mode affreteur ?
- Une meme expedition peut-elle passer d'un parcours livraison interne a un parcours confrere/affretement ?
