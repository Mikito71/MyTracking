# Modele de donnees initial

## Sources analysees

| Source | Chemin | Role |
| --- | --- | --- |
| Analyse WinDev XML | `C:\Mes Projets\Projet_texte\MY TRACKING\mytracking\Analyse\mulcol.xdd` | Description lisible des fichiers/tables, rubriques/champs, cles et tailles |
| Analyse WinDev binaire | `C:\Mes Projets\Projet_texte\MY TRACKING\mytracking\Analyse\mulcol.wdd` | Fichier d'analyse WinDev principal |
| Classes WinDev | `C:\Mes Projets\Projet_texte\MY TRACKING\mytracking\_*.wdc` | Mappings objet/champ utiles pour comprendre les objets metier |

Les informations de connexion presentes dans l'analyse ne sont pas recopiees ici. Les secrets et mots de passe ne doivent pas etre manipules dans les documents projet.

## Extractions generees

| Fichier | Contenu |
| --- | --- |
| `knowledge/schema/xdd-schema.csv` | Extraction complete depuis `mulcol.xdd` : tables, champs, types WinDev, cles, tailles |
| `knowledge/schema/xdd-tables-summary.csv` | Resume par table depuis `mulcol.xdd` |
| `knowledge/schema/classes-mapping.csv` | Champs mappes depuis les classes `_*.wdc` |
| `knowledge/schema/classes-summary.csv` | Resume par classe WinDev |

## Volumetrie

| Source | Resultat |
| --- | ---: |
| `mulcol.xdd` | 167 tables |
| `mulcol.xdd` | 2856 rubriques/champs |
| classes `_*.wdc` | 646 champs mappes |

## Tables principales detectees

| Table | Champs | Role probable |
| --- | ---: | --- |
| `Expedition` | 240 | Coeur metier : positions, expediteurs, destinataires, taxation, livraison, affretement, EDI, tracking |
| `arch_Expedition` | 171 | Archive des expeditions |
| `Clients` | 150 | Clients, facturation, EDI, parametrage client, portail, produits autorises |
| `ExpedSupprimee` | 144 | Expeditions supprimees |
| `SasEdi` | 105 | SAS/import EDI |
| `Agence` | 101 | Agences, parametrage, numerotation, editions, integration |
| `Historique` | 73 | Historique des evenements de suivi |
| `Parametres` | 58 | Parametrage global |
| `Enlevement` | 49 | Enlevements / ramasses |
| `Produit` | 43 | Produits transport |
| `Expedition_Matieres` | 43 | Matieres / marchandises liees aux expeditions |
| `Facture_Entete` | 33 | Entetes de factures |
| `Facture_Detail` | 21 | Lignes de facture |
| `Affretes` | 17 | Affretes / confreres / partenaires |
| `Affretes_Contact` | 4 | Contacts des affretes |
| `Expeditions_AffretesContact` | 4 | Lien expedition/contact affrete |
| `Pci` | 13 | Colis / tracking colis |
| `Tournee` | 11 | Tournees |
| `PreTournee_Entete` | 7 | Preparation de tournee |
| `PreTournee_Detail` | 3 | Expeditions rattachees a une pretournee |

## Entites metier confirmees par les classes

Les classes `_*.wdc` ne couvrent pas toute l'analyse, mais elles donnent une lecture metier utile.

| Classe | Champs mappes | Lecture |
| --- | ---: | --- |
| `Expedition` | 161 | Objet central de transport |
| `Clients` | 143 | Objet client tres riche, avec facturation et EDI |
| `Agence` | 97 | Parametrage agence important |
| `Expedition_Matieres` | 43 | Detail marchandises |
| `Facture_Entete` | 26 | Facturation |
| `Facture_Detail` | 19 | Detail facturation |
| `CChauffeur` | 17 | Chauffeurs |
| `CLivraisonTournee` | 16 | Tournee numerique / livraison |
| `Affretes` | 14 | Affretes / confreres |
| `Pci` | 10 | Colis |
| `Tournee` | 7 | Tournees |

