# Backoffice societes beta - 2026-07-09

## Objectif

Permettre la consultation et la modification des vraies societes stockees dans PostgreSQL beta depuis les pages admin.

## Changements appliques

- La page `/admin/index.html` charge maintenant la liste depuis la table `companies`.
- La page `/admin/create-company.html` sert a la fois a creer une societe et a modifier une societe existante via `?id=...`.
- L'identifiant WinDev est conserve en base pour la migration mais masque dans le formulaire admin.
- Un bouton `Interface client` permet d'ouvrir l'ecran client existant `/login-client.html` depuis la liste et la fiche societe.
- Le service `admin-auth` expose des endpoints JSON authentifies :
  - `GET /admin/api/companies`
  - `GET /admin/api/companies/:id`
  - `POST /admin/api/companies`
  - `PUT /admin/api/companies/:id`
- La table `companies` est completee automatiquement avec les champs administrables manquants :
  - `siret`
  - `vat_number`
  - `contact_name`
  - `contact_email`
  - `status`
  - `notes`

## Verification

Controles effectues sur beta :

- service `mytracking-beta-admin-auth-1` redemarre et stable ;
- page de login admin disponible ;
- API liste retourne la societe importee `IDSociete = 1970324836974592001` ;
- API detail retourne la fiche `SGA` ;
- sauvegarde `PUT` testee sans creation de doublon ;
- table `companies` controlee a `1` ligne apres sauvegarde.

## Note technique

Le conteneur `admin-auth` utilise l'image `node:22-alpine`. La dependance PostgreSQL `pg` est installee au demarrage dans un dossier temporaire du conteneur, puis chargee via `NODE_PATH`.

A terme, ce comportement devra etre remplace par une image applicative construite proprement pour le backend admin.
