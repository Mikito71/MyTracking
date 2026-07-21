# Import clients SGA beta - 2026-07-09

## Objectif

Importer les clients transport de SGA depuis la table WinDev `Clients` et fournir une interface client simple pour consulter, modifier et historiser les fiches.

## Perimetre importe

- Societe SaaS : `SGA`
- Societe WinDev : `IDSociete = 1970324836974592001`
- Agence WinDev : `cle_unique_agence = 2010050310265043403`
- Table source : `Clients`
- Lignes importees : `814`

## Mapping retenu

La table WinDev `Clients` contient 150 champs. La V1 beta ne reprend que les champs utiles a une fiche client lisible :

- identite : code, nom, statut ;
- adresse principale : adresse, pays, code postal, ville ;
- contact : telephone, fax, email, contact, mobile contact, email contact ;
- administratif : SIRET, TVA ;
- facturation lisible : nom facture, adresse facture, email facture, code reglement, indicateur non facturable ;
- migration : identifiant WinDev et cle agence conserves en base ;
- notes SaaS.

## Champs ecartes de l'interface

Les champs suivants ne sont pas repris dans l'ecran client beta :

- mots de passe ou anciens acces portail ;
- identifiants FTP, chemins d'emission/export, executables locaux ;
- coordonnees bancaires ;
- options WinDev tres specifiques d'edition, EDI, etiquettes, factures et produits en ligne ;
- champs dont le sens metier devra etre confirme avant reprise fonctionnelle.

Ils ne sont pas supprimes de la base source WinDev. Ils sont simplement exclus du modele SaaS beta pour eviter une interface confuse.

## Tables cible

```text
transport_customers
transport_customer_change_events
```

Chaque modification de fiche client passe par l'API et cree un evenement d'historique avec :

- date et heure ;
- utilisateur declare ;
- action ;
- champs modifies avec ancienne et nouvelle valeur.

## Interface

Page ajoutee :

```text
/client-customers.html
```

La navigation client contient aussi une entree `Personnel` vers :

```text
/client-staff.html
```

Fonctions disponibles :

- recherche par nom, code, ville, SIRET ou email ;
- filtre actif/bloque ;
- consultation d'une fiche ;
- modification des informations utiles ;
- onglet historique.

## API beta

Routes ajoutees :

```text
GET /client-api/customers
GET /client-api/customers/:id
PUT /client-api/customers/:id
GET /client-api/customers/:id/history
```

Note : cette API beta est exposee pour le prototype client. Elle devra etre rattachee a l'authentification client avant usage hors beta.

## Verification

Controles effectues :

- `transport_customers` : `814` lignes ;
- `transport_customer_change_events` : historique cree a l'import ;
- page `/client-customers.html` : HTTP `200` ;
- API `/client-api/customers/1/history` : HTTP `200` ;
- sauvegarde de test via API : evenement `update` cree avec utilisateur et diff de champs.
