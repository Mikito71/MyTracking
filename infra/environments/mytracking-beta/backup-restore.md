# Sauvegarde et restauration mytracking-beta

## Sauvegarde PostgreSQL

Depuis le dossier `/opt/mytracking-beta` :

```bash
mkdir -p backups
docker compose --env-file .env exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --file=/tmp/mytracking-beta.dump'
docker compose --env-file .env cp postgres:/tmp/mytracking-beta.dump ./backups/mytracking-beta.dump
```

Le dossier `backups/` ne doit pas etre versionne.

## Restauration PostgreSQL

Depuis le nouveau serveur :

```bash
docker compose --env-file .env up -d postgres
docker compose --env-file .env cp ./backups/mytracking-beta.dump postgres:/tmp/mytracking-beta.dump
docker compose --env-file .env exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists /tmp/mytracking-beta.dump'
```

## Verification apres restauration

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs --tail=100 postgres
```

## Points importants

- La sauvegarde doit etre testee avant une vraie bascule.
- Le fichier `.env` doit etre transmis par canal securise, jamais par git.
- Le DNS peut etre modifie apres verification du nouveau serveur.
