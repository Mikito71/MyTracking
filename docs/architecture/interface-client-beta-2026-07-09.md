# Interface client beta - 2026-07-09

## Objectif

Corriger le rendu des pages client beta et isoler leur design dans une feuille de style dediee.

## Pages concernees

```text
/client-customers.html
/client-staff.html
```

Les deux pages chargent maintenant :

```text
client-ui.css?v=20260709-2
```

## Decision

Le style client ne depend plus uniquement de `auth.css`. Une feuille `client-ui.css` dediee porte :

- la barre haute ;
- la navigation laterale ;
- les listes ;
- les fiches modifiables ;
- les onglets ;
- les cartes de synthese ;
- les boutons d'action ;
- les adaptations mobile.

Cette separation evite qu'une regression ou un cache sur le style d'authentification casse les ecrans client.

## Verification beta

Controles effectues apres deploiement :

- `/client-staff.html` : HTTP `200` ;
- `/client-customers.html` : HTTP `200` ;
- `/client-api/staff` : HTTP `200` ;
- `/client-api/customers` : HTTP `200` ;
- feuille `client-ui.css?v=20260709-2` chargee par les deux pages ;
- rendu navigateur verifie sur Personnel et Clients ;
- bouton `Enregistrer` verifie a largeur normale ;
- liste Personnel : `4` lignes ;
- liste Clients : `814` lignes.

## Evolution navigation

Le menu client a ete remonte dans le bandeau haut pour liberer la largeur utile des pages metier.

Changement applique :

- suppression de la colonne laterale ;
- navigation compacte avec pictogrammes ;
- contenu principal en pleine largeur ;
- cache CSS force avec `client-ui.css?v=20260709-3`.

Controle effectue :

- page Clients : menu haut charge, aucune sidebar restante ;
- contenu principal aligne a gauche de l'ecran ;
- CSS `v=20260709-3` charge ;
- API et pages Clients, Personnel, Expeditions : HTTP `200`.

## Evolution en-tete compact

Le bloc haut des pages client a ete compacte pour augmenter la surface de travail visible :

- titre reduit ;
- texte descriptif masque dans l'interface ;
- boutons d'action plus bas ;
- KPI reduits en barre de synthese ;
- cache CSS force avec `client-ui.css?v=20260709-5`.

Controle effectue sur la page Expeditions :

- debut de la zone de travail remonte autour de `243px` ;
- titre mesure a environ `25.6px` ;
- KPI compacts visibles ;
- liste chargee avec `18538` expeditions.
