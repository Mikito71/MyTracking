# Agent IA - MyTracking SaaS

Ce workspace transforme cette conversation en agent IA principal du projet MyTracking.

Objectif : transformer MyTracking en application SaaS moderne avec application web, API backend, application mobile Android/iPhone, fonctionnement offline et synchronisation des donnees.

## Stack cible

| Couche | Technologie |
| --- | --- |
| Front web | Next.js |
| Mobile | React Native Expo |
| API backend | NestJS |
| Base serveur | PostgreSQL |
| Base mobile | SQLite |
| ORM | Prisma |
| Deploiement | Docker |

## Demarrage rapide

1. Remplir `docs/analyse/fiche-logiciel-existant.md`.
2. Ajouter les informations connues dans `knowledge/`.
3. Utiliser `backlog/epics.md` pour decouper les grands domaines.
4. Alimenter `docs/suivi/journal-projet.md` apres chaque session.
5. Enregistrer les arbitrages dans `docs/decisions/adr-0001-template.md`.
6. Suivre `workflows/saas.md` pour construire la cible web/API/mobile/offline.

## Role de cette conversation

Cette conversation sert d'agent principal. Vous pouvez lui demander de :

- analyser une fonctionnalite existante ;
- transformer une discussion en tickets ;
- produire une specification ;
- proposer un plan de migration ;
- relire une architecture ;
- concevoir un module SaaS ;
- definir une strategie offline/synchronisation ;
- suivre les risques et blocages ;
- preparer les prochaines actions.

## Regles de travail

- Travailler par petites etapes.
- Lire les fichiers existants avant d'agir.
- Proposer un plan court avant modification.
- Modifier uniquement les fichiers necessaires.
- Ne jamais supprimer de code sans expliquer.
- Ne jamais toucher aux secrets ou mots de passe.
- Creer des fichiers clairs et documentes.
- Garder une architecture simple.
- Donner les commandes de test quand il y a du code a verifier.
- Resumer chaque changement.

## Commandes utiles a demander

- "Analyse ce module et resume les regles metier."
- "Transforme ces notes en backlog priorise."
- "Cree les tickets pour le prochain sprint."
- "Compare l'ancien comportement avec la cible."
- "Mets a jour le journal de projet."
- "Identifie les risques de cette decision technique."
- "Propose le schema Prisma pour ce domaine."
- "Decoupe ce module en API NestJS, web Next.js et mobile Expo."
- "Definis la strategie offline et synchronisation pour cette fonctionnalite."