## Champs structurants de `Expedition`

La table `Expedition` est tres large. Les groupes suivants ressortent :

- identifiants : `IDExpedition`, `cle_unique_agence`, `Recepisse`, `reference_edi`, `Code_barre_unique` ;
- expediteur : `Code_expediteur`, `Nom_expediteur`, adresses, pays, CP, ville, telephone ;
- destinataire : `Nom_destinataire`, adresses, pays, CP, ville, telephone, email ;
- transport : `Colis`, `Poids`, `Volume`, `Code_produit`, `Nature_marchandise`, dimensions ;
- taxation : `Montant_transport`, `montant_tva`, `Taxe_additionnelle`, `Taxe_cremb`, `montant_gasoil`, `Prix_de_vente` ;
- exploitation : `date_depart`, `date_arrivage`, `Quai_charge`, `code_tournee_ramasse`, `Code_tournee_livraison`, `Code_chauffeur` ;
- affretement/confrere : `code_affrete`, `facture_confrere_recue`, `montant_sst`, `prix_convenu_sst` ;
- EDI/synchronisation : `reference_edi`, `Pos_recue_en_edi`, `Compte_reception_edi`, `Transfert_internet`, `Transmis_vers_site_central` ;
- suivi/litige : `Souffrance`, `libelle_litige`, `Emarge_scanne`, `Numero_emarge`, `Date_Livraison_Estimee`.

## Implications pour la refonte SaaS

- Ne pas copier `Expedition` telle quelle en Prisma : elle melange plusieurs responsabilites.
- Construire un modele cible autour de sous-domaines :
  - expedition ;
  - parties expediteur/destinataire ;
  - colis ;
  - suivi/evenements ;
  - taxation/facturation ;
  - tournee/livraison ;
  - affretement/confrere ;
  - EDI/integrations.
- Garder une matrice de correspondance ancien champ -> nouveau modele pour eviter les pertes.
- Prioriser les tables liees a `Expedition`, `Clients`, `Historique`, `Pci`, `Tournee`, `Affretes`, `Facture_Entete` et `Facture_Detail`.

## Questions ouvertes

- Quelles tables sont encore utilisees en production ?
- Quelles tables sont des temporaires ou des caches historiques ?
- Quelle base est la source de production : `Opentrans`, `Stockage`, autre ?
- Quelle strategie adopter pour les archives : migration complete, consultation seule, ou reprise partielle ?
- Comment separer proprement expedition livree en interne et expedition confiee a un confrere ?

## Focus initial - Organisation

Le premier domaine cible est la gestion de l'organisation :

- societe ;
- agences ;
- employes ;
- rattachements et roles ;
- visibilite des expeditions par agence.

Tables WinDev concernees :

| Table | Usage cible |
| --- | --- |
| `Societe` | Base de `Company` |
| `Agence` | Base de `Agency` |
| `Utilisateur` | Base partielle de `Employee` et `UserAccount` |
| `Chauffeur` | Profil terrain, probablement role `DRIVER` ou specialisation d'employe |
| `Expedition` | Doit etre rattachee a `Agency` via `cle_unique_agence` |

Regle de migration probable :

`Expedition.cle_unique_agence` correspond a `Agence.cle_unique_agence`, qui deviendra `Agency.legacyUniqueKey` dans la cible.

Identifiants historiques a conserver :

| WinDev | Cible SaaS |
| --- | --- |
| `Societe.IDSociete` | `Company.legacyId` |
| `Agence.Idagence` | `Agency.legacyId` |
| `Utilisateur.IDUtilisateur` | `Employee.legacyUtilisateurId` |
| `Utilisateur.Cle_unique_utilisateur` | `UserAccount.legacyUniqueUserKey` |
| `Chauffeur.IDChauffeur` | `Employee.legacyChauffeurId` ou profil chauffeur dedie |
| `Expedition.IDExpedition` | `Shipment.legacyId` |
