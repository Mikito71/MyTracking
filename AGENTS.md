# Instructions Codex - MyTracking

Codex doit suivre les instructions projet dans `agent/instructions.md`.

## Acces distant

Un alias SSH local est configure pour le serveur beta :

```bash
ssh mytracking-beta
```

Cet alias pointe vers le VPS OVH utilise pour l'environnement beta MyTracking.

Regles :

- ne jamais afficher, copier ou versionner de secrets ;
- ne pas modifier le service Qualisol existant ;
- utiliser le dossier serveur MyTracking separe ;
- documenter les changements d'infrastructure dans `docs/`.
