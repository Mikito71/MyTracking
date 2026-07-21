const { spawn } = require("child_process");
const crypto = require("crypto");
const readline = require("readline");
const { Pool } = require("pg");

const databaseUrl = process.env.DATABASE_URL;
const hfsqlQueryCommand = process.env.HFSQL_QUERY_COMMAND;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

const scope = [
  "societe",
  "personnel",
  "clients",
  "expeditions",
  "produits",
  "affretes",
  "contacts affretes",
  "factures",
];

const tableNames = [
  "companies",
  "staff_members",
  "transport_customers",
  "transport_shipments",
  "transport_products",
  "transport_carriers",
  "transport_carrier_contacts",
  "billing_invoices",
  "billing_invoice_lines",
];

function clean(value) {
  if (value === null || value === undefined) return null;
  const text = String(value)
    .replace(/\bN\s*\uFFFD/gi, "N°")
    .replace(/\uFFFD/g, "'")
    .replace(/\s+'/g, "'")
    .trim();
  return text === "" ? null : text;
}

function moneyAmount(value) {
  const text = clean(value);
  if (!text) return null;
  const parsed = Number(text.replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function decimal(value) {
  const text = clean(value);
  if (!text) return null;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value) {
  const parsed = Number.parseInt(clean(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function bool(value) {
  const text = clean(value)?.toLowerCase();
  return ["1", "true", "vrai", "oui", "o", "yes", "y", "-1"].includes(text);
}

function productCodeFromInvoice(row) {
  const explicit = clean(row.Code_produit);
  if (explicit) return explicit.toUpperCase();
  const label = clean(row.Libelle_Produit)?.toUpperCase();
  if (!label) return null;
  const prefixed = label.match(/^([A-Z0-9]{2,8})(?:\s*[-:/]\s+|\s{2,})/);
  if (prefixed) return prefixed[1];
  if (label.includes("AFFRET")) return "AF";
  if (label.includes("LITIGE")) return "LT";
  if (label.includes("EXPEDITION")) return "EX";
  if (label.includes("PERSONNEL")) return "PE";
  if (label.includes("FACTURATION")) return "FA";
  if (label.includes("DOCUMENT")) return "DO";
  return null;
}

function isUselessInvoiceDetailLine(row) {
  const identifier = clean(row.Rubrique_Identifiant);
  const description = clean(row.Rubrique_Renseignement);
  const lineType = clean(row.TypeLigne);
  const text = description || identifier || "";
  const isDateSeparator = /^(total\s+)?date\s+du\s+\d{2}\/\d{2}\/\d{4}$/i.test(text.replace(/\s+/g, " ").trim());
  return isDateSeparator && !identifier && !lineType;
}

function dateYmd(value) {
  const text = clean(value);
  if (!text || !/^\d{8}$/.test(text)) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function timestamp(value) {
  const text = clean(value);
  if (!text) return null;
  return text.replace(" ", "T");
}

function hashObject(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function statusFromShipment(row) {
  if (bool(row.Souffrance)) return "dispute";
  const validation = clean(row.Code_validation_facture)?.toUpperCase();
  if (validation === "V" || clean(row.Date_facturation) || clean(row.Numero_Facture)) return "invoiced";
  return "open";
}

async function countRows(client, table) {
  const result = await client.query(`SELECT count(*)::int AS count FROM ${table}`);
  return result.rows[0].count;
}

async function queryHfsql(sql, onRow) {
  if (!hfsqlQueryCommand) throw new Error("HFSQL_QUERY_COMMAND non configure.");

  const child = spawn(hfsqlQueryCommand, [sql], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  let rows = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    rows += 1;
    await onRow(JSON.parse(line));
  }

  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  if (exitCode !== 0) {
    throw new Error(`Requete HFSQL en erreur (${exitCode}) : ${stderr.trim()}`);
  }
  return rows;
}

async function loadHfsql(sql) {
  const rows = [];
  await queryHfsql(sql, async (row) => rows.push(row));
  return rows;
}

async function insertMany(client, table, columns, rows, chunkSize = 500) {
  if (!rows.length) return 0;
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values = [];
    const placeholders = chunk.map((row, rowIndex) => {
      const base = rowIndex * columns.length;
      columns.forEach((column) => values.push(row[column]));
      return `(${columns.map((_, index) => `$${base + index + 1}`).join(", ")})`;
    });
    await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders.join(", ")}`,
      values,
    );
  }
  return rows.length;
}

async function getCompanyId(client) {
  const result = await client.query(
    "SELECT id FROM companies WHERE code = '998' OR name = 'SGA' ORDER BY CASE WHEN code = '998' THEN 0 ELSE 1 END, id LIMIT 1",
  );
  if (!result.rowCount) throw new Error("Societe SGA introuvable dans la base beta.");
  return result.rows[0].id;
}

async function ensureSyncSchema(client) {
  await client.query(`
    ALTER TABLE transport_shipments ADD COLUMN IF NOT EXISTS supplier_order_reference text;
    ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS login text;
    ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS smtp_server text;
    ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS smtp_port text;
    ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS mail_signature_html text;
    ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS mail_html_file text;
    ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS mail_password_configured boolean NOT NULL DEFAULT false;

    CREATE TABLE IF NOT EXISTS billing_invoices (
      id bigserial PRIMARY KEY,
      company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      customer_id bigint REFERENCES transport_customers(id) ON DELETE SET NULL,
      legacy_id text,
      legacy_agency_key text,
      invoice_number text NOT NULL,
      invoice_date date,
      due_date date,
      validation_code text,
      account_code text,
      customer_legacy_id text,
      customer_account_code text,
      customer_name text,
      payment_label text,
      product_code text,
      product_label text,
      is_credit_note boolean NOT NULL DEFAULT false,
      is_deposit boolean NOT NULL DEFAULT false,
      duplicate_of_legacy_id text,
      total_positions integer,
      total_parcels integer,
      total_weight numeric(14, 3),
      total_ht numeric(14, 2),
      total_vat numeric(14, 2),
      total_ttc numeric(14, 2),
      discount_rate numeric(8, 4),
      discount_amount numeric(14, 2),
      payment_date date,
      payment_text text,
      sent_to_client boolean NOT NULL DEFAULT false,
      fiscal_status text NOT NULL DEFAULT 'imported',
      fiscal_version integer NOT NULL DEFAULT 1,
      fiscal_source text NOT NULL DEFAULT 'windev_import',
      fiscal_hash text,
      previous_fiscal_hash text,
      sealed_at timestamptz,
      closed_at timestamptz,
      closure_period text,
      archived_at timestamptz,
      archive_batch_id text,
      certification_scope text NOT NULL DEFAULT 'preparation_anti_fraude_tva',
      source_payload_hash text,
      source_system text NOT NULL DEFAULT 'windev_hfsql',
      imported_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (company_id, legacy_id)
    );

    CREATE TABLE IF NOT EXISTS billing_invoice_lines (
      id bigserial PRIMARY KEY,
      invoice_id bigint NOT NULL REFERENCES billing_invoices(id) ON DELETE CASCADE,
      legacy_id text,
      legacy_invoice_id text,
      line_number integer,
      identifier text,
      description text,
      parcels integer,
      weight numeric(14, 3),
      amount numeric(14, 2),
      unit_price numeric(14, 2),
      product_code text,
      service_code text,
      discount_rate numeric(8, 4),
      vat_rate numeric(8, 4),
      discount_amount numeric(14, 2),
      vat_amount numeric(14, 2),
      amount_ttc numeric(14, 2),
      taxable_quantity numeric(14, 3),
      line_type text,
      is_bold boolean NOT NULL DEFAULT false,
      source_payload_hash text,
      source_system text NOT NULL DEFAULT 'windev_hfsql',
      imported_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (invoice_id, legacy_id)
    );

    CREATE TABLE IF NOT EXISTS billing_fiscal_events (
      id bigserial PRIMARY KEY,
      company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      invoice_id bigint REFERENCES billing_invoices(id) ON DELETE SET NULL,
      event_type text NOT NULL,
      event_at timestamptz NOT NULL DEFAULT now(),
      actor text NOT NULL DEFAULT 'system',
      fiscal_period text,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      previous_hash text,
      event_hash text NOT NULL,
      source_system text NOT NULL DEFAULT 'mytracking_beta',
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (company_id, event_hash)
    );

    CREATE TABLE IF NOT EXISTS billing_fiscal_closures (
      id bigserial PRIMARY KEY,
      company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      closure_type text NOT NULL,
      fiscal_period text NOT NULL,
      closed_at timestamptz NOT NULL DEFAULT now(),
      invoice_count integer NOT NULL DEFAULT 0,
      total_ht numeric(14, 2) NOT NULL DEFAULT 0,
      total_vat numeric(14, 2) NOT NULL DEFAULT 0,
      total_ttc numeric(14, 2) NOT NULL DEFAULT 0,
      previous_hash text,
      closure_hash text NOT NULL,
      archive_batch_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (company_id, closure_type, fiscal_period)
    );

    ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS sent_to_client boolean NOT NULL DEFAULT false;
    UPDATE billing_invoices SET sent_to_client = true WHERE invoice_date <= DATE '2026-06-30' AND sent_to_client = false;
    ALTER TABLE billing_invoices DROP CONSTRAINT IF EXISTS billing_invoices_company_id_invoice_number_key;
  `);
}

async function updateCompanyFromAgency(client, companyId) {
  const rows = await loadHfsql(`
    SELECT TOP 1 *
    FROM Agence
  `);
  const agency = rows[0];
  if (!agency) return false;
  const companyNotes = [
    clean(agency.responsableServiceCompta) ? `Responsable comptabilite: ${clean(agency.responsableServiceCompta)}` : null,
    clean(agency.TelResponsableCompta) ? `Tel comptabilite: ${clean(agency.TelResponsableCompta)}` : null,
    clean(agency.EmailServiceComptabilit) ? `Email comptabilite: ${clean(agency.EmailServiceComptabilit)}` : null,
    clean(agency.Texte_Accompagnement_ConfirmationAffretement)
      ? `Texte confirmation affretement:\n${clean(agency.Texte_Accompagnement_ConfirmationAffretement)}`
      : null,
  ].filter(Boolean).join("\n");
  await client.query(
    `
      UPDATE companies SET
        name = COALESCE($2, name),
        address1 = $3,
        address2 = $4,
        address3 = $5,
        country_code = $6,
        postal_code = $7,
        city = $8,
        phone = $9,
        fax = $10,
        email = $11,
        vat_number = $12,
        siret = $13,
        contact_name = $14,
        contact_email = $15,
        logo_url = $16,
        notes = $17,
        updated_at = now()
      WHERE id = $1
    `,
    [
      companyId,
      clean(agency.Nom),
      clean(agency.Adresse1),
      clean(agency.Adresse2),
      clean(agency.Adresse3),
      clean(agency.Code_Pays),
      clean(agency.Code_Postal),
      clean(agency.Ville),
      clean(agency.N_Tel),
      clean(agency.N_fax),
      clean(agency.E_mail),
      clean(agency.Identifiant_TVA),
      clean(agency.Siret),
      null,
      clean(agency.E_mail),
      "/assets/sga-agency-logo.jpg",
      companyNotes || null,
    ],
  );
  return true;
}

async function purgeBeta(client, companyId) {
  await client.query("DELETE FROM billing_invoice_lines WHERE invoice_id IN (SELECT id FROM billing_invoices WHERE company_id = $1)", [companyId]);
  await client.query("DELETE FROM billing_fiscal_events WHERE company_id = $1", [companyId]);
  await client.query("DELETE FROM billing_fiscal_closures WHERE company_id = $1", [companyId]);
  await client.query("DELETE FROM billing_invoices WHERE company_id = $1", [companyId]);
  await client.query("DELETE FROM transport_shipment_carrier_contacts WHERE shipment_id IN (SELECT id FROM transport_shipments WHERE company_id = $1)", [companyId]);
  await client.query("DELETE FROM transport_shipment_change_events WHERE shipment_id IN (SELECT id FROM transport_shipments WHERE company_id = $1)", [companyId]);
  await client.query("DELETE FROM transport_customer_senders WHERE customer_id IN (SELECT id FROM transport_customers WHERE company_id = $1)", [companyId]);
  await client.query("DELETE FROM transport_shipments WHERE company_id = $1", [companyId]);
  await client.query("DELETE FROM transport_carrier_contacts WHERE carrier_id IN (SELECT id FROM transport_carriers WHERE company_id = $1)", [companyId]);
  await client.query("DELETE FROM transport_carriers WHERE company_id = $1", [companyId]);
  await client.query("DELETE FROM transport_products WHERE company_id = $1", [companyId]);
  await client.query("DELETE FROM transport_customer_change_events WHERE customer_id IN (SELECT id FROM transport_customers WHERE company_id = $1)", [companyId]);
  await client.query("DELETE FROM transport_customers WHERE company_id = $1", [companyId]);
  await client.query("DELETE FROM staff_change_events WHERE staff_id IN (SELECT id FROM staff_members WHERE company_id = $1)", [companyId]);
  await client.query("DELETE FROM staff_members WHERE company_id = $1", [companyId]);
}

async function importStaff(client, companyId, expeditionCreators) {
  try {
    const source = await loadHfsql(`
      SELECT IDUtilisateur, cle_unique_agence, Nom_utilisateur, prenom_utilisateur, Cle_unique_utilisateur,
        Login, Email_contact, EmailFichierHtml, MotPasseMail, ServeurSmtp, PortServeur, Telephone, SignatureMailHTML
      FROM Utilisateur
    `);
    const rows = source
      .map((row) => {
        const firstName = clean(row.prenom_utilisateur) || clean(row.Login) || clean(row.Nom_utilisateur);
        const lastName = clean(row.Nom_utilisateur);
        const displayName = [firstName, lastName && lastName !== firstName ? lastName : null].filter(Boolean).join(" ");
        return {
          company_id: companyId,
          legacy_id: clean(row.IDUtilisateur) || clean(row.Cle_unique_utilisateur) || clean(row.Login) || displayName.toUpperCase(),
          first_name: firstName || displayName || "Utilisateur",
          last_name: lastName && lastName !== firstName ? lastName : null,
          display_name: displayName || firstName || lastName || clean(row.Login) || "Utilisateur",
          login: clean(row.Login),
          email: clean(row.Email_contact),
          phone: clean(row.Telephone),
          smtp_server: clean(row.ServeurSmtp),
          smtp_port: clean(row.PortServeur),
          mail_signature_html: clean(row.SignatureMailHTML),
          mail_html_file: clean(row.EmailFichierHtml),
          mail_password_configured: !!clean(row.MotPasseMail),
          role: "PERSONNEL",
          status: "active",
          notes: "Synchronise depuis Utilisateur WinDev. Mot de passe mail non affiche.",
          source_system: "windev_hfsql",
        };
      })
      .filter((row) => row.display_name);
    if (rows.length) return insertMany(client, "staff_members", Object.keys(rows[0]), rows);
  } catch (error) {
    console.warn(`Import Utilisateur indisponible, fallback createurs Expedition: ${error.message.split("\n")[0]}`);
  }

  const elodieSignatureHtml = `
    <table cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#3366ff;">
      <tr>
        <td style="padding:0 0 8px 0;">
          <img src="/assets/elodie-signature-logo.png" alt="SGA" width="263" height="81" style="display:block;width:263px;max-width:100%;height:auto;border:0;">
        </td>
      </tr>
      <tr>
        <td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.35;color:#3366ff;">
          <strong>Mme Elodie DE POLLA<br>Comptabilité<br>Port : 06.50.38.04.49</strong>
        </td>
      </tr>
    </table>
  `.trim();

  const knownStaff = [
    {
      legacy_id: "2023092716593436561",
      first_name: "Ali",
      last_name: "ELAOUFI",
      display_name: "Ali",
      login: "ALI",
      email: "ali@sga-groupe.fr",
      phone: "06.61.77.17.64",
      smtp_server: null,
      smtp_port: null,
      mail_signature_html: null,
      mail_html_file: null,
      mail_password_configured: false,
    },
    {
      legacy_id: "2023092716593436562",
      first_name: "Elodie",
      last_name: "DE POLLA",
      display_name: "Elodie",
      login: "ELO",
      email: "facture@sga-groupe.fr",
      phone: null,
      smtp_server: "mail48.lwspanel.com",
      smtp_port: "465",
      mail_signature_html: elodieSignatureHtml,
      mail_html_file: null,
      mail_password_configured: true,
    },
    {
      legacy_id: "2015101216591092411",
      first_name: "Loris",
      last_name: "NAVARRO",
      display_name: "Loris",
      login: "LORIS",
      email: "loris@sga-groupe.fr",
      phone: "07 64 19 10 17",
      smtp_server: null,
      smtp_port: null,
      mail_signature_html: null,
      mail_html_file: null,
      mail_password_configured: false,
    },
    {
      legacy_id: "2025102009502927002",
      first_name: "Loan",
      last_name: "PONS",
      display_name: "Loan",
      login: "LOAN",
      email: "loan@sga-groupe.fr",
      phone: "06.63.18.08.86",
      smtp_server: null,
      smtp_port: null,
      mail_signature_html: null,
      mail_html_file: null,
      mail_password_configured: false,
    },
  ];
  const rows = knownStaff.map((person) => ({
    company_id: companyId,
    ...person,
    role: "PERSONNEL",
    status: "active",
    notes: "Synchronise depuis les utilisateurs WinDev valides. Mot de passe mail non affiche.",
    source_system: "windev_hfsql",
  }));
  return insertMany(client, "staff_members", Object.keys(rows[0] || { company_id: 0 }), rows);
}

async function importProducts(client, companyId) {
  const source = await loadHfsql("SELECT IDProduit, code_produit, Libelle, ProduitAffretement FROM Produit");
  const rows = source.map((row) => ({
    company_id: companyId,
    legacy_id: clean(row.IDProduit),
    code: clean(row.code_produit) || clean(row.IDProduit),
    label: clean(row.Libelle) || clean(row.code_produit) || "Produit",
    is_chartering: bool(row.ProduitAffretement),
    source_system: "windev_hfsql",
  }));
  return insertMany(client, "transport_products", Object.keys(rows[0] || { company_id: 0 }), rows);
}

async function importCarriers(client, companyId) {
  const source = await loadHfsql("SELECT IDAffretes, Nom, Adresse1, Adresse2, Adresse3, Code_Pays, Code_Postal, Ville, Telephone, Fax, Email_contact, Identifiant_TVA, Siret, Contact, Notes FROM Affretes");
  const rows = source.map((row) => ({
    company_id: companyId,
    legacy_id: clean(row.IDAffretes),
    name: clean(row.Nom) || `Affrete ${clean(row.IDAffretes)}`,
    address1: clean(row.Adresse1),
    address2: clean(row.Adresse2),
    address3: clean(row.Adresse3),
    country_code: clean(row.Code_Pays),
    postal_code: clean(row.Code_Postal),
    city: clean(row.Ville),
    phone: clean(row.Telephone),
    fax: clean(row.Fax),
    email: clean(row.Email_contact),
    vat_number: clean(row.Identifiant_TVA),
    siret: clean(row.Siret),
    contact_name: clean(row.Contact),
    notes: clean(row.Notes),
    source_system: "windev_hfsql",
  }));
  await insertMany(client, "transport_carriers", Object.keys(rows[0] || { company_id: 0 }), rows);

  const ids = await client.query("SELECT id, legacy_id FROM transport_carriers WHERE company_id = $1", [companyId]);
  const byLegacy = new Map(ids.rows.map((row) => [row.legacy_id, row.id]));
  const contactSource = await loadHfsql("SELECT IDAffretes_Contact, IDAffretes, NomPrenom, Email_contact FROM Affretes_Contact");
  const contactRows = contactSource
    .map((row) => ({
      carrier_id: byLegacy.get(clean(row.IDAffretes)),
      legacy_id: clean(row.IDAffretes_Contact),
      display_name: clean(row.NomPrenom),
      email: clean(row.Email_contact),
      source_system: "windev_hfsql",
    }))
    .filter((row) => row.carrier_id && row.legacy_id);
  await insertMany(client, "transport_carrier_contacts", Object.keys(contactRows[0] || { carrier_id: 0 }), contactRows);
  return { carriers: rows.length, contacts: contactRows.length };
}

async function importCustomers(client, companyId) {
  const source = await loadHfsql(`
    SELECT IDClients, cle_unique_agence, code_clients, Nom_clients, Code_pays, Code_postal, Ville,
      adresse_1, adresse_2, adresse_3, Telephone, Num_fax, E_mail, Identifiant_TVA, Siret,
      contact, No_Mobile_contact, E_mail_contact, Nom_fac, Ad1_fac, Ad2_fac, Ad3_fac,
      Pays_fac, Cpostal_fac, Ville_fac, Tel_fac, Fax_fac, Email_fac, Code_reglement,
      compte_interdit, non_facturation_client
    FROM Clients
  `);
  const rows = source.map((row) => ({
    company_id: companyId,
    legacy_id: clean(row.IDClients),
    legacy_agency_key: clean(row.cle_unique_agence),
    code: clean(row.code_clients),
    name: clean(row.Nom_clients) || clean(row.code_clients) || "Client",
    status: bool(row.compte_interdit) ? "blocked" : "active",
    address1: clean(row.adresse_1),
    address2: clean(row.adresse_2),
    address3: clean(row.adresse_3),
    country_code: clean(row.Code_pays),
    postal_code: clean(row.Code_postal),
    city: clean(row.Ville),
    phone: clean(row.Telephone),
    fax: clean(row.Num_fax),
    email: clean(row.E_mail),
    vat_number: clean(row.Identifiant_TVA),
    siret: clean(row.Siret),
    contact_name: clean(row.contact),
    contact_mobile: clean(row.No_Mobile_contact),
    contact_email: clean(row.E_mail_contact),
    billing_name: clean(row.Nom_fac),
    billing_address1: clean(row.Ad1_fac),
    billing_address2: clean(row.Ad2_fac),
    billing_address3: clean(row.Ad3_fac),
    billing_country_code: clean(row.Pays_fac),
    billing_postal_code: clean(row.Cpostal_fac),
    billing_city: clean(row.Ville_fac),
    billing_phone: clean(row.Tel_fac),
    billing_fax: clean(row.Fax_fac),
    billing_email: clean(row.Email_fac),
    payment_code: clean(row.Code_reglement),
    is_blocked: bool(row.compte_interdit),
    no_billing: bool(row.non_facturation_client),
    notes: null,
    source_system: "windev_hfsql",
  })).filter((row) => row.code);
  return insertMany(client, "transport_customers", Object.keys(rows[0] || { company_id: 0 }), rows);
}

async function importShipments(client, companyId) {
  const customers = await client.query("SELECT id, code FROM transport_customers WHERE company_id = $1", [companyId]);
  const customerByCode = new Map(customers.rows.map((row) => [row.code, row.id]));
  const carrierIds = await client.query("SELECT id, legacy_id FROM transport_carriers WHERE company_id = $1", [companyId]);
  const carrierByLegacy = new Map(carrierIds.rows.map((row) => [row.legacy_id, row.id]));

  const source = await loadHfsql(`
    SELECT IDExpedition, cle_unique_agence, Recepisse, Type_expedition, Port, Code_expediteur,
      Compte_payeur, Nom_expediteur, Adresse1_exp, Adresse2_exp, Adresse3_exp, Pays_exp,
      Code_postal_exp, ville_exp, Tel_expediteur, Nom_destinataire, Adresse1_des, Adresse2_des,
      Adresse3_des, Pays_des, Code_postal_des, Ville_des, tel_des, e_mail_des, Colis, Poids,
      volume, Nature_marchandise, Valeur_declaree, Code_produit, date_depart, date_arrivage,
      date_ramasse, Date_imperative_liv, Date_Livraison_Estimee, Date_facturation, Numero_Facture,
      Code_validation_facture, Montant_transport, montant_tva, PrixConvenu, Prix_de_vente,
      montant_sst, cremb, code_routage, reference_edi, commande,
      Code_barre_unique, Souffrance, ExpeditionEnAfrretement, IDAffretes, DateCreation,
      CreerPar, Observations
    FROM Expedition
  `);

  const creatorNames = new Set();
  const rows = source.map((row) => {
    const creator = clean(row.CreerPar);
    if (creator) creatorNames.add(creator);
    const customerCode = clean(row.Code_expediteur);
    const payerCode = clean(row.Compte_payeur) || customerCode;
    return {
      company_id: companyId,
      customer_id: customerByCode.get(customerCode) || null,
      payer_customer_id: customerByCode.get(payerCode) || null,
      legacy_id: clean(row.IDExpedition),
      legacy_agency_key: clean(row.cle_unique_agence),
      receipt_no: clean(row.Recepisse) || clean(row.IDExpedition),
      shipment_type: integer(row.Type_expedition),
      port_type: integer(row.Port),
      customer_code: customerCode,
      payer_code: payerCode,
      sender_name: clean(row.Nom_expediteur),
      sender_address1: clean(row.Adresse1_exp),
      sender_address2: clean(row.Adresse2_exp),
      sender_address3: clean(row.Adresse3_exp),
      sender_country_code: clean(row.Pays_exp),
      sender_postal_code: clean(row.Code_postal_exp),
      sender_city: clean(row.ville_exp),
      sender_phone: clean(row.Tel_expediteur),
      recipient_name: clean(row.Nom_destinataire),
      recipient_address1: clean(row.Adresse1_des),
      recipient_address2: clean(row.Adresse2_des),
      recipient_address3: clean(row.Adresse3_des),
      recipient_country_code: clean(row.Pays_des),
      recipient_postal_code: clean(row.Code_postal_des),
      recipient_city: clean(row.Ville_des),
      recipient_phone: clean(row.tel_des),
      recipient_email: clean(row.e_mail_des),
      parcels: integer(row.Colis),
      weight: decimal(row.Poids),
      volume: decimal(row.volume),
      goods_nature: clean(row.Nature_marchandise),
      declared_value: moneyAmount(row.Valeur_declaree),
      product_code: clean(row.Code_produit),
      product_name: null,
      carrier_code: clean(row.IDAffretes),
      carrier_legacy_id: clean(row.IDAffretes),
      carrier_name: null,
      departure_date: dateYmd(row.date_depart),
      arrival_date: dateYmd(row.date_arrivage),
      pickup_date: dateYmd(row.date_ramasse),
      requested_delivery_date: dateYmd(row.Date_imperative_liv),
      estimated_delivery_date: dateYmd(row.Date_Livraison_Estimee),
      invoice_date: dateYmd(row.Date_facturation),
      invoice_number: clean(row.Numero_Facture),
      invoice_validation_code: clean(row.Code_validation_facture),
      transport_amount: moneyAmount(row.Montant_transport),
      vat_amount: moneyAmount(row.montant_tva),
      agreed_price: moneyAmount(row.PrixConvenu),
      sale_price: moneyAmount(row.Prix_de_vente) || moneyAmount(row.Montant_transport),
      subcontract_amount: moneyAmount(row.montant_sst) || moneyAmount(row.PrixConvenu),
      cash_on_delivery: moneyAmount(row.cremb),
      route_code: clean(row.code_routage),
      pickup_route_code: null,
      delivery_route_code: null,
      edi_reference: clean(row.reference_edi),
      order_reference: clean(row.reference_edi),
      supplier_order_reference: clean(row.commande),
      barcode: clean(row.Code_barre_unique),
      status: statusFromShipment(row),
      is_closed: false,
      is_dispute: bool(row.Souffrance),
      is_chartering: bool(row.ExpeditionEnAfrretement),
      notes: clean(row.Observations),
      legacy_created_at: timestamp(row.DateCreation),
      legacy_created_by: creator,
      source_system: "windev_hfsql",
    };
  });

  await insertMany(client, "transport_shipments", Object.keys(rows[0] || { company_id: 0 }), rows, 250);

  const shipments = await client.query("SELECT id, legacy_id, carrier_legacy_id FROM transport_shipments WHERE company_id = $1", [companyId]);
  const links = shipments.rows
    .filter((row) => row.carrier_legacy_id && carrierByLegacy.has(row.carrier_legacy_id))
    .map((row) => ({
      shipment_id: row.id,
      carrier_contact_id: null,
      legacy_id: `carrier:${row.carrier_legacy_id}`,
      source_system: "windev_hfsql",
    }));
  await insertMany(client, "transport_shipment_carrier_contacts", Object.keys(links[0] || { shipment_id: 0 }), links);

  return { shipments: rows.length, shipmentCarrierLinks: links.length, creatorNames: [...creatorNames] };
}

async function importInvoices(client, companyId) {
  const customers = await client.query("SELECT id, legacy_id, code FROM transport_customers WHERE company_id = $1", [companyId]);
  const customerByLegacy = new Map(customers.rows.map((row) => [row.legacy_id, row.id]));
  const customerByCode = new Map(customers.rows.map((row) => [row.code, row.id]));

  const source = await loadHfsql(`
    SELECT IDFacture_Entete, cle_unique_agence, Numero_Facture, Date_facturation, Code_validation,
      IDClients, Compte_facture, Nom_client, Libelle_Regelement, Date_echeance,
      Total_HT, Tableau_Tva, Total_Ttc, Total_Pos, Total_Poids, Total_colis,
      Code_produit, Libelle_Produit, Avoir, Acompte, IDentete_duplicata,
      DateReglementFacture, LibelleReglementFacture, Remise, MontantRemise
    FROM Facture_Entete
  `);

  const sorted = source.slice().sort((a, b) => {
    const left = `${clean(a.Date_facturation) || ""}|${clean(a.Numero_Facture) || ""}|${clean(a.IDFacture_Entete) || ""}`;
    const right = `${clean(b.Date_facturation) || ""}|${clean(b.Numero_Facture) || ""}|${clean(b.IDFacture_Entete) || ""}`;
    return left.localeCompare(right);
  });

  let previousHash = null;
  const invoiceRows = sorted.map((row) => {
    const legacyId = clean(row.IDFacture_Entete);
    const payload = {
      legacyId,
      invoiceNumber: clean(row.Numero_Facture),
      invoiceDate: dateYmd(row.Date_facturation),
      customerName: clean(row.Nom_client),
      totalHt: moneyAmount(row.Total_HT),
      totalVat: moneyAmount(row.Tableau_Tva),
      totalTtc: moneyAmount(row.Total_Ttc),
      validationCode: clean(row.Code_validation),
    };
    const sourceHash = hashObject(row);
    const fiscalHash = hashObject({ ...payload, sourceHash, previousHash });
    const invoice = {
      company_id: companyId,
      customer_id: customerByLegacy.get(clean(row.IDClients)) || customerByCode.get(clean(row.Compte_facture)) || null,
      legacy_id: legacyId,
      legacy_agency_key: clean(row.cle_unique_agence),
      invoice_number: clean(row.Numero_Facture) || legacyId,
      invoice_date: dateYmd(row.Date_facturation),
      due_date: dateYmd(row.Date_echeance),
      validation_code: clean(row.Code_validation),
      account_code: clean(row.Compte_facture),
      customer_legacy_id: clean(row.IDClients),
      customer_account_code: clean(row.Compte_facture),
      customer_name: clean(row.Nom_client),
      payment_label: clean(row.Libelle_Regelement),
      product_code: productCodeFromInvoice(row),
      product_label: clean(row.Libelle_Produit),
      is_credit_note: bool(row.Avoir),
      is_deposit: bool(row.Acompte),
      duplicate_of_legacy_id: clean(row.IDentete_duplicata),
      total_positions: integer(row.Total_Pos),
      total_parcels: integer(row.Total_colis),
      total_weight: decimal(row.Total_Poids),
      total_ht: moneyAmount(row.Total_HT),
      total_vat: moneyAmount(row.Tableau_Tva),
      total_ttc: moneyAmount(row.Total_Ttc),
      discount_rate: decimal(row.Remise),
      discount_amount: moneyAmount(row.MontantRemise),
      payment_date: dateYmd(row.DateReglementFacture),
      payment_text: clean(row.LibelleReglementFacture),
      sent_to_client: Boolean(dateYmd(row.Date_facturation) && dateYmd(row.Date_facturation) <= "2026-06-30"),
      fiscal_status: clean(row.Code_validation) === "V" ? "sealed_import" : "imported",
      fiscal_version: 1,
      fiscal_source: "windev_import",
      fiscal_hash: fiscalHash,
      previous_fiscal_hash: previousHash,
      sealed_at: clean(row.Code_validation) === "V" ? new Date().toISOString() : null,
      closed_at: null,
      closure_period: null,
      archived_at: null,
      archive_batch_id: null,
      certification_scope: "preparation_anti_fraude_tva",
      source_payload_hash: sourceHash,
      source_system: "windev_hfsql",
    };
    previousHash = fiscalHash;
    return invoice;
  });

  await insertMany(client, "billing_invoices", Object.keys(invoiceRows[0] || { company_id: 0 }), invoiceRows, 250);

  const invoices = await client.query("SELECT id, legacy_id FROM billing_invoices WHERE company_id = $1", [companyId]);
  const invoiceByLegacy = new Map(invoices.rows.map((row) => [row.legacy_id, row.id]));

  const detailSource = await loadHfsql(`
    SELECT IDFacture_Detail, IDFacture_Entete, Numero_Ligne, Rubrique_Identifiant,
      Rubrique_Renseignement, Colis, Poids, Montant, PoliceGras, Code_produit, PU,
      CodePresta, Remise, TauxTVA, MontantRemise, MontantTVA, MontantTTC, QTTAX, TypeLigne
    FROM Facture_Detail
  `);
  const lineRows = detailSource
    .filter((row) => !isUselessInvoiceDetailLine(row))
    .map((row) => ({
      invoice_id: invoiceByLegacy.get(clean(row.IDFacture_Entete)),
      legacy_id: clean(row.IDFacture_Detail),
      legacy_invoice_id: clean(row.IDFacture_Entete),
      line_number: integer(row.Numero_Ligne),
      identifier: clean(row.Rubrique_Identifiant),
      description: clean(row.Rubrique_Renseignement),
      parcels: integer(row.Colis),
      weight: decimal(row.Poids),
      amount: moneyAmount(row.Montant),
      unit_price: moneyAmount(row.PU),
      product_code: clean(row.Code_produit)?.toUpperCase(),
      service_code: clean(row.CodePresta),
      discount_rate: decimal(row.Remise),
      vat_rate: decimal(row.TauxTVA),
      discount_amount: moneyAmount(row.MontantRemise),
      vat_amount: moneyAmount(row.MontantTVA),
      amount_ttc: moneyAmount(row.MontantTTC),
      taxable_quantity: decimal(row.QTTAX),
      line_type: clean(row.TypeLigne),
      is_bold: bool(row.PoliceGras),
      source_payload_hash: hashObject(row),
      source_system: "windev_hfsql",
    }))
    .filter((row) => row.invoice_id);

  await insertMany(client, "billing_invoice_lines", Object.keys(lineRows[0] || { invoice_id: 0 }), lineRows, 500);

  const lastHash = previousHash;
  if (lastHash) {
    const eventPayload = {
      importedInvoices: invoiceRows.length,
      importedLines: lineRows.length,
      lastHash,
      scope: "windev_import_snapshot",
    };
    await client.query(
      `INSERT INTO billing_fiscal_events (company_id, event_type, actor, payload, previous_hash, event_hash)
       VALUES ($1, 'windev_import_snapshot', 'system', $2::jsonb, $3, $4)
       ON CONFLICT (company_id, event_hash) DO NOTHING`,
      [companyId, JSON.stringify(eventPayload), null, hashObject(eventPayload)],
    );
  }

  return { invoices: invoiceRows.length, lines: lineRows.length };
}

async function rebuildCustomerSenders(client, companyId) {
  const result = await client.query(`
    INSERT INTO transport_customer_senders (
      customer_id, source_key, name, address1, address2, address3, country_code,
      postal_code, city, phone, shipment_count, last_used_at, source_system
    )
    SELECT
      customer_id,
      md5(customer_id::text || '|' || coalesce(sender_name, '') || '|' || coalesce(sender_address1, '') || '|' ||
        coalesce(sender_address2, '') || '|' || coalesce(sender_address3, '') || '|' || coalesce(sender_country_code, '') || '|' ||
        coalesce(sender_postal_code, '') || '|' || coalesce(sender_city, '') || '|' || coalesce(sender_phone, '')) AS source_key,
      max(sender_name), max(sender_address1), max(sender_address2), max(sender_address3), max(sender_country_code),
      max(sender_postal_code), max(sender_city), max(sender_phone), count(*)::int, max(departure_date), 'shipments_derived'
    FROM transport_shipments
    WHERE company_id = $1
      AND customer_id IS NOT NULL
      AND (sender_name IS NOT NULL OR sender_address1 IS NOT NULL OR sender_postal_code IS NOT NULL OR sender_city IS NOT NULL)
    GROUP BY customer_id, coalesce(sender_name, ''), coalesce(sender_address1, ''), coalesce(sender_address2, ''),
      coalesce(sender_address3, ''), coalesce(sender_country_code, ''), coalesce(sender_postal_code, ''), coalesce(sender_city, ''),
      coalesce(sender_phone, '')
  `, [companyId]);
  return result.rowCount;
}

async function main() {
  if (!pool) throw new Error("DATABASE_URL non configure.");

  const client = await pool.connect();
  try {
    await ensureSyncSchema(client);
    const before = {};
    for (const table of tableNames) before[table] = await countRows(client, table);

    console.log("Synchronisation WinDev -> beta");
    console.log(`Périmètre: ${scope.join(", ")}`);
    console.log(`Comptages beta avant purge: ${JSON.stringify(before)}`);

    const sourceCheck = await loadHfsql("SELECT COUNT(*) AS Clients FROM Clients");
    console.log(`Controle source HFSQL: Clients=${sourceCheck[0]?.Clients || "?"}`);

    await client.query("BEGIN");
    const companyId = await getCompanyId(client);
    const agencyUpdated = await updateCompanyFromAgency(client, companyId);
    await purgeBeta(client, companyId);

    const products = await importProducts(client, companyId);
    const carrierResult = await importCarriers(client, companyId);
    const customers = await importCustomers(client, companyId);
    const shipmentResult = await importShipments(client, companyId);
    const invoiceResult = await importInvoices(client, companyId);
    const staff = await importStaff(client, companyId, shipmentResult.creatorNames);
    const senders = await rebuildCustomerSenders(client, companyId);

    await client.query("COMMIT");

    const after = {};
    for (const table of tableNames) after[table] = await countRows(client, table);

    console.log(`Import produits: ${products}`);
    console.log(`Fiche societe/agence mise a jour: ${agencyUpdated ? "oui" : "non"}`);
    console.log(`Import affretes: ${carrierResult.carriers}`);
    console.log(`Import contacts affretes: ${carrierResult.contacts}`);
    console.log(`Import clients: ${customers}`);
    console.log(`Import expeditions: ${shipmentResult.shipments}`);
    console.log(`Liens expedition-affrete: ${shipmentResult.shipmentCarrierLinks}`);
    console.log(`Import factures: ${invoiceResult.invoices}`);
    console.log(`Import lignes factures: ${invoiceResult.lines}`);
    console.log(`Import personnel: ${staff}`);
    console.log(`Expediteurs client reconstruits: ${senders}`);
    console.log(`Comptages beta apres import: ${JSON.stringify(after)}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(2);
});
