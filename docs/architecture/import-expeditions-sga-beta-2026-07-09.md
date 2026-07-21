# Import expeditions SGA beta - 2026-07-09

## Objectif

Importer les expeditions SGA depuis la table WinDev `Expedition` et fournir une interface client pour consulter, modifier et historiser les positions.

## Perimetre importe

- Societe SaaS : `SGA`
- Societe WinDev : `IDSociete = 1970324836974592001`
- Agence WinDev : `cle_unique_agence = 2010050310265043403`
- Table source : `Expedition`
- Lignes importees : `18538`

## Regle client et payeur

Chaque expedition est rattachee a deux liens distincts :

- `customer_id` : client expediteur, depuis `Code_expediteur` ;
- `payer_customer_id` : compte payeur, depuis `Compte_payeur`.

Sur les donnees SGA importees, les deux comptes sont identiques pour les `18538` lignes. Le modele SaaS garde quand meme les deux liens separes pour accepter les cas metier ou le payeur est different du client.

## Mapping retenu

La table WinDev `Expedition` contient 240 champs. La V1 beta reprend les champs utiles a une exploitation lisible :

- identite : identifiant WinDev, recepisse, type, port ;
- rattachement : client expediteur, payeur, agence legacy ;
- expediteur : nom, adresse, telephone ;
- destinataire : nom, adresse, telephone, email ;
- transport : colis, poids, volume, marchandise, produit, adherent livreur ;
- dates : depart, arrivage, ramasse, livraison imperative, livraison estimee, facturation ;
- facturation : numero facture, validation, montants principaux ;
- exploitation : routage, tournee ramasse, tournee livraison, reference EDI, commande, code barre ;
- statuts : ouverte, facturee, soldee, souffrance, affretement ;
- notes.

## Champs ecartes de l'interface

Les champs suivants ne sont pas repris dans l'ecran beta :

- cles composees et index techniques WinDev ;
- indicateurs internes d'edition ou de transfert ;
- champs temporaires de groupage ou de convergence ;
- donnees tres specifiques a confirmer avant reprise fonctionnelle ;
- tables satellites colis, emargements, matieres, photos et tournees numeriques.

Ils ne sont pas supprimes de la base WinDev. Ils sont simplement exclus de la V1 SaaS pour garder une interface exploitable.

## Tables cible

```text
transport_shipments
transport_shipment_change_events
transport_products
transport_carriers
transport_carrier_contacts
transport_shipment_carrier_contacts
```

Chaque modification via l'API cree un evenement d'historique avec :

- date et heure ;
- utilisateur declare ;
- action ;
- champs modifies avec ancienne et nouvelle valeur.

## Interface

Page ajoutee :

```text
/client-shipments.html
```

Fonctions disponibles :

- recherche par recepisse, client, payeur, expediteur, destinataire, ville ou commande ;
- filtre par statut ;
- tableau de consultation sans modification ;
- colonnes depart, creation, createur, client, payeur, transporteur, produit, montant transport, depart et arrivee.
- produit affiche en code seul ;
- client et payeur regroupes dans une seule colonne ;
- transporteur affiche avec le prix convenu ;
- montant conserve dans sa colonne ;
- depart et arrivee affichent le drapeau du pays, pays, code postal et ville ;
- creation et createur places en fin de ligne.

Decision UI du 2026-07-09 :

- la fenetre Expeditions ne permet pas la modification ;
- le bouton `Enregistrer` et la fiche detail ont ete retires ;
- l'ecran affiche uniquement un tableau dense de consultation.

## API beta

Routes ajoutees :

```text
GET /client-api/shipments
GET /client-api/shipments/:id
PUT /client-api/shipments/:id
GET /client-api/shipments/:id/history
```

## Verification

Controles effectues :

- `transport_shipments` : `18538` lignes ;
- `transport_shipment_change_events` : `18538` evenements d'import ;
- `transport_products` : `2` lignes ;
- `transport_carriers` : `3722` lignes ;
- `transport_carrier_contacts` : `4838` lignes ;
- `transport_shipment_carrier_contacts` : `18538` liens ;
- expeditions sans client : `0` ;
- expeditions sans payeur : `0` ;
- expeditions avec payeur different : `0` dans les donnees SGA actuelles ;
- expeditions avec creation, createur, montant, produit et transporteur : `18538` ;
- prix convenu importe depuis `PrixConvenu` sur `18538` expeditions ;
- montant conserve depuis `Montant_transport` ;
- API `/client-api/shipments` : HTTP `200` ;
- page `/client-shipments.html` : HTTP `200` ;
- rendu navigateur verifie : CSS charge, liste affichee, KPI visibles.
