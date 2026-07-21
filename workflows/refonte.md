# Workflow de refonte

## 1. Cadrer

But : savoir pourquoi la refonte existe et comment juger sa reussite.

Sorties attendues :

- objectifs ;
- non-objectifs ;
- contraintes ;
- definition de succes ;
- perimetre initial.

Fichiers :

- `docs/analyse/fiche-logiciel-existant.md`
- `docs/suivi/journal-projet.md`

## 2. Analyser l'existant

But : comprendre le logiciel actuel avant de le remplacer.

Sorties attendues :

- modules ;
- ecrans ;
- flux metier ;
- donnees ;
- integrations ;
- irritants ;
- comportements critiques a conserver.

Fichiers :

- `docs/analyse/cartographie-fonctionnelle.md`
- `knowledge/`

## 3. Definir la cible

But : concevoir une version cible realiste.

Sorties attendues :

- architecture cible ;
- choix techniques ;
- principes UX ;
- modeles de donnees ;
- strategie de migration.

Fichiers :

- `docs/architecture/architecture-cible.md`
- `docs/architecture/plan-migration.md`
- `docs/decisions/`

## 4. Construire le backlog

But : transformer la cible en travail executable.

Sorties attendues :

- epics ;
- user stories ;
- tickets techniques ;
- criteres d'acceptation ;
- priorites.

Fichiers :

- `backlog/epics.md`
- `backlog/user-stories.md`
- `backlog/tickets-techniques.md`

## 5. Executer et suivre

But : piloter la refonte par increments.

Sorties attendues :

- avancement ;
- blocages ;
- decisions ;
- risques ;
- prochaines actions.

Fichiers :

- `docs/suivi/journal-projet.md`
- `docs/risques/registre-risques.md`
- `docs/decisions/`

## 6. Verifier la continuite

But : garantir que la nouvelle version couvre les comportements importants de l'ancienne.

Sorties attendues :

- scenarios de test ;
- matrice ancien/nouveau ;
- criteres de recette ;
- ecarts assumes.

Fichiers :

- `docs/analyse/matrice-ancien-nouveau.md`
- `backlog/user-stories.md`
