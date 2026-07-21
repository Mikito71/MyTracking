# Module Organisation

## Objectif

Premier socle SaaS de MyTracking : gerer la societe, ses agences et ses employes.

Regle metier de depart :

> Une societe peut avoir plusieurs agences. Chaque agence voit ses propres expeditions.

Regle d'architecture :

> Une societe cliente dispose de sa propre base metier. Les agences, employes et expeditions de cette societe vivent dans cette base dediee.

## Sources WinDev observees

| Table | Role observe | Points utiles |
| --- | --- | --- |
| `Societe` | Societe / entite juridique | `IDSociete`, nom, adresse, telephone, email, `Code_societe`, informations bancaires |
| `Agence` | Agence rattachee a une societe | `Idagence`, `Code_societe`, `cle_unique_agence`, `Code_agence`, adresse, EDI, facturation, parametrage |
| `Utilisateur` | Utilisateur historique | `IDUtilisateur`, `cle_unique_agence`, `Cle_unique_utilisateur`, nom, prenom, login, email, telephone |
| `Chauffeur` | Employe terrain / chauffeur | `IDChauffeur`, `cle_unique_agence`, code chauffeur, nom, prenom, login, telephone, position, etats en cours |
| `Expedition` | Expedition / position | `IDExpedition`, `cle_unique_agence`, rattachement agence, liens vers facturation, affrete, tournee |

Champs sensibles observes dans l'existant :

- `Utilisateur.Mot_de_passe`
- `Utilisateur.MotPasseMail`
- `Agence.MotDePasse_Email_Aff`
- `Chauffeur.MotDePasse`
- `Connexion.Password`

Ces champs ne doivent pas etre recopies tels quels dans la refonte. La cible SaaS doit utiliser une authentification moderne avec mots de passe haches, secrets hors base applicative quand necessaire et aucune exposition dans les exports projet.

## Modele cible simple

## Backoffice plateforme

Avant d'entrer dans la base metier d'une societe, MyTracking doit disposer d'un backoffice plateforme.

Objectif :

- creer une nouvelle societe cliente ;
- provisionner sa base dediee ;
- stocker les informations techniques de tenant ;
- connaitre l'etat de la societe : active, suspendue, en migration, archivee ;
- permettre de deplacer une societe vers une autre infrastructure.

### Tenant

Societe vue par la plateforme SaaS.

Champs proposes :

- `id`
- `companyName`
- `companyCode`
- `status`
- `databaseId`
- `createdAt`
- `updatedAt`

### TenantDatabase

Emplacement technique de la base metier d'une societe.

Champs proposes :

- `id`
- `tenantId`
- `provider`
- `host`
- `port`
- `databaseName`
- `schemaVersion`
- `status`
- `createdAt`
- `updatedAt`

Notes securite :

- Les mots de passe et chaines de connexion completes ne doivent pas etre stockes en clair dans les documents ou le code.
- Le backoffice reference la base ; les secrets doivent etre geres via variables d'environnement, coffre de secrets ou service equivalent.

### Provisioning

Quand une societe est creee :

1. Le backoffice cree le tenant.
2. Le systeme provisionne une base PostgreSQL dediee.
3. Les migrations Prisma du tenant sont appliquees.
4. Une societe `Company` initiale est creee dans la base tenant.
5. Un administrateur societe est invite.

### Deplacement d'une societe

Le fait d'avoir une base dediee permet de deplacer une societe plus facilement :

1. suspendre temporairement les ecritures du tenant ;
2. sauvegarder/restaurer la base sur la nouvelle infrastructure ;
3. mettre a jour `TenantDatabase` dans le control plane ;
4. relancer les workers/synchronisations du tenant ;
5. verifier l'integrite et rouvrir les acces.

### Company

Societe cliente du SaaS.

Champs proposes :

- `id`
- `legacyId`
- `name`
- `code`
- `siret`
- `vatNumber`
- `email`
- `phone`
- `address`
- `createdAt`
- `updatedAt`

### Agency

Agence appartenant a une societe.

Champs proposes :

- `id`
- `companyId`
- `legacyId`
- `name`
- `code`
- `legacyUniqueKey`
- `email`
- `phone`
- `address`
- `ediIdentifier`
- `isActive`
- `createdAt`
- `updatedAt`

Correspondances WinDev probables :

- `Agence.Idagence` -> `Agency.legacyId`
- `Agence.Code_societe` -> lien historique vers `Societe.Code_societe`
- `Agence.cle_unique_agence` -> cle historique importante pour filtrer les expeditions
- `Agence.Code_agence` -> code metier agence
- `Expedition.cle_unique_agence` -> rattachement d'une expedition a une agence

