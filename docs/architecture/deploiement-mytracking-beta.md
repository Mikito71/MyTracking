# Deploiement mytracking-beta

## Objectif

Preparer un espace de test `mytracking-beta` sur OVH, deplacable facilement vers un autre serveur.

## Decision

L'environnement beta est isole dans `/opt/mytracking-beta` et gere par Docker Compose.

Le dossier contient :

- `docker-compose.yml` ;
- `.env.example` ;
- configuration reverse proxy ;
- documentation de sauvegarde/restauration.

Le fichier `.env` reel reste uniquement sur le serveur et n'est pas versionne.

## Pourquoi ce choix

- simple a installer sur un VPS OVH ;
- portable vers un autre serveur ;
- compatible avec les futures images Next.js et NestJS ;
- PostgreSQL isole dans un volume nomme ;
- secrets separes du code ;
- beta clairement separe de la production.

## URL cible

Nom recommande :

```text
mytracking-beta
```

Depuis le projet Qualisol, le serveur OVH observe expose deja :

```text
https://51-210-14-228.sslip.io
```

Adresse IP deduite :

```text
51.210.14.228
```

URL beta provisoire proposee :

```text
https://mytracking-beta.51-210-14-228.sslip.io
```

Voir `docs/architecture/serveur-ovh-observe.md`.

## Composants V1

- `reverse-proxy` : entree HTTP pour web et API ;
- `web` : future application Next.js ;
- `api` : future API NestJS ;
- `postgres` : base control plane beta.

Sur le serveur OVH observe, l'environnement beta doit ecouter localement sur :

```text
127.0.0.1:3100
```

Le Caddy existant peut ensuite exposer :

```text
https://mytracking-beta.51-210-14-228.sslip.io
```

## Deplacement serveur

Le deplacement repose sur trois elements :

1. le dossier `/opt/mytracking-beta` ;
2. le fichier `.env` transmis hors git ;
3. la sauvegarde PostgreSQL.

Tant que ces trois elements sont disponibles, l'espace beta peut etre relance sur un autre serveur avec Docker Compose.

## Limites actuelles

Les applications web et API n'existent pas encore. Les images sont donc temporaires et seront remplacees quand le squelette applicatif sera cree.

L'acces SSH a ete retrouve ensuite dans le repertoire utilisateur. L'espace beta est installe sur le serveur OVH :

```text
/home/ubuntu/saas/mytracking-beta
```

L'URL publique repond :

```text
https://mytracking-beta.51-210-14-228.sslip.io
```

Etat au 2026-07-05 :

- conteneurs Docker `mytracking-beta` demarres ;
- PostgreSQL beta healthy ;
- reverse proxy beta expose localement sur `127.0.0.1:3100` ;
- Caddy route l'URL publique vers ce port local ;
- `.env` reel genere sur le serveur et non versionne.

## Fichiers

Voir `infra/environments/mytracking-beta/`.
