# Inventaire source - MY TRACKING

## Source analysee

- Chemin : `C:\Mes Projets\Projet_texte\MY TRACKING\mytracking`
- Projet principal observe : `mulcol.WDP`
- Description WinDev observee : `Multi colis`
- Version projet observee : WinDev `major_version : 31`, `minor_version : 4`
- Generation observee : `.\Exe\mulcol\mulcol.exe` et configuration `mulcol64`

## Nature du projet

Application WinDev desktop metier orientee transport/logistique. Le nom technique historique semble etre `mulcol`, tandis que le nom produit utilise pour la refonte est `MY TRACKING`.

## Repertoires importants

| Repertoire | Role observe | Remarque |
| --- | --- | --- |
| Racine | Version courante analysee | Contient le projet, fenetres, classes, requetes, etats |
| `Analyse` | Modele de donnees WinDev / HyperFileSQL | Contient `.wdd`, `.fic`, `.ndx`, `.mmo` |
| `Exe` | Sorties generees | Executables et dependances probables |
| `Svg_20260705_1834` | Sauvegarde/copie | A ne pas analyser comme version principale au depart |
| `Svg_V30_20260705_1832` | Sauvegarde/copie version precedente probable | A comparer plus tard si besoin |
| `mulcol.cpl` | Copie locale / environnement utilisateur | A traiter comme source secondaire |
| `cache.gestion de sources` | Cache de gestion de sources WinDev | Ne pas prendre comme base fonctionnelle initiale |
| `GABARITS` | Gabarits UI WinDev | Utile pour comprendre le style historique |
| `xml` | Schemas ou fichiers d'echange | A inspecter pour les integrations |

## Volumetrie observee a la racine

| Type | Nombre | Interpretation |
| --- | ---: | --- |
| `.wdw` | 290 | Fenetres WinDev |
| `.WDR` | 232 | Requetes WinDev |
| `.wde` | 128 | Etats / impressions |
| `.wdc` | 62 | Classes et procedures |
| `.wdg` | 12 | Collections de procedures globales |
| `.cache` | 496 | Cache WinDev, a ignorer pour la logique |
| `.png` | 83 | Assets UI |
| `.wdi/.wdk` | 4 / 4 | Composants externes ou internes |
| `.wdd` | 1 | Analyse / schema de donnees principal |

## Fichiers representatifs observes

| Fichier | Role probable |
| --- | --- |
| `mulcol.WDP` | Projet WinDev principal |
| `_Expedition.wdc` | Classe de mapping expedition, tres centrale |
| `COL_Webservice.wdg` | Procedures webservice, notamment GLS |
| `COL_Metier.wdg` | Procedures metier generales |
| `Procedures globales de mulcol.wdg` | Logique globale historique |
| `Accueil.wdw` | Fenetre d'accueil principale probable |
| `Expedition_table.wdw`, `Saisie_fiche.wdw`, `Saisie_modif.wdw` | Gestion des expeditions |
| `Affretement_table.wdw`, `FEN_Saisie_Affretement.wdw` | Affretement |
| `Clients_fiche.wdw`, `Clients_table.wdw` | Gestion client |
| `edition_facture.wdw`, `validation_facture.wdw` | Facturation |

## Hypotheses a verifier

- Le coeur metier est l'expedition/position, autour de laquelle gravitent facturation, tournee, affretement et editions.
- La base est probablement HyperFileSQL/WinDev, avec mapping objet dans les classes `_*.wdc`.
- Les requetes `.WDR` portent une part importante de la logique de recherche, selection, edition et validation.
- Les integrations GLS/PTV/ERP/EDI sont critiques pour la refonte.
- Les sauvegardes `Svg_*` peuvent servir a comparer des versions mais ne doivent pas polluer l'inventaire initial.