### Employee

Personne travaillant pour une societe, potentiellement rattachee a une ou plusieurs agences.

Champs proposes :

- `id`
- `companyId`
- `legacyUtilisateurId`
- `legacyChauffeurId`
- `firstName`
- `lastName`
- `email`
- `phone`
- `status`
- `createdAt`
- `updatedAt`

### UserAccount

Compte de connexion SaaS.

Champs proposes :

- `id`
- `employeeId`
- `legacyUniqueUserKey`
- `login`
- `email`
- `passwordHash`
- `lastLoginAt`
- `isActive`
- `createdAt`
- `updatedAt`

Notes :

- Ne jamais stocker de mot de passe en clair.
- Ne pas reprendre les mots de passe WinDev.
- Prevoir une procedure d'invitation ou de reinitialisation.
- Pour l'acces client, l'utilisateur ne saisit pas de code societe : son email/compte doit permettre de retrouver sa societe et son tenant.
- L'email de connexion client doit etre unique dans le perimetre d'authentification choisi, ou gere par une table d'identites globale si un meme email doit acceder a plusieurs societes.

### Profile

Profil de droits metier.

Un profil represente un ensemble de permissions fonctionnelles. Un employe peut avoir plusieurs profils.

Profils initiaux proposes :

- `COMPANY_ADMIN` : administration societe ;
- `AGENCY_MANAGER` : pilotage d'agence ;
- `OPERATIONS` : exploitation transport ;
- `AFFREIGHTER` : affretement ;
- `ACCOUNTING` : comptabilite/facturation ;
- `DRIVER` : chauffeur/mobile terrain ;
- `READ_ONLY` : consultation.

### AgencyMembership

Rattachement d'un employe a une agence.

Champs proposes :

- `id`
- `employeeId`
- `agencyId`
- `isDefault`
- `createdAt`

### EmployeeProfileAssignment

Attribution d'un profil a un employe.

Champs proposes :

- `id`
- `employeeId`
- `profileId`
- `agencyId`
- `createdAt`

Notes :

- `agencyId` est optionnel.
- Si `agencyId` est vide, le profil s'applique a toute la societe selon les permissions du profil.
- Si `agencyId` est renseigne, le profil s'applique seulement a cette agence.

Exemples :

- un employe peut avoir `OPERATIONS` sur l'agence A et `READ_ONLY` sur l'agence B ;
- un responsable peut avoir `AGENCY_MANAGER` sur plusieurs agences ;
- un comptable peut avoir `ACCOUNTING` sur toute la societe ;
- un chauffeur peut avoir `DRIVER` sur son agence principale.

## Frontieres de donnees

### Base plateforme

Contient seulement :

- tenants ;
- emplacements de bases ;
- etats de provisioning ;
- utilisateurs plateforme internes ;
- logs techniques minimaux.

Ne contient pas :

- expeditions ;
- factures ;
- clients transport ;
- tournees ;
- documents metier.

### Base societe

Contient :

- company ;
- agencies ;
- employees ;
- profiles ;
- shipments ;
- invoices ;
- tours ;
- affretement ;
- historique.

## Regles d'acces

### Regle 1 - Portee agence

Par defaut, un utilisateur rattache a une agence voit uniquement les expeditions de cette agence.

Ancien champ de filtrage probable :

- `Expedition.cle_unique_agence`

Cible :

- `Shipment.agencyId`

### Regle 2 - Profils multiples

Un employe peut cumuler plusieurs profils.

Exemples :

- exploitation + affretement ;
- comptabilite + lecture seule exploitation ;
- responsable agence + exploitation ;
- chauffeur + consultation de ses tournees.

### Regle 3 - Portee societe

Un administrateur societe peut voir et administrer toutes les agences de sa societe.

Cible :

- `CompanyAdmin` ou role `COMPANY_ADMIN`.

### Regle 4 - Multi-agence

Un employe peut etre rattache a plusieurs agences si son role le justifie.

Exemples :

- superviseur regional ;
- comptabilite ;
- exploitation multi-site ;
- direction.

### Regle 5 - Chauffeur

Un chauffeur est un employe ou profil terrain rattache a une agence principale. Il peut avoir des droits mobiles limites.

## Premier schema Prisma conceptuel

