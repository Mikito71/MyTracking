# Environnement mytracking-beta

## Objectif

Creer un espace de test portable pour MyTracking sur le serveur OVH.

L'environnement doit pouvoir etre deplace facilement vers un autre serveur. Pour cela, il repose sur :

- un dossier unique : `/opt/mytracking-beta` ;
- Docker Compose ;
- des volumes nommes ;
- un fichier `.env` non versionne ;
- une procedure de sauvegarde/restauration.

## Regles

- Ne jamais versionner le fichier `.env`.
- Ne jamais stocker de mot de passe dans ce dossier git.
- Ne pas melanger beta et production.
- Garder les donnees de test exportables.
- Documenter chaque changement d'infrastructure.

## Creation sur le serveur OVH

Commandes indicatives a executer sur le serveur :

```bash
sudo mkdir -p /opt/mytracking-beta
sudo chown "$USER:$USER" /opt/mytracking-beta
cd /opt/mytracking-beta
```

Copier ensuite les fichiers de ce dossier dans `/opt/mytracking-beta`.

Puis creer le fichier `.env` depuis l'exemple :

```bash
cp .env.example .env
nano .env
```

Le fichier `.env` doit contenir les vrais secrets uniquement sur le serveur.

## Demarrage

```bash
docker compose --env-file .env up -d
docker compose --env-file .env ps
```

Avec la configuration beta par defaut, le reverse proxy Docker ecoute localement sur :

```text
127.0.0.1:3100
```

Le reverse proxy public du serveur peut ensuite router `https://mytracking-beta.51-210-14-228.sslip.io` vers ce port local.

## Arret

```bash
docker compose --env-file .env down
```

## Mise a jour

```bash
docker compose --env-file .env pull
docker compose --env-file .env up -d
```

## Deplacement vers un autre serveur

1. Arreter les ecritures applicatives.
2. Sauvegarder PostgreSQL.
3. Copier le dossier `/opt/mytracking-beta`.
4. Copier le fichier `.env` par canal securise.
5. Restaurer la sauvegarde PostgreSQL sur le nouveau serveur.
6. Lancer `docker compose --env-file .env up -d`.
7. Verifier l'application et mettre a jour le DNS si necessaire.

Voir `backup-restore.md`.

## Etat actuel

Les images `WEB_IMAGE` et `API_IMAGE` pointent temporairement vers `nginx:alpine`.

Le service `web` sert les fichiers statiques places dans :

```text
static/
```

Elles seront remplacees par les images reelles lorsque les applications Next.js et NestJS seront creees.

## Synchronisation beta depuis WinDev

Le backoffice admin expose un bouton destructif "Synchroniser WinDev".

Objectif :

- remettre la base beta en adequation avec la production WinDev ;
- ecraser les saisies faites dans la nouvelle version depuis la derniere synchro ;
- conserver un journal d'execution dans PostgreSQL (`windev_sync_runs`).

Le bouton ne contient aucun secret et ne connait pas la connexion HFSQL. Il execute uniquement la commande serveur configuree dans `.env` :

```bash
WINDEV_SYNC_COMMAND="commande-interne-de-sync"
WINDEV_SYNC_TIMEOUT_MS=900000
```

La commande configuree doit realiser l'operation complete : sauvegarde si necessaire, purge des donnees beta concernees, import WinDev, controles de comptage et sortie d'un resume lisible. Ne jamais stocker de mot de passe ODBC/HFSQL dans les fichiers versionnes.
