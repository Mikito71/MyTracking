# Protection des pages metier beta - 2026-07-20

## Besoin

L'espace client beta ne doit pas permettre l'acces direct aux pages metier `client-*.html`.
Un utilisateur doit passer par la page d'identification client, y compris apres une mise a jour de l'environnement.

## Decision

Le controle est place cote serveur dans le service `admin-auth`.

- Nginx route `/login-client.html`, `/client/login`, `/client/logout`, `/client-api/` et les pages `client-*.html` vers `admin-auth`.
- Les pages metier `client-*.html` redirigent vers `/login-client.html` sans cookie `mt_client` valide.
- Les appels `/client-api/` retournent `401` sans cookie `mt_client` valide.
- Le formulaire client poste vers `/client/login`, qui cree un cookie client signe avec `ADMIN_SESSION_SECRET`.
- Si `CLIENT_PASSWORD_SHA256` est configure dans `.env`, le mot de passe saisi doit correspondre a ce hash.
- Les sessions client creees avant le dernier demarrage du service `admin-auth` sont refusees.
- Les sessions client plus anciennes que les fichiers `login-client.html`, `client-*.html` ou `.client-auth-generation` sont refusees.

## Impact apres mise a jour

Un redemarrage du service `admin-auth` invalide les anciennes sessions client.
Une mise a jour des pages client invalide aussi les anciennes sessions client.
Apres un deploiement ou une mise a jour des pages metier, l'utilisateur doit donc repasser par `/login-client.html`.

## Limite connue

Cette protection reste une identification beta minimale si `CLIENT_PASSWORD_SHA256` n'est pas configure.
Elle bloque le contournement par URL directe, mais ne remplace pas encore une authentification client complete avec comptes, roles et politique de mot de passe.