```prisma
model Company {
  id        String   @id @default(cuid())
  legacyId  BigInt?   @unique
  name      String
  code      String   @unique
  siret     String?
  vatNumber String?
  email     String?
  phone     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  agencies  Agency[]
  employees Employee[]
}

model Agency {
  id              String   @id @default(cuid())
  companyId       String
  legacyId        BigInt?  @unique
  name            String
  code            String
  legacyUniqueKey String?  @unique
  email           String?
  phone           String?
  ediIdentifier   String?
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  company     Company            @relation(fields: [companyId], references: [id])
  memberships AgencyMembership[]

  @@unique([companyId, code])
}

model Employee {
  id                   String   @id @default(cuid())
  companyId            String
  legacyUtilisateurId  BigInt?
  legacyChauffeurId    BigInt?
  firstName            String
  lastName             String
  email                String?
  phone                String?
  status               String   @default("ACTIVE")
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  company     Company            @relation(fields: [companyId], references: [id])
  account     UserAccount?
  memberships AgencyMembership[]
  profileAssignments EmployeeProfileAssignment[]
}

model UserAccount {
  id                  String    @id @default(cuid())
  employeeId          String    @unique
  legacyUniqueUserKey String?   @unique
  login               String    @unique
  email               String?
  passwordHash        String
  lastLoginAt         DateTime?
  isActive            Boolean   @default(true)
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  employee Employee @relation(fields: [employeeId], references: [id])
}

model AgencyMembership {
  id         String   @id @default(cuid())
  employeeId String
  agencyId   String
  isDefault  Boolean  @default(false)
  createdAt  DateTime @default(now())

  employee Employee @relation(fields: [employeeId], references: [id])
  agency   Agency   @relation(fields: [agencyId], references: [id])

  @@unique([employeeId, agencyId])
}

model Profile {
  id          String   @id @default(cuid())
  code        String   @unique
  label       String
  description String?
  isSystem    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  assignments EmployeeProfileAssignment[]
}

model EmployeeProfileAssignment {
  id         String   @id @default(cuid())
  employeeId String
  profileId  String
  agencyId   String?
  createdAt  DateTime @default(now())

  employee Employee @relation(fields: [employeeId], references: [id])
  profile  Profile  @relation(fields: [profileId], references: [id])
  agency   Agency?  @relation(fields: [agencyId], references: [id])

  @@unique([employeeId, profileId, agencyId])
}
```

Ce schema est conceptuel. Il devra etre ajuste quand le socle NestJS/Prisma sera cree.

## Impact sur les expeditions

La future entite `Shipment` devra porter un `agencyId` et conserver l'identifiant WinDev `IDExpedition` dans un champ de migration.

Correspondance probable :

| Ancien | Nouveau |
| --- | --- |
| `Societe.IDSociete` | `Company.legacyId` |
| `Societe.Code_societe` | `Company.code` |
| `Agence.Idagence` | `Agency.legacyId` |
| `Expedition.cle_unique_agence` | `Shipment.agencyId` via correspondance `Agency.legacyUniqueKey` |
| `Agence.cle_unique_agence` | `Agency.legacyUniqueKey` |
| `Agence.Code_societe` | `Company.code` ou table de migration |
| `Expedition.IDExpedition` | `Shipment.legacyId` |
| `Utilisateur.IDUtilisateur` | `Employee.legacyUtilisateurId` |
| `Utilisateur.Cle_unique_utilisateur` | `UserAccount.legacyUniqueUserKey` |
| `Chauffeur.IDChauffeur` | `Employee.legacyChauffeurId` si le chauffeur devient un employe |

## Strategie d'identifiants

La cible SaaS utilise des IDs applicatifs propres (`cuid` ou UUID) et conserve les IDs WinDev dans des champs `legacy*`.

Raisons :

- faciliter la migration incrementalement ;
- permettre les rapprochements ancien/nouveau ;
- conserver la tracabilite des exports, tickets et controles ;
- eviter de faire dependre le SaaS des conventions d'IDs WinDev.

Regle :

- les nouvelles relations SaaS utilisent les IDs SaaS ;
- les champs `legacyId` servent a la migration, l'audit et la verification ;
- aucune logique metier nouvelle ne doit dependre uniquement d'un ancien ID WinDev.

## Questions ouvertes

- Une agence appartient-elle toujours a une seule societe ?
- Un employe peut-il travailler dans plusieurs agences ?
- Les chauffeurs doivent-ils etre des employes comme les autres avec role `DRIVER`, ou une entite separee ?
- Faut-il distinguer employe interne, affreteur, chauffeur et partenaire externe ?
- Les expeditions confiees a un confrere restent-elles visibles dans l'agence d'origine ?
- Les profils doivent-ils etre personnalisables par societe ou seulement systeme au depart ?
- Un profil global societe doit-il donner acces a toutes les agences par defaut ?
- La creation de base dediee doit-elle etre automatique ou validee manuellement par un administrateur plateforme ?
- Faut-il prevoir une base dediee par societe des le developpement local via Docker Compose ?
