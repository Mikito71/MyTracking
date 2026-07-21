# Serveur OVH observe

## Source

Informations observees dans :

```text
C:\Users\mikae\OneDrive\Documents\DTDICT-qualisol
```

## Hote public observe

```text
https://51-210-14-228.sslip.io
```

Adresse IP deduite :

```text
51.210.14.228
```

## Service Qualisol observe

Documentation exposee :

```text
https://51-210-14-228.sslip.io/api-docs
https://51-210-14-228.sslip.io/api-docs-json
```

Ports documentes dans le projet Qualisol :

- API locale : `3010`
- front local : `3001`
- PostgreSQL local expose : `5433`

## Informations non trouvees

Les informations suivantes n'ont pas ete trouvees dans les fichiers consultes :

- chemin serveur exact ;
- configuration Nginx/Caddy/Traefik du serveur ;
- procedure de deploiement distante ;
- acces OVH Manager.

## Informations trouvees ensuite dans le repertoire utilisateur

Une cle SSH locale est presente dans :

```text
C:\Users\mikae\.ssh
```

La connexion suivante fonctionne :

```text
ubuntu@51.210.14.228
```

Un alias SSH local a ete ajoute pour Codex :

```bash
ssh mytracking-beta
```

Le serveur repond avec :

```text
hostname: vps-05b8f147
user: ubuntu
```

Le dossier principal observe est :

```text
/home/ubuntu/saas
```

Le serveur dispose de Docker, Docker Compose, PM2 et Caddy.

## Regles pour MyTracking

- Ne pas reutiliser les identifiants ou mots de passe d'exemple du projet Qualisol.
- Ne pas modifier le service Qualisol existant.
- Installer MyTracking dans un dossier separe, par exemple `/opt/mytracking-beta`.
- Utiliser des ports et noms Docker separes.
- Garder le fichier `.env` MyTracking hors git.

## URL beta provisoire

Tant que le DNS final n'est pas defini, l'environnement beta MyTracking peut utiliser un sous-domaine `sslip.io` base sur la meme IP :

```text
https://mytracking-beta.51-210-14-228.sslip.io
```

Selon la configuration du reverse proxy serveur, il faudra peut-etre ajouter explicitement ce nom d'hote.

## Installation MyTracking beta

Installation effectuee le 2026-07-05 :

```text
/home/ubuntu/saas/mytracking-beta
```

Port local :

```text
127.0.0.1:3100
```

Route Caddy ajoutee :

```text
https://mytracking-beta.51-210-14-228.sslip.io -> 127.0.0.1:3100
```

Sauvegarde Caddy creee avant modification :

```text
/home/ubuntu/saas/caddy/Caddyfile.bak.mytracking-beta-20260705201729
```

Le fichier `.env` reel existe uniquement sur le serveur et ses permissions sont limitees a l'utilisateur `ubuntu`.
