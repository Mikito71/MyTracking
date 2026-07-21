# Import personnel SGA beta - 2026-07-09

## Objectif

Ajouter dans le module personnel beta les personnes demandees pour SGA :

- Ali
- Elodie
- Loan
- Loris

## Source observee

La table HFSQL `Personnel` n'est pas exposee via la connexion ODBC beta `Opentrans_aff`.

Tests effectues :

- `Personnel` : fichier de donnees inconnu ;
- `Utilisateur` : fichier de donnees inconnu ;
- `Chauffeur` : visible mais vide ;
- `Commercial` : visible mais vide ;
- `Contact` : visible mais vide ;
- `ParamUser` : visible mais ne contient que des parametres techniques lies a des IDs utilisateur, sans nom/prenom exploitable.

Le mot de passe fourni pour ouvrir la table n'a pas ete stocke ni documente comme secret projet.

## Cible SaaS beta

Tables creees :

```text
staff_members
staff_change_events
```

Les 4 personnes ont ete importees comme personnel actif SGA, sans reprise de mot de passe historique.

## Mise a jour 2026-07-10

La fiche personnel beta est prete a recevoir les champs WinDev de `Utilisateur` :

- nom ;
- prenom ;
- login ;
- telephone ;
- email ;
- serveur SMTP ;
- port SMTP ;
- fichier HTML email ;
- signature mail HTML ;
- indicateur de mot de passe mail renseigne.

Les mots de passe ne sont pas affiches dans l'interface client et ne sont pas renvoyes par l'API.

Le mot de passe de fichier HFSQL a ete configure cote serveur beta dans l'environnement non versionne. Malgre cela, le driver ODBC HFSQL Linux retourne toujours `The Utilisateur data file is unknown` lors de la lecture de `Utilisateur`. Le fallback actuel reste donc base sur les createurs d'expeditions tant qu'un export WinDev ou un acces HFSQL capable d'ouvrir ce fichier protege n'est pas disponible.

## Interface

Page ajoutee :

```text
/client-staff.html
```

Fonctions disponibles :

- liste du personnel ;
- recherche ;
- fiche modifiable ;
- role et statut ;
- historique des modifications.

## Verification

Controles beta :

- `staff_members` : `4` lignes ;
- `staff_change_events` : `4` evenements d'import ;
- API `/client-api/staff` : HTTP `200` ;
- page `/client-staff.html` : HTTP `200`.
