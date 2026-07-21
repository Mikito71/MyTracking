const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const http = require("http");
const tls = require("tls");
const path = require("path");
const querystring = require("querystring");
const os = require("os");
const { exec, execFile } = require("child_process");
const { Pool } = require("pg");

const port = Number(process.env.ADMIN_AUTH_PORT || 3200);
const adminEmail = process.env.ADMIN_EMAIL || "";
const passwordHash = process.env.ADMIN_PASSWORD_SHA256 || "";
const clientPasswordHash = process.env.CLIENT_PASSWORD_SHA256 || "";
const sessionSecret = process.env.ADMIN_SESSION_SECRET || "";
const staticRoot = process.env.ADMIN_STATIC_ROOT || "/static";
const databaseUrl = process.env.DATABASE_URL || "";
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const clientSessionStartedAt = Date.now();
const clientAuthGenerationCache = { checkedAt: 0, value: clientSessionStartedAt };
let schemaReady;
let customerSchemaReady;
let staffSchemaReady;
let shipmentSchemaReady;
let billingSchemaReady;
let senderSchemaReady;
let syncSchemaReady;
let activeWindevSync = null;

function fetchJson(url, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Accept: "application/json", "User-Agent": "MyTracking-beta/1.0" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Request timeout")));
    request.on("error", reject);
  });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("hex");
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
      }),
  );
}

function isAuthenticated(req) {
  const token = parseCookies(req).mt_admin;
  if (!token || !sessionSecret) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = sign(payload);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function isClientAuthenticated(req) {
  const token = parseCookies(req).mt_client;
  if (!token || !sessionSecret) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = sign(payload);
  if (expected.length !== signature.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(session.ts || 0) >= clientAuthGeneration();
  } catch (error) {
    return false;
  }
}

function clientSessionFromRequest(req) {
  const token = parseCookies(req).mt_client;
  if (!token || !sessionSecret) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (expected.length !== signature.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (Number(session.ts || 0) < clientAuthGeneration()) return null;
    return session;
  } catch (error) {
    return null;
  }
}

function clientAuthGeneration() {
  const now = Date.now();
  if (now - clientAuthGenerationCache.checkedAt < 5000) return clientAuthGenerationCache.value;
  let generation = clientSessionStartedAt;
  try {
    for (const name of fs.readdirSync(staticRoot)) {
      if (name === "login-client.html" || name === ".client-auth-generation" || /^client-[^/]+\.html$/.test(name)) {
        generation = Math.max(generation, fs.statSync(path.join(staticRoot, name)).mtimeMs);
      }
    }
  } catch (error) {
    generation = clientSessionStartedAt;
  }
  clientAuthGenerationCache.checkedAt = now;
  clientAuthGenerationCache.value = generation;
  return generation;
}

function send(res, status, body, contentType = "text/html; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

function sendHead(res, status, contentType = "text/html; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end();
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10000) req.destroy();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function readJsonBody(req) {
  return readBody(req).then((body) => {
    if (!body) return {};
    try {
      return JSON.parse(body);
    } catch (error) {
      return { __invalidJson: true };
    }
  });
}

function sendJson(res, status, body) {
  send(res, status, JSON.stringify(body), "application/json; charset=utf-8");
}

function contentTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "text/html; charset=utf-8";
}

function normalizeText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function isValidEmail(value) {
  const text = String(value || "").trim();
  if ((text.match(/@/g) || []).length !== 1) return false;
  if (/[<>,;:'"()\\]/.test(text)) return false;
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(text);
}

function invoiceRecipientEmails(...values) {
  const seen = new Set();
  return values
    .flatMap((value) => String(value || "").split(/[;, \n\r\t]+/))
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((email) => ({ email, isValid: isValidEmail(email) }));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function moneyFr(value) {
  return Number(value || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function canonicalStaffEmail(value) {
  const text = normalizeText(value);
  if (!text) return null;
  return text.replace(/@sga-group\.fr$/i, "@sga-groupe.fr");
}

function encryptionKey() {
  if (!sessionSecret) throw new Error("Secret de chiffrement serveur non configure.");
  return crypto.createHash("sha256").update(sessionSecret, "utf8").digest();
}

function encryptSecret(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptSecret(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const [version, ivText, tagText, encryptedText] = text.split(":");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) return null;
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function normalizeRequired(value) {
  return String(value || "").trim();
}

function normalizeLegacyId(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!/^\d+$/.test(text)) return null;
  return text;
}

function normalizeBoolean(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateOnly(date);
}

function addMonths(value, months) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return formatDateOnly(date);
}

function dateParts(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), date: date.getUTCDate(), day: date.getUTCDay() };
}

function dateOnlyFromParts(year, month, date = 1) {
  return formatDateOnly(new Date(Date.UTC(year, month, date)));
}

function startOfMonth(value) {
  const parts = dateParts(value);
  return dateOnlyFromParts(parts.year, parts.month, 1);
}

function endOfMonth(value) {
  const parts = dateParts(value);
  return dateOnlyFromParts(parts.year, parts.month + 1, 0);
}

function startOfYear(value) {
  return dateOnlyFromParts(dateParts(value).year, 0, 1);
}

function endOfYear(value) {
  return dateOnlyFromParts(dateParts(value).year, 11, 31);
}

function startOfWeek(value) {
  const parts = dateParts(value);
  const mondayOffset = parts.day === 0 ? -6 : 1 - parts.day;
  return addDays(value, mondayOffset);
}

function endOfWeek(value) {
  return addDays(startOfWeek(value), 6);
}

function daysBetweenInclusive(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function startOfCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayDateOnly() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function normalizeDateOnly(value) {
  const text = normalizeText(value);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function analyticsRange(url) {
  const period = normalizeText(url.searchParams.get("period")) || "custom";
  const dateFrom = normalizeDateOnly(url.searchParams.get("dateFrom")) || startOfCurrentMonth();
  const dateTo = normalizeDateOnly(url.searchParams.get("dateTo")) || todayDateOnly();
  const from = dateFrom <= dateTo ? dateFrom : dateTo;
  const to = dateFrom <= dateTo ? dateTo : dateFrom;
  if (period === "current_month" || period === "last_month") {
    const currentFrom = startOfMonth(from);
    const currentTo = endOfMonth(from);
    const previousFrom = startOfMonth(addMonths(currentFrom, -1));
    return { dateFrom: currentFrom, dateTo: currentTo, previousFrom, previousTo: endOfMonth(previousFrom), period };
  }
  if (period === "current_year") {
    const currentFrom = startOfYear(from);
    const currentTo = endOfYear(from);
    const previousFrom = dateOnlyFromParts(dateParts(currentFrom).year - 1, 0, 1);
    return { dateFrom: currentFrom, dateTo: currentTo, previousFrom, previousTo: endOfYear(previousFrom), period };
  }
  if (period === "current_week" || period === "last_week") {
    const currentFrom = startOfWeek(from);
    const currentTo = endOfWeek(from);
    const previousFrom = addDays(currentFrom, -7);
    return { dateFrom: currentFrom, dateTo: currentTo, previousFrom, previousTo: addDays(currentFrom, -1), period };
  }
  const span = daysBetweenInclusive(from, to);
  const previousTo = addDays(from, -1);
  const previousFrom = addDays(previousTo, 1 - span);
  return { dateFrom: from, dateTo: to, previousFrom, previousTo, period };
}

function analyticsPeriodBuckets(range, count = 6) {
  if (range.period === "current_month" || range.period === "last_month") {
    const buckets = [];
    let dateFrom = startOfMonth(range.dateFrom);
    for (let index = count - 1; index >= 0; index -= 1) {
      const bucketFrom = addMonths(dateFrom, -index);
      const bucketTo = endOfMonth(bucketFrom);
      buckets.push({ index: count - 1 - index, dateFrom: bucketFrom, dateTo: bucketTo, label: new Date(`${bucketFrom}T00:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) });
    }
    return buckets;
  }
  if (range.period === "current_year") {
    const buckets = [];
    const year = dateParts(range.dateFrom).year;
    for (let index = count - 1; index >= 0; index -= 1) {
      const bucketFrom = dateOnlyFromParts(year - index, 0, 1);
      buckets.push({ index: count - 1 - index, dateFrom: bucketFrom, dateTo: endOfYear(bucketFrom), label: String(year - index) });
    }
    return buckets;
  }
  if (range.period === "current_week" || range.period === "last_week") {
    const buckets = [];
    let dateFrom = startOfWeek(range.dateFrom);
    for (let index = count - 1; index >= 0; index -= 1) {
      const bucketFrom = addDays(dateFrom, -7 * index);
      const bucketTo = addDays(bucketFrom, 6);
      buckets.push({ index: count - 1 - index, dateFrom: bucketFrom, dateTo: bucketTo, label: `${new Date(`${bucketFrom}T00:00:00Z`).toLocaleDateString("fr-FR")} - ${new Date(`${bucketTo}T00:00:00Z`).toLocaleDateString("fr-FR")}` });
    }
    return buckets;
  }
  const span = daysBetweenInclusive(range.dateFrom, range.dateTo);
  const buckets = [];
  let dateTo = range.dateTo;
  for (let index = count - 1; index >= 0; index -= 1) {
    const dateFrom = addDays(dateTo, 1 - span);
    buckets.unshift({
      index,
      dateFrom,
      dateTo,
      label: span === 1 ? new Date(`${dateTo}T00:00:00Z`).toLocaleDateString("fr-FR") : `${new Date(`${dateFrom}T00:00:00Z`).toLocaleDateString("fr-FR")} - ${new Date(`${dateTo}T00:00:00Z`).toLocaleDateString("fr-FR")}`,
    });
    dateTo = addDays(dateFrom, -1);
  }
  return buckets;
}

function moneyNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function actorFromRequest(req, body = {}) {
  return normalizeText(body.changedBy) || normalizeText(body.actor) || normalizeText(req.headers["x-mytracking-user"]) || "Utilisateur client beta";
}

async function ensureCompanySchema() {
  if (!pool) throw new Error("Database is not configured.");
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id bigserial PRIMARY KEY,
        legacy_id bigint UNIQUE,
        name text NOT NULL,
        code text UNIQUE NOT NULL,
        address1 text,
        address2 text,
        address3 text,
        country_code text,
        postal_code text,
        city text,
        phone text,
        fax text,
        email text,
        source_system text NOT NULL DEFAULT 'manual_admin',
        imported_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      ALTER TABLE companies ADD COLUMN IF NOT EXISTS siret text;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS vat_number text;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_name text;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_email text;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS notes text;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url text;
    `);
  }
  await schemaReady;
}

async function ensureCustomerSchema() {
  if (!pool) throw new Error("Database is not configured.");
  if (!customerSchemaReady) {
    customerSchemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS transport_customers (
        id bigserial PRIMARY KEY,
        company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        legacy_id text,
        legacy_agency_key text,
        code text NOT NULL,
        name text NOT NULL,
        status text NOT NULL DEFAULT 'active',
        address1 text,
        address2 text,
        address3 text,
        country_code text,
        postal_code text,
        city text,
        phone text,
        fax text,
        email text,
        vat_number text,
        siret text,
        contact_name text,
        contact_mobile text,
        contact_email text,
        billing_name text,
        billing_address1 text,
        billing_address2 text,
        billing_address3 text,
        billing_country_code text,
        billing_postal_code text,
        billing_city text,
        billing_phone text,
        billing_fax text,
        billing_email text,
        payment_code text,
        is_blocked boolean NOT NULL DEFAULT false,
        no_billing boolean NOT NULL DEFAULT false,
        notes text,
        source_system text NOT NULL DEFAULT 'manual_client',
        imported_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, legacy_id),
        UNIQUE (company_id, code)
      );

      CREATE TABLE IF NOT EXISTS transport_customer_change_events (
        id bigserial PRIMARY KEY,
        customer_id bigint NOT NULL REFERENCES transport_customers(id) ON DELETE CASCADE,
        changed_at timestamptz NOT NULL DEFAULT now(),
        changed_by text NOT NULL,
        action text NOT NULL,
        changes jsonb NOT NULL DEFAULT '{}'::jsonb
      );
    `);
  }
  await customerSchemaReady;
}

async function ensureStaffSchema() {
  if (!pool) throw new Error("Database is not configured.");
  if (!staffSchemaReady) {
    staffSchemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS staff_members (
        id bigserial PRIMARY KEY,
        company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        legacy_id text,
        first_name text NOT NULL,
        last_name text,
        display_name text NOT NULL,
        login text,
        email text,
        phone text,
        smtp_server text,
        smtp_port text,
        mail_signature_html text,
        mail_html_file text,
        mail_password_encrypted text,
        mail_password_configured boolean NOT NULL DEFAULT false,
        role text NOT NULL DEFAULT 'PERSONNEL',
        status text NOT NULL DEFAULT 'active',
        notes text,
        source_system text NOT NULL DEFAULT 'manual_request',
        imported_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, display_name)
      );

      CREATE TABLE IF NOT EXISTS staff_change_events (
        id bigserial PRIMARY KEY,
        staff_id bigint NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
        changed_at timestamptz NOT NULL DEFAULT now(),
        changed_by text NOT NULL,
        action text NOT NULL,
        changes jsonb NOT NULL DEFAULT '{}'::jsonb
      );

      ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS login text;
      ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS smtp_server text;
      ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS smtp_port text;
      ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS mail_signature_html text;
      ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS mail_html_file text;
      ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS mail_password_encrypted text;
      ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS mail_password_configured boolean NOT NULL DEFAULT false;
    `);
  }
  await staffSchemaReady;
}

async function ensureShipmentSchema() {
  if (!pool) throw new Error("Database is not configured.");
  await ensureStaffSchema();
  if (!shipmentSchemaReady) {
    shipmentSchemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS transport_shipments (
        id bigserial PRIMARY KEY,
        company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        customer_id bigint REFERENCES transport_customers(id) ON DELETE SET NULL,
        payer_customer_id bigint REFERENCES transport_customers(id) ON DELETE SET NULL,
        legacy_id text,
        legacy_agency_key text,
        receipt_no text NOT NULL,
        shipment_type integer,
        port_type integer,
        customer_code text,
        payer_code text,
        sender_name text,
        sender_address1 text,
        sender_address2 text,
        sender_address3 text,
        sender_country_code text,
        sender_postal_code text,
        sender_city text,
        sender_phone text,
        recipient_name text,
        recipient_address1 text,
        recipient_address2 text,
        recipient_address3 text,
        recipient_country_code text,
        recipient_postal_code text,
        recipient_city text,
        recipient_phone text,
        recipient_email text,
        parcels integer,
        weight numeric(12, 2),
        volume numeric(12, 3),
        goods_nature text,
        declared_value numeric(12, 2),
        product_code text,
        product_name text,
        carrier_code text,
        carrier_legacy_id text,
        carrier_name text,
        departure_date date,
        arrival_date date,
        pickup_date date,
        requested_delivery_date date,
        estimated_delivery_date date,
        invoice_date date,
        invoice_number text,
        invoice_validation_code text,
        transport_amount numeric(12, 2),
        vat_amount numeric(12, 2),
        agreed_price numeric(12, 2),
        sale_price numeric(12, 2),
        subcontract_amount numeric(12, 2),
        cash_on_delivery numeric(12, 2),
        route_code text,
        pickup_route_code text,
        delivery_route_code text,
        edi_reference text,
        order_reference text,
        supplier_order_reference text,
        barcode text,
        status text NOT NULL DEFAULT 'open',
        is_closed boolean NOT NULL DEFAULT false,
        is_dispute boolean NOT NULL DEFAULT false,
        is_chartering boolean NOT NULL DEFAULT false,
        notes text,
        legacy_created_at timestamptz,
        legacy_created_by text,
        source_system text NOT NULL DEFAULT 'manual_client',
        imported_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, legacy_id),
        UNIQUE (company_id, receipt_no)
      );

      CREATE TABLE IF NOT EXISTS transport_shipment_change_events (
        id bigserial PRIMARY KEY,
        shipment_id bigint NOT NULL REFERENCES transport_shipments(id) ON DELETE CASCADE,
        changed_at timestamptz NOT NULL DEFAULT now(),
        changed_by text NOT NULL,
        action text NOT NULL,
        changes jsonb NOT NULL DEFAULT '{}'::jsonb
      );

      CREATE TABLE IF NOT EXISTS transport_document_mail_dispatches (
        id bigserial PRIMARY KEY,
        shipment_id bigint NOT NULL REFERENCES transport_shipments(id) ON DELETE CASCADE,
        staff_id bigint REFERENCES staff_members(id) ON DELETE SET NULL,
        document_type text NOT NULL,
        recipient_email text NOT NULL,
        cc_email text,
        subject text NOT NULL,
        body_html text NOT NULL,
        attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
        status text NOT NULL DEFAULT 'prepared',
        technical_message text,
        created_by text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS transport_products (
        id bigserial PRIMARY KEY,
        company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        legacy_id text,
        code text NOT NULL,
        label text NOT NULL,
        is_chartering boolean NOT NULL DEFAULT false,
        source_system text NOT NULL DEFAULT 'windev_hfsql',
        imported_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, code)
      );

      CREATE TABLE IF NOT EXISTS transport_carriers (
        id bigserial PRIMARY KEY,
        company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        legacy_id text,
        name text NOT NULL,
        address1 text,
        address2 text,
        address3 text,
        country_code text,
        postal_code text,
        city text,
        phone text,
        fax text,
        email text,
        vat_number text,
        siret text,
        contact_name text,
        notes text,
        source_system text NOT NULL DEFAULT 'windev_hfsql',
        imported_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, legacy_id)
      );

      CREATE TABLE IF NOT EXISTS transport_carrier_contacts (
        id bigserial PRIMARY KEY,
        carrier_id bigint REFERENCES transport_carriers(id) ON DELETE CASCADE,
        legacy_id text,
        display_name text,
        email text,
        source_system text NOT NULL DEFAULT 'windev_hfsql',
        imported_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (carrier_id, legacy_id)
      );

      CREATE TABLE IF NOT EXISTS transport_shipment_carrier_contacts (
        id bigserial PRIMARY KEY,
        shipment_id bigint NOT NULL REFERENCES transport_shipments(id) ON DELETE CASCADE,
        carrier_contact_id bigint REFERENCES transport_carrier_contacts(id) ON DELETE SET NULL,
        legacy_id text,
        source_system text NOT NULL DEFAULT 'windev_hfsql',
        imported_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (shipment_id, legacy_id)
      );

      ALTER TABLE transport_shipments ADD COLUMN IF NOT EXISTS product_name text;
      ALTER TABLE transport_shipments ADD COLUMN IF NOT EXISTS carrier_legacy_id text;
      ALTER TABLE transport_shipments ADD COLUMN IF NOT EXISTS carrier_name text;
      ALTER TABLE transport_shipments ADD COLUMN IF NOT EXISTS legacy_created_at timestamptz;
      ALTER TABLE transport_shipments ADD COLUMN IF NOT EXISTS legacy_created_by text;
      ALTER TABLE transport_shipments ADD COLUMN IF NOT EXISTS agreed_price numeric(12, 2);
      ALTER TABLE transport_shipments ADD COLUMN IF NOT EXISTS supplier_order_reference text;
    `);
  }
  await shipmentSchemaReady;
}

async function ensureCustomerSenderSchema() {
  await ensureShipmentSchema();
  if (!senderSchemaReady) {
    senderSchemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS transport_customer_senders (
        id bigserial PRIMARY KEY,
        customer_id bigint NOT NULL REFERENCES transport_customers(id) ON DELETE CASCADE,
        source_key text NOT NULL UNIQUE,
        name text,
        address1 text,
        address2 text,
        address3 text,
        country_code text,
        postal_code text,
        city text,
        phone text,
        instructions text,
        observations text,
        shipment_count integer NOT NULL DEFAULT 0,
        last_used_at date,
        source_system text NOT NULL DEFAULT 'shipments_derived',
        imported_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      INSERT INTO transport_customer_senders (
        customer_id, source_key, name, address1, address2, address3, country_code,
        postal_code, city, phone, shipment_count, last_used_at, source_system
      )
      SELECT
        customer_id,
        md5(customer_id::text || '|' || coalesce(sender_name, '') || '|' || coalesce(sender_address1, '') || '|' ||
          coalesce(sender_address2, '') || '|' || coalesce(sender_address3, '') || '|' || coalesce(sender_country_code, '') || '|' ||
          coalesce(sender_postal_code, '') || '|' || coalesce(sender_city, '') || '|' || coalesce(sender_phone, '')) AS source_key,
        max(sender_name) AS name,
        max(sender_address1) AS address1,
        max(sender_address2) AS address2,
        max(sender_address3) AS address3,
        max(sender_country_code) AS country_code,
        max(sender_postal_code) AS postal_code,
        max(sender_city) AS city,
        max(sender_phone) AS phone,
        count(*)::int AS shipment_count,
        max(departure_date) AS last_used_at,
        'shipments_derived' AS source_system
      FROM transport_shipments
      WHERE customer_id IS NOT NULL
        AND (sender_name IS NOT NULL OR sender_address1 IS NOT NULL OR sender_postal_code IS NOT NULL OR sender_city IS NOT NULL)
      GROUP BY
        customer_id,
        coalesce(sender_name, ''),
        coalesce(sender_address1, ''),
        coalesce(sender_address2, ''),
        coalesce(sender_address3, ''),
        coalesce(sender_country_code, ''),
        coalesce(sender_postal_code, ''),
        coalesce(sender_city, ''),
        coalesce(sender_phone, '')
      ON CONFLICT (source_key) DO UPDATE SET
        shipment_count = EXCLUDED.shipment_count,
        last_used_at = EXCLUDED.last_used_at,
        updated_at = now();
    `);
  }
  await senderSchemaReady;
}

async function ensureBillingSchema() {
  if (!pool) throw new Error("Database is not configured.");
  await ensureCustomerSchema();
  await ensureStaffSchema();
  if (!billingSchemaReady) {
    billingSchemaReady = pool.query(`
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

      CREATE TABLE IF NOT EXISTS billing_invoice_mail_dispatches (
        id bigserial PRIMARY KEY,
        company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        invoice_id bigint REFERENCES billing_invoices(id) ON DELETE SET NULL,
        staff_id bigint REFERENCES staff_members(id) ON DELETE SET NULL,
        document_type text NOT NULL,
        invoice_number text,
        recipient_email text NOT NULL,
        subject text NOT NULL,
        body_html text NOT NULL,
        total_ht numeric(14, 2),
        status text NOT NULL,
        technical_message text,
        dispatch_mode text NOT NULL DEFAULT 'test',
        created_by text NOT NULL DEFAULT 'system',
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS fiscal_status text NOT NULL DEFAULT 'imported';
      ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS sent_to_client boolean NOT NULL DEFAULT false;
      UPDATE billing_invoices SET sent_to_client = true WHERE invoice_date <= DATE '2026-06-30' AND sent_to_client = false;
      ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS fiscal_hash text;
      ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS previous_fiscal_hash text;
      ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS sealed_at timestamptz;
      ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS closed_at timestamptz;
      ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS archive_batch_id text;
      ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS source_payload_hash text;
      ALTER TABLE billing_invoices DROP CONSTRAINT IF EXISTS billing_invoices_company_id_invoice_number_key;
    `);
  }
  await billingSchemaReady;
}

async function ensureWindevSyncSchema() {
  await ensureCompanySchema();
  if (!syncSchemaReady) {
    syncSchemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS windev_sync_runs (
        id bigserial PRIMARY KEY,
        status text NOT NULL,
        triggered_by text,
        started_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz,
        command_label text,
        output_tail text,
        error_message text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }
  await syncSchemaReady;
}

function companyFromRow(row) {
  return {
    id: row.id,
    legacyId: row.legacy_id,
    name: row.name,
    code: row.code,
    status: row.status,
    siret: row.siret,
    vatNumber: row.vat_number,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    logoUrl: row.logo_url,
    address1: row.address1,
    address2: row.address2,
    address3: row.address3,
    countryCode: row.country_code,
    postalCode: row.postal_code,
    city: row.city,
    phone: row.phone,
    fax: row.fax,
    email: row.email,
    notes: row.notes,
    sourceSystem: row.source_system,
    updatedAt: row.updated_at,
  };
}

async function listCompanies(req, res) {
  if (!isAuthenticated(req)) return sendJson(res, 401, { error: "Unauthorized" });
  await ensureCompanySchema();
  const result = await pool.query(`
    SELECT *
    FROM companies
    ORDER BY name ASC, id ASC
  `);
  sendJson(res, 200, { companies: result.rows.map(companyFromRow) });
}

async function getCompany(req, res, id) {
  if (!isAuthenticated(req)) return sendJson(res, 401, { error: "Unauthorized" });
  await ensureCompanySchema();
  const result = await pool.query("SELECT * FROM companies WHERE id = $1", [id]);
  if (!result.rowCount) return sendJson(res, 404, { error: "Company not found" });
  sendJson(res, 200, { company: companyFromRow(result.rows[0]) });
}

async function saveCompany(req, res, id = null) {
  if (!isAuthenticated(req)) return sendJson(res, 401, { error: "Unauthorized" });
  await ensureCompanySchema();
  const body = await readJsonBody(req);
  const name = normalizeRequired(body.name);
  const code = normalizeRequired(body.code).toUpperCase();
  if (!name || !code) return sendJson(res, 400, { error: "Le nom et le code sont obligatoires." });

  const values = [
    normalizeLegacyId(body.legacyId),
    name,
    code,
    normalizeText(body.status) || "draft",
    normalizeText(body.siret),
    normalizeText(body.vatNumber),
    normalizeText(body.contactName),
    normalizeText(body.contactEmail),
    normalizeText(body.address1),
    normalizeText(body.address2),
    normalizeText(body.address3),
    normalizeText(body.countryCode),
    normalizeText(body.postalCode),
    normalizeText(body.city),
    normalizeText(body.phone),
    normalizeText(body.fax),
    normalizeText(body.email),
    normalizeText(body.notes),
    normalizeText(body.logoUrl),
  ];

  const columns = `
    legacy_id = $1,
    name = $2,
    code = $3,
    status = $4,
    siret = $5,
    vat_number = $6,
    contact_name = $7,
    contact_email = $8,
    address1 = $9,
    address2 = $10,
    address3 = $11,
    country_code = $12,
    postal_code = $13,
    city = $14,
    phone = $15,
    fax = $16,
    email = $17,
    notes = $18,
    logo_url = $19,
    source_system = COALESCE(source_system, 'manual_admin'),
    updated_at = now()
  `;

  const result = id
    ? await pool.query(`UPDATE companies SET ${columns} WHERE id = $20 RETURNING *`, [...values, id])
    : await pool.query(
        `INSERT INTO companies (
          legacy_id, name, code, status, siret, vat_number, contact_name, contact_email,
          address1, address2, address3, country_code, postal_code, city, phone, fax,
          email, notes, logo_url, source_system, imported_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, 'manual_admin', now(), now())
        RETURNING *`,
        values,
      );
  if (!result.rowCount) return sendJson(res, 404, { error: "Company not found" });
  sendJson(res, id ? 200 : 201, { company: companyFromRow(result.rows[0]) });
}

function customerFromRow(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    address1: row.address1,
    address2: row.address2,
    address3: row.address3,
    countryCode: row.country_code,
    postalCode: row.postal_code,
    city: row.city,
    phone: row.phone,
    fax: row.fax,
    email: row.email,
    vatNumber: row.vat_number,
    siret: row.siret,
    contactName: row.contact_name,
    contactMobile: row.contact_mobile,
    contactEmail: row.contact_email,
    billingName: row.billing_name,
    billingAddress1: row.billing_address1,
    billingAddress2: row.billing_address2,
    billingAddress3: row.billing_address3,
    billingCountryCode: row.billing_country_code,
    billingPostalCode: row.billing_postal_code,
    billingCity: row.billing_city,
    billingPhone: row.billing_phone,
    billingFax: row.billing_fax,
    billingEmail: row.billing_email,
    paymentCode: row.payment_code,
    isBlocked: row.is_blocked,
    noBilling: row.no_billing,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

function customerPayload(body) {
  return {
    code: normalizeRequired(body.code).toUpperCase(),
    name: normalizeRequired(body.name),
    status: normalizeText(body.status) || "active",
    address1: normalizeText(body.address1),
    address2: normalizeText(body.address2),
    address3: normalizeText(body.address3),
    countryCode: normalizeText(body.countryCode),
    postalCode: normalizeText(body.postalCode),
    city: normalizeText(body.city),
    phone: normalizeText(body.phone),
    fax: normalizeText(body.fax),
    email: normalizeText(body.email),
    vatNumber: normalizeText(body.vatNumber),
    siret: normalizeText(body.siret),
    contactName: normalizeText(body.contactName),
    contactMobile: normalizeText(body.contactMobile),
    contactEmail: normalizeText(body.contactEmail),
    billingName: normalizeText(body.billingName),
    billingAddress1: normalizeText(body.billingAddress1),
    billingAddress2: normalizeText(body.billingAddress2),
    billingAddress3: normalizeText(body.billingAddress3),
    billingCountryCode: normalizeText(body.billingCountryCode),
    billingPostalCode: normalizeText(body.billingPostalCode),
    billingCity: normalizeText(body.billingCity),
    billingPhone: normalizeText(body.billingPhone),
    billingFax: normalizeText(body.billingFax),
    billingEmail: normalizeText(body.billingEmail),
    paymentCode: normalizeText(body.paymentCode),
    isBlocked: normalizeBoolean(body.isBlocked),
    noBilling: normalizeBoolean(body.noBilling),
    notes: normalizeText(body.notes),
  };
}

function diffCustomer(before, after) {
  const changes = {};
  for (const [key, newValue] of Object.entries(after)) {
    const oldValue = before[key] ?? null;
    const normalizedNew = newValue ?? null;
    if (oldValue !== normalizedNew) changes[key] = { from: oldValue, to: normalizedNew };
  }
  return changes;
}

async function listCustomers(req, res, url) {
  await ensureCustomerSchema();
  const search = normalizeText(url.searchParams.get("search"));
  const status = normalizeText(url.searchParams.get("status"));
  const result = await pool.query(
    `
      SELECT tc.*
      FROM transport_customers tc
      JOIN companies c ON c.id = tc.company_id
      WHERE c.legacy_id = 1970324836974592001
        AND ($1::text IS NULL OR tc.status = $1)
        AND (
          $2::text IS NULL OR
          lower(tc.name || ' ' || tc.code || ' ' || coalesce(tc.city, '') || ' ' || coalesce(tc.siret, '') || ' ' || coalesce(tc.email, '')) LIKE '%' || lower($2) || '%'
        )
      ORDER BY tc.name ASC, tc.code ASC
    `,
    [status, search],
  );
  sendJson(res, 200, { customers: result.rows.map(customerFromRow) });
}

async function getCustomer(req, res, id) {
  await ensureCustomerSchema();
  const result = await pool.query("SELECT * FROM transport_customers WHERE id = $1", [id]);
  if (!result.rowCount) return sendJson(res, 404, { error: "Client introuvable." });
  sendJson(res, 200, { customer: customerFromRow(result.rows[0]) });
}

async function getCustomerHistory(req, res, id) {
  await ensureCustomerSchema();
  const result = await pool.query(
    `
      SELECT id, changed_at, changed_by, action, changes
      FROM transport_customer_change_events
      WHERE customer_id = $1
      ORDER BY changed_at DESC, id DESC
      LIMIT 100
    `,
    [id],
  );
  sendJson(res, 200, {
    events: result.rows.map((row) => ({
      id: row.id,
      changedAt: row.changed_at,
      changedBy: row.changed_by,
      action: row.action,
      changes: row.changes,
    })),
  });
}

async function getCustomerSenders(req, res, id) {
  await ensureCustomerSenderSchema();
  const result = await pool.query(
    `
      SELECT id, name, address1, address2, address3, country_code, postal_code, city,
        phone, instructions, observations, shipment_count, last_used_at, source_system
      FROM transport_customer_senders
      WHERE customer_id = $1
      ORDER BY shipment_count DESC, last_used_at DESC NULLS LAST, name ASC NULLS LAST
    `,
    [id],
  );
  sendJson(res, 200, {
    senders: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      address1: row.address1,
      address2: row.address2,
      address3: row.address3,
      countryCode: row.country_code,
      postalCode: row.postal_code,
      city: row.city,
      phone: row.phone,
      instructions: row.instructions,
      observations: row.observations,
      shipmentCount: row.shipment_count,
      lastUsedAt: row.last_used_at,
      sourceSystem: row.source_system,
    })),
  });
}

async function saveCustomer(req, res, id) {
  await ensureCustomerSchema();
  const body = await readJsonBody(req);
  const payload = customerPayload(body);
  if (!payload.code || !payload.name) return sendJson(res, 400, { error: "Le code et le nom sont obligatoires." });
  const beforeResult = await pool.query("SELECT * FROM transport_customers WHERE id = $1", [id]);
  if (!beforeResult.rowCount) return sendJson(res, 404, { error: "Client introuvable." });
  const before = customerFromRow(beforeResult.rows[0]);
  const changes = diffCustomer(before, payload);
  if (!Object.keys(changes).length) return sendJson(res, 200, { customer: before, changed: false });

  const values = [
    payload.code,
    payload.name,
    payload.status,
    payload.address1,
    payload.address2,
    payload.address3,
    payload.countryCode,
    payload.postalCode,
    payload.city,
    payload.phone,
    payload.fax,
    payload.email,
    payload.vatNumber,
    payload.siret,
    payload.contactName,
    payload.contactMobile,
    payload.contactEmail,
    payload.billingName,
    payload.billingAddress1,
    payload.billingAddress2,
    payload.billingAddress3,
    payload.billingCountryCode,
    payload.billingPostalCode,
    payload.billingCity,
    payload.billingPhone,
    payload.billingFax,
    payload.billingEmail,
    payload.paymentCode,
    payload.isBlocked,
    payload.noBilling,
    payload.notes,
    id,
  ];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `
        UPDATE transport_customers SET
          code = $1, name = $2, status = $3,
          address1 = $4, address2 = $5, address3 = $6, country_code = $7,
          postal_code = $8, city = $9, phone = $10, fax = $11, email = $12,
          vat_number = $13, siret = $14, contact_name = $15, contact_mobile = $16,
          contact_email = $17, billing_name = $18, billing_address1 = $19,
          billing_address2 = $20, billing_address3 = $21, billing_country_code = $22,
          billing_postal_code = $23, billing_city = $24, billing_phone = $25,
          billing_fax = $26, billing_email = $27, payment_code = $28,
          is_blocked = $29, no_billing = $30, notes = $31, updated_at = now()
        WHERE id = $32
        RETURNING *
      `,
      values,
    );
    await client.query(
      `
        INSERT INTO transport_customer_change_events (customer_id, changed_by, action, changes)
        VALUES ($1, $2, 'update', $3::jsonb)
      `,
      [id, actorFromRequest(req, body), JSON.stringify(changes)],
    );
    await client.query("COMMIT");
    sendJson(res, 200, { customer: customerFromRow(updated.rows[0]), changed: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function staffFromRow(row) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: row.display_name,
    login: row.login,
    email: row.email,
    phone: row.phone,
    smtpServer: row.smtp_server,
    smtpPort: row.smtp_port,
    mailSignatureHtml: row.mail_signature_html,
    mailHtmlFile: row.mail_html_file,
    mailPasswordConfigured: Boolean(row.mail_password_encrypted || row.mail_password_configured),
    role: row.role,
    status: row.status,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

function staffPayload(body) {
  const firstName = normalizeRequired(body.firstName);
  const lastName = normalizeText(body.lastName);
  return {
    firstName,
    lastName,
    displayName: normalizeText(body.displayName) || [firstName, lastName].filter(Boolean).join(" "),
    login: normalizeText(body.login),
    email: normalizeText(body.email),
    phone: normalizeText(body.phone),
    smtpServer: normalizeText(body.smtpServer),
    smtpPort: normalizeText(body.smtpPort),
    smtpPassword: normalizeText(body.smtpPassword),
    mailSignatureHtml: normalizeText(body.mailSignatureHtml),
    mailHtmlFile: normalizeText(body.mailHtmlFile),
    role: normalizeText(body.role) || "PERSONNEL",
    status: normalizeText(body.status) || "active",
    notes: normalizeText(body.notes),
  };
}

function diffObject(before, after) {
  const changes = {};
  for (const [key, newValue] of Object.entries(after)) {
    const oldValue = before[key] ?? null;
    const normalizedNew = newValue ?? null;
    if (oldValue !== normalizedNew) changes[key] = { from: oldValue, to: normalizedNew };
  }
  return changes;
}

function shipmentFromRow(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    payerCustomerId: row.payer_customer_id,
    customerName: row.customer_name,
    payerName: row.payer_name,
    receiptNo: row.receipt_no,
    shipmentType: row.shipment_type,
    portType: row.port_type,
    customerCode: row.customer_code,
    payerCode: row.payer_code,
    senderName: row.sender_name,
    senderAddress1: row.sender_address1,
    senderAddress2: row.sender_address2,
    senderAddress3: row.sender_address3,
    senderCountryCode: row.sender_country_code,
    senderPostalCode: row.sender_postal_code,
    senderCity: row.sender_city,
    senderPhone: row.sender_phone,
    recipientName: row.recipient_name,
    recipientAddress1: row.recipient_address1,
    recipientAddress2: row.recipient_address2,
    recipientAddress3: row.recipient_address3,
    recipientCountryCode: row.recipient_country_code,
    recipientPostalCode: row.recipient_postal_code,
    recipientCity: row.recipient_city,
    recipientPhone: row.recipient_phone,
    recipientEmail: row.recipient_email,
    parcels: row.parcels,
    weight: row.weight,
    volume: row.volume,
    goodsNature: row.goods_nature,
    declaredValue: row.declared_value,
    productCode: row.product_code,
    productName: row.product_name,
    carrierCode: row.carrier_code,
    carrierLegacyId: row.carrier_legacy_id,
    carrierName: row.carrier_name,
    carrierContactNames: row.carrier_contact_names,
    departureDate: row.departure_date,
    arrivalDate: row.arrival_date,
    pickupDate: row.pickup_date,
    requestedDeliveryDate: row.requested_delivery_date,
    estimatedDeliveryDate: row.estimated_delivery_date,
    invoiceDate: row.invoice_date,
    invoiceNumber: row.invoice_number,
    invoiceValidationCode: row.invoice_validation_code,
    transportAmount: row.transport_amount,
    vatAmount: row.vat_amount,
    agreedPrice: row.agreed_price,
    salePrice: row.sale_price,
    subcontractAmount: row.subcontract_amount,
    cashOnDelivery: row.cash_on_delivery,
    routeCode: row.route_code,
    pickupRouteCode: row.pickup_route_code,
    deliveryRouteCode: row.delivery_route_code,
    ediReference: row.edi_reference,
    orderReference: row.order_reference,
    supplierOrderReference: row.supplier_order_reference,
    barcode: row.barcode,
    status: row.status,
    isClosed: row.is_closed,
    isDispute: row.is_dispute,
    isChartering: row.is_chartering,
    notes: row.notes,
    legacyCreatedAt: row.legacy_created_at,
    legacyCreatedBy: row.legacy_created_by,
    updatedAt: row.updated_at,
  };
}

function invoiceFromRow(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    legacyId: row.legacy_id,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    validationCode: row.validation_code,
    accountCode: row.account_code,
    customerName: row.customer_name,
    customerAccountCode: row.customer_account_code,
    paymentLabel: row.payment_label,
    productCode: row.product_code,
    productLabel: row.product_label,
    isCreditNote: row.is_credit_note,
    isDeposit: row.is_deposit,
    totalPositions: row.total_positions,
    totalParcels: row.total_parcels,
    totalWeight: row.total_weight,
    totalHt: row.total_ht,
    totalVat: row.total_vat,
    totalTtc: row.total_ttc,
    discountRate: row.discount_rate,
    discountAmount: row.discount_amount,
    paymentDate: row.payment_date,
    paymentText: row.payment_text,
    billingName: row.billing_name,
    billingAddress1: row.billing_address1,
    billingAddress2: row.billing_address2,
    billingAddress3: row.billing_address3,
    billingPostalCode: row.billing_postal_code,
    billingCity: row.billing_city,
    billingCountryCode: row.billing_country_code,
    billingPhone: row.billing_phone,
    billingEmail: row.billing_email,
    vatNumber: row.vat_number,
    customerAddress1: row.customer_address1,
    customerAddress2: row.customer_address2,
    customerAddress3: row.customer_address3,
    customerPostalCode: row.customer_postal_code,
    customerCity: row.customer_city,
    customerCountryCode: row.customer_country_code,
    sentToClient: row.sent_to_client,
    fiscalStatus: row.fiscal_status,
    fiscalHash: row.fiscal_hash,
    previousFiscalHash: row.previous_fiscal_hash,
    sealedAt: row.sealed_at,
    closedAt: row.closed_at,
    closurePeriod: row.closure_period,
    archivedAt: row.archived_at,
    archiveBatchId: row.archive_batch_id,
    certificationScope: row.certification_scope,
    updatedAt: row.updated_at,
  };
}

function invoiceLineFromRow(row) {
  return {
    id: row.id,
    legacyId: row.legacy_id,
    lineNumber: row.line_number,
    identifier: row.identifier,
    description: row.description,
    parcels: row.parcels,
    weight: row.weight,
    amount: row.amount,
    unitPrice: row.unit_price,
    productCode: row.product_code,
    serviceCode: row.service_code,
    discountRate: row.discount_rate,
    vatRate: row.vat_rate,
    discountAmount: row.discount_amount,
    vatAmount: row.vat_amount,
    amountTtc: row.amount_ttc,
    computedVatAmount: row.computed_vat_amount,
    computedAmountTtc: row.computed_amount_ttc,
    taxableQuantity: row.taxable_quantity,
    lineType: row.line_type,
    isBold: row.is_bold,
    receiptNo: row.matched_receipt_no,
    shipmentId: row.shipment_id,
    shipmentVatAmount: row.shipment_vat_amount,
    shipmentTransportAmount: row.shipment_transport_amount,
    shipmentInvoiceNumber: row.shipment_invoice_number,
    shipmentSenderName: row.shipment_sender_name,
    shipmentRecipientName: row.shipment_recipient_name,
  };
}

function normalizeNumber(value) {
  const text = String(value ?? "").replace(",", ".").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function normalizeInteger(value) {
  const number = normalizeNumber(value);
  return number === null ? null : Math.trunc(number);
}

function shipmentPayload(body) {
  return {
    receiptNo: normalizeRequired(body.receiptNo),
    customerCode: normalizeText(body.customerCode),
    payerCode: normalizeText(body.payerCode),
    senderName: normalizeText(body.senderName),
    senderAddress1: normalizeText(body.senderAddress1),
    senderAddress2: normalizeText(body.senderAddress2),
    senderAddress3: normalizeText(body.senderAddress3),
    senderCountryCode: normalizeText(body.senderCountryCode),
    senderPostalCode: normalizeText(body.senderPostalCode),
    senderCity: normalizeText(body.senderCity),
    senderPhone: normalizeText(body.senderPhone),
    senderInstructions: normalizeText(body.senderInstructions),
    senderObservations: normalizeText(body.senderObservations),
    recipientName: normalizeText(body.recipientName),
    recipientAddress1: normalizeText(body.recipientAddress1),
    recipientAddress2: normalizeText(body.recipientAddress2),
    recipientAddress3: normalizeText(body.recipientAddress3),
    recipientCountryCode: normalizeText(body.recipientCountryCode),
    recipientPostalCode: normalizeText(body.recipientPostalCode),
    recipientCity: normalizeText(body.recipientCity),
    recipientPhone: normalizeText(body.recipientPhone),
    recipientEmail: normalizeText(body.recipientEmail),
    parcels: normalizeInteger(body.parcels),
    weight: normalizeNumber(body.weight),
    volume: normalizeNumber(body.volume),
    goodsNature: normalizeText(body.goodsNature),
    productCode: normalizeText(body.productCode),
    departureDate: normalizeText(body.departureDate),
    pickupDate: normalizeText(body.pickupDate),
    requestedDeliveryDate: normalizeText(body.requestedDeliveryDate),
    estimatedDeliveryDate: normalizeText(body.estimatedDeliveryDate),
    arrivalDate: normalizeText(body.arrivalDate),
    invoiceNumber: normalizeText(body.invoiceNumber),
    invoiceValidationCode: normalizeText(body.invoiceValidationCode),
    orderReference: normalizeText(body.orderReference),
    transportAmount: normalizeNumber(body.transportAmount),
    agreedPrice: normalizeNumber(body.agreedPrice),
    salePrice: normalizeNumber(body.salePrice),
    carrierLegacyId: normalizeText(body.carrierLegacyId),
    carrierName: normalizeText(body.carrierName),
    status: normalizeText(body.status) || "open",
    isClosed: normalizeBoolean(body.isClosed),
    isDispute: normalizeBoolean(body.isDispute),
    isChartering: normalizeBoolean(body.isChartering),
    notes: normalizeText(body.notes),
  };
}

async function listShipments(req, res, url) {
  await ensureShipmentSchema();
  const search = normalizeText(url.searchParams.get("search"));
  const status = normalizeText(url.searchParams.get("status"));
  const dateFrom = normalizeText(url.searchParams.get("dateFrom"));
  const dateTo = normalizeText(url.searchParams.get("dateTo"));
  const result = await pool.query(
    `
      SELECT
        ts.*,
        to_char(ts.legacy_created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS legacy_created_at,
        cst.name AS customer_name,
        payer.name AS payer_name,
        COALESCE(ts.product_name, tp.label) AS product_name,
        COALESCE(ts.carrier_name, tc.name) AS carrier_name,
        contacts.carrier_contact_names
      FROM transport_shipments ts
      JOIN companies c ON c.id = ts.company_id
      LEFT JOIN transport_customers cst ON cst.id = ts.customer_id
      LEFT JOIN transport_customers payer ON payer.id = ts.payer_customer_id
      LEFT JOIN transport_products tp ON tp.company_id = ts.company_id AND tp.code = ts.product_code
      LEFT JOIN transport_carriers tc ON tc.company_id = ts.company_id AND tc.legacy_id = ts.carrier_legacy_id
      LEFT JOIN LATERAL (
        SELECT string_agg(DISTINCT NULLIF(tcc.display_name, ''), ', ' ORDER BY NULLIF(tcc.display_name, '')) AS carrier_contact_names
        FROM transport_shipment_carrier_contacts tscc
        LEFT JOIN transport_carrier_contacts tcc ON tcc.id = tscc.carrier_contact_id
        WHERE tscc.shipment_id = ts.id
      ) contacts ON true
      WHERE c.legacy_id = 1970324836974592001
        AND ($1::text IS NULL OR ts.status = $1)
        AND ($3::date IS NULL OR ts.departure_date >= $3::date)
        AND ($4::date IS NULL OR ts.departure_date <= $4::date)
        AND (
          $2::text IS NULL OR
          lower(ts.receipt_no || ' ' || coalesce(ts.sender_name, '') || ' ' || coalesce(ts.recipient_name, '') || ' ' ||
            coalesce(ts.recipient_city, '') || ' ' || coalesce(ts.customer_code, '') || ' ' || coalesce(ts.payer_code, '') ||
            ' ' || coalesce(ts.order_reference, '') || ' ' || coalesce(ts.product_code, '') || ' ' || coalesce(ts.product_name, '') ||
            ' ' || coalesce(ts.carrier_name, '') || ' ' || coalesce(ts.legacy_created_by, '')) LIKE '%' || lower($2) || '%'
        )
      ORDER BY ts.departure_date DESC NULLS LAST, ts.legacy_created_at DESC NULLS LAST, ts.receipt_no DESC
      LIMIT 500
    `,
    [status, search, dateFrom, dateTo],
  );
  const stats = await pool.query(
    `
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE ts.status = 'open')::int AS open,
        count(*) FILTER (WHERE ts.status = 'invoiced')::int AS invoiced,
        count(*) FILTER (WHERE is_dispute)::int AS disputes
      FROM transport_shipments ts
      JOIN companies c ON c.id = ts.company_id
      WHERE c.legacy_id = 1970324836974592001
        AND ($1::date IS NULL OR ts.departure_date >= $1::date)
        AND ($2::date IS NULL OR ts.departure_date <= $2::date)
    `,
    [dateFrom, dateTo],
  );
  sendJson(res, 200, { shipments: result.rows.map(shipmentFromRow), stats: stats.rows[0] });
}

async function getShipment(req, res, id) {
  await ensureShipmentSchema();
  const result = await pool.query(
    `
      SELECT
        ts.*,
        to_char(ts.legacy_created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS legacy_created_at,
        cst.name AS customer_name,
        payer.name AS payer_name,
        COALESCE(ts.product_name, tp.label) AS product_name,
        COALESCE(ts.carrier_name, tc.name) AS carrier_name,
        contacts.carrier_contact_names
      FROM transport_shipments ts
      LEFT JOIN transport_customers cst ON cst.id = ts.customer_id
      LEFT JOIN transport_customers payer ON payer.id = ts.payer_customer_id
      LEFT JOIN transport_products tp ON tp.company_id = ts.company_id AND tp.code = ts.product_code
      LEFT JOIN transport_carriers tc ON tc.company_id = ts.company_id AND tc.legacy_id = ts.carrier_legacy_id
      LEFT JOIN LATERAL (
        SELECT string_agg(DISTINCT NULLIF(tcc.display_name, ''), ', ' ORDER BY NULLIF(tcc.display_name, '')) AS carrier_contact_names
        FROM transport_shipment_carrier_contacts tscc
        LEFT JOIN transport_carrier_contacts tcc ON tcc.id = tscc.carrier_contact_id
        WHERE tscc.shipment_id = ts.id
      ) contacts ON true
      WHERE ts.id = $1
    `,
    [id],
  );
  if (!result.rowCount) return sendJson(res, 404, { error: "Expedition introuvable." });
  sendJson(res, 200, { shipment: shipmentFromRow(result.rows[0]) });
}

async function listInvoices(req, res, url) {
  await ensureBillingSchema();
  const search = normalizeText(url.searchParams.get("q"));
  const status = normalizeText(url.searchParams.get("status"));
  const dateFrom = normalizeText(url.searchParams.get("dateFrom"));
  const dateTo = normalizeText(url.searchParams.get("dateTo"));
  const limit = Math.min(Number(url.searchParams.get("limit") || 250), 1000);
  const params = [search || null, status || null, dateFrom || null, dateTo || null, limit];
  const result = await pool.query(
    `
      SELECT bi.*
      FROM billing_invoices bi
      WHERE ($1::text IS NULL OR lower(bi.invoice_number || ' ' || coalesce(bi.customer_name, '') || ' ' || coalesce(bi.account_code, '') || ' ' || coalesce(bi.product_label, '')) LIKE '%' || lower($1) || '%')
        AND (
          $2::text IS NULL
          OR bi.fiscal_status = $2
          OR bi.validation_code = $2
          OR ($2 = 'sent' AND bi.sent_to_client = true)
          OR ($2 = 'not_sent' AND bi.sent_to_client = false)
        )
        AND ($3::date IS NULL OR bi.invoice_date >= $3::date)
        AND ($4::date IS NULL OR bi.invoice_date <= $4::date)
      ORDER BY bi.invoice_date DESC NULLS LAST, bi.invoice_number DESC
      LIMIT $5
    `,
    params,
  );
  const stats = await pool.query(
    `
      SELECT
        count(*)::int AS total,
        coalesce(sum(total_ht), 0)::numeric(14, 2) AS total_ht,
        coalesce(sum(total_vat), 0)::numeric(14, 2) AS total_vat,
        coalesce(sum(total_ttc), 0)::numeric(14, 2) AS total_ttc,
        count(*) FILTER (WHERE is_credit_note)::int AS credit_notes,
        count(*) FILTER (WHERE fiscal_hash IS NOT NULL)::int AS sealed,
        count(*) FILTER (WHERE sent_to_client)::int AS sent_to_client
      FROM billing_invoices
    `,
  );
  sendJson(res, 200, { invoices: result.rows.map(invoiceFromRow), stats: stats.rows[0] });
}

async function listPendingInvoiceDispatchPreview(req, res) {
  await ensureBillingSchema();
  const result = await pool.query(`
    SELECT
      bi.id,
      bi.invoice_number,
      bi.invoice_date,
      bi.customer_id,
      bi.customer_name,
      bi.account_code,
      bi.is_credit_note,
      bi.total_ttc,
      tc.billing_email,
      tc.contact_email,
      tc.email
    FROM billing_invoices bi
    LEFT JOIN transport_customers tc ON tc.id = bi.customer_id
    WHERE bi.sent_to_client = false
    ORDER BY lower(coalesce(bi.customer_name, '')), bi.invoice_date ASC NULLS LAST, bi.invoice_number ASC
  `);

  const groupsByKey = new Map();
  for (const row of result.rows) {
    const key = row.customer_id ? `customer:${row.customer_id}` : `account:${row.account_code || row.customer_name || "unknown"}`;
    if (!groupsByKey.has(key)) {
      const recipients = invoiceRecipientEmails(row.billing_email, row.contact_email, row.email);
      groupsByKey.set(key, {
        customerId: row.customer_id,
        customerName: row.customer_name || "Client non renseigne",
        accountCode: row.account_code,
        recipients,
        documentCount: 0,
        invoices: [],
      });
    }
    const group = groupsByKey.get(key);
    group.documentCount += 1;
    group.invoices.push({
      id: row.id,
      invoiceNumber: row.invoice_number,
      invoiceDate: row.invoice_date,
      documentType: row.is_credit_note ? "Avoir" : "Facture",
      totalTtc: row.total_ttc,
    });
  }

  const groups = Array.from(groupsByKey.values());
  const invalidEmailCount = groups.reduce(
    (total, group) => total + group.recipients.filter((recipient) => !recipient.isValid).length,
    0,
  );
  sendJson(res, 200, {
    simulated: true,
    totalCustomers: groups.length,
    totalDocuments: result.rows.length,
    invalidEmailCount,
    groups,
  });
}

function invoiceDispatchObjectLabel(rows) {
  const invoiceCount = rows.filter((row) => !row.is_credit_note).length;
  const creditCount = rows.filter((row) => row.is_credit_note).length;
  if (invoiceCount && creditCount) return "vos factures et avoirs";
  if (invoiceCount > 1) return "vos factures";
  if (invoiceCount === 1) return "votre facture";
  if (creditCount > 1) return "vos avoirs";
  return "votre avoir";
}

function invoiceDispatchSubject(rows) {
  const numbers = rows.map((row) => row.invoice_number).filter(Boolean);
  const label = invoiceDispatchObjectLabel(rows);
  if (numbers.length === 1) return `${label.charAt(0).toUpperCase()}${label.slice(1)} ${numbers[0]}`;
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} ${numbers.slice(0, 4).join(", ")}`;
}

function invoiceDispatchTotalHt(rows) {
  const hasInvoices = rows.some((row) => !row.is_credit_note);
  const hasCredits = rows.some((row) => row.is_credit_note);
  const signedTotal = rows.reduce((sum, row) => {
    const value = Number(row.total_ht || 0);
    return sum + (row.is_credit_note && value > 0 ? -value : value);
  }, 0);
  return hasCredits && !hasInvoices ? Math.abs(signedTotal) : signedTotal;
}

function invoiceDispatchBodyHtml(rows, staff) {
  const label = invoiceDispatchObjectLabel(rows);
  const totalText = moneyFr(invoiceDispatchTotalHt(rows));
  const totalLabel = rows.length > 1 ? "un montant total" : "un montant";
  const signature = normalizeText(staff?.mail_signature_html)
    || `<p>${escapeHtml(staff?.display_name || staff?.first_name || "SGA")}</p>`;
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#111827;">
      <p>Bonjour,</p>
      <p>Veuillez trouver ci-joint ${escapeHtml(label)} pour ${totalLabel} de <strong>${escapeHtml(totalText)} &euro; HT</strong>.</p>
      <p>Cordialement,</p>
      ${signature}
    </div>
  `.trim();
}

function cleanInvoiceText(value) {
  const text = String(value || "").trim();
  if (!text.startsWith("{\\rtf")) return text;
  return text
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function positiveAmount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function lineTaxableQuantity(row) {
  return positiveAmount(row.taxable_quantity) || 1;
}

function lineUnitPrice(row) {
  const unitPrice = positiveAmount(row.unit_price);
  if (unitPrice) return unitPrice;
  const quantity = lineTaxableQuantity(row);
  return quantity ? Number(row.amount || 0) / quantity : 0;
}

function lineHtAmount(row) {
  if (!positiveAmount(row.taxable_quantity) && positiveAmount(row.unit_price)) return positiveAmount(row.unit_price);
  return Number(row.amount || 0);
}

function isInvoiceGroupingText(value) {
  const text = cleanInvoiceText(value).replace(/\s+/g, " ").trim();
  return /^Date Du\b/i.test(text) || /^Total Date Du\b/i.test(text);
}

function pdfEscape(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapPdfText(text, maxChars) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function pdfTextLine(x, y, size, text, bold = false, align = "left", width = 0) {
  const safeText = String(text ?? "");
  const approxWidth = safeText.length * size * 0.5;
  const dx = align === "right" ? Math.max(0, width - approxWidth) : align === "center" ? Math.max(0, (width - approxWidth) / 2) : 0;
  return `BT /${bold ? "F2" : "F1"} ${size} Tf ${x + dx} ${y} Td (${pdfEscape(safeText)}) Tj ET`;
}

function pdfRect(x, y, width, height, fill = false, gray = null) {
  const commands = [];
  if (gray !== null) commands.push(`${gray} g`);
  commands.push(`${x} ${y} ${width} ${height} re ${fill ? "f" : "S"}`);
  if (gray !== null) commands.push("0 g");
  return commands.join("\n");
}

function pdfCell(commands, x, y, width, height, text, options = {}) {
  if (options.fillGray !== undefined) commands.push(pdfRect(x, y, width, height, true, options.fillGray));
  commands.push(pdfRect(x, y, width, height));
  if (text !== undefined && text !== null && text !== "") {
    commands.push(pdfTextLine(x + 3, y + Math.max(3, (height / 2) - (options.size || 7) / 3), options.size || 7, text, options.bold, options.align || "left", width - 6));
  }
}

function buildPdfBuffer(pages, images = []) {
  const objects = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };
  const fontRegular = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontBold = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const imageRefs = images.map((image) => ({
    name: image.name,
    ref: addObject(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.content.length} >>\nstream\n`, "utf8"),
      image.content,
      Buffer.from("\nendstream", "utf8"),
    ])),
  }));
  const xObjectResources = imageRefs.length
    ? `/XObject << ${imageRefs.map((image) => `/${image.name} ${image.ref} 0 R`).join(" ")} >>`
    : "";
  const pageRefs = [];
  for (const content of pages) {
    const contentRef = addObject(`<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`);
    const pageRef = addObject(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> ${xObjectResources} >> /Contents ${contentRef} 0 R >>`);
    pageRefs.push(pageRef);
  }
  const pagesRef = addObject(`<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`);
  for (const ref of pageRefs) {
    objects[ref - 1] = objects[ref - 1].replace("/Parent 0 0 R", `/Parent ${pagesRef} 0 R`);
  }
  const catalogRef = addObject(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`);
  const chunks = [Buffer.from("%PDF-1.4\n", "utf8")];
  let length = chunks[0].length;
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(length);
    const objectBuffer = Buffer.isBuffer(object) ? object : Buffer.from(object, "utf8");
    const prefix = Buffer.from(`${index + 1} 0 obj\n`, "utf8");
    const suffix = Buffer.from("\nendobj\n", "utf8");
    chunks.push(prefix, objectBuffer, suffix);
    length += prefix.length + objectBuffer.length + suffix.length;
  });
  const xref = length;
  let trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    trailer += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  trailer += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogRef} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  chunks.push(Buffer.from(trailer, "utf8"));
  return Buffer.concat(chunks);
}

function invoiceAddressText(invoice) {
  return [
    invoice.billingName || invoice.customerName,
    invoice.billingAddress1 || invoice.customerAddress1,
    invoice.billingAddress2 || invoice.customerAddress2,
    invoice.billingAddress3 || invoice.customerAddress3,
    [invoice.billingPostalCode || invoice.customerPostalCode, invoice.billingCity || invoice.customerCity].filter(Boolean).join(" "),
    invoice.billingCountryCode || invoice.customerCountryCode || "FRANCE",
  ].filter(Boolean);
}

function generateInvoicePdf(invoice, lines) {
  const printableLines = lines.filter((line) => line.line_type !== "empty" && !isInvoiceGroupingText(line.description));
  const rowsPerPage = 8;
  const chunks = [];
  for (let index = 0; index < printableLines.length; index += rowsPerPage) chunks.push(printableLines.slice(index, index + rowsPerPage));
  if (!chunks.length) chunks.push([]);
  const ht = Number(invoice.totalHt || 0);
  const vat = Number(invoice.totalVat || 0);
  const ttc = Number(invoice.totalTtc || 0);
  const vatRate = ht ? Math.round((Math.abs(vat) / Math.abs(ht)) * 10000) / 100 : 20;
  const logoPath = path.join(staticRoot, "assets", "sga-agency-logo.jpg");
  const logoImage = fs.existsSync(logoPath) ? {
    name: "Logo",
    width: 1866,
    height: 577,
    content: fs.readFileSync(logoPath),
  } : null;
  const pages = chunks.map((rows, pageIndex) => {
    const commands = ["0 g", "0.7 w"];
    const title = `${invoice.isCreditNote ? "Avoir" : "Facture"} N ${invoice.invoiceNumber || ""}`;
    if (logoImage) commands.push("q 180 0 0 56 32 780 cm /Logo Do Q");
    commands.push(pdfTextLine(42, 762, 7, "58 IMPASSE GUICHENON"));
    commands.push(pdfTextLine(42, 750, 7, "01330 VILLARS-LES-DOMBES"));
    commands.push(pdfTextLine(42, 738, 7, "compta@sga-groupe.fr"));
    commands.push(pdfTextLine(42, 726, 7, "Fax :"));
    commands.push(pdfTextLine(42, 714, 7, "SIRET : 89214747100015"));
    commands.push(pdfTextLine(42, 702, 7, "Tel : 08 50 38 04 49"));
    commands.push(pdfTextLine(42, 690, 7, "N TVA : FR92892147471"));

    const metaX = 348;
    const metaY = 790;
    const metaW = 205;
    pdfCell(commands, metaX, metaY, metaW, 14, title, { fillGray: 0.9, bold: true, align: "center", size: 7 });
    pdfCell(commands, metaX, metaY - 14, 68, 14, "Date", { fillGray: 0.9, bold: true, align: "center" });
    pdfCell(commands, metaX + 68, metaY - 14, 68, 14, "Client", { fillGray: 0.9, bold: true, align: "center" });
    pdfCell(commands, metaX + 136, metaY - 14, 69, 14, "Page", { fillGray: 0.9, bold: true, align: "center" });
    pdfCell(commands, metaX, metaY - 28, 68, 14, new Date(invoice.invoiceDate || Date.now()).toLocaleDateString("fr-FR"), { bold: true, align: "center" });
    pdfCell(commands, metaX + 68, metaY - 28, 68, 14, invoice.accountCode || invoice.customerAccountCode || "", { bold: true, align: "center" });
    pdfCell(commands, metaX + 136, metaY - 28, 69, 14, `${pageIndex + 1}/${chunks.length}`, { bold: true, align: "center" });
    pdfCell(commands, metaX, metaY - 42, metaW, 14, "A RECEPTION DE FACTURE", { fillGray: 0.9, bold: true, align: "center" });
    pdfCell(commands, metaX, metaY - 56, 68, 14, "Echeance", { fillGray: 0.9, bold: true, align: "center" });
    pdfCell(commands, metaX + 68, metaY - 56, 137, 14, new Date(invoice.dueDate || invoice.invoiceDate || Date.now()).toLocaleDateString("fr-FR"), { bold: true, align: "center" });
    commands.push(pdfTextLine(metaX, metaY - 76, 10, invoice.productLabel || invoice.productCode || "", true));

    let addressY = 650;
    for (const [index, line] of invoiceAddressText(invoice).entries()) {
      commands.push(pdfTextLine(350, addressY, index === 0 ? 12 : 10, line, index === 0));
      addressY -= 14;
    }

    const tableX = 35;
    const tableTop = 575;
    const colW = [62, 185, 58, 58, 58, 68, 36];
    const headers = ["Ref.", "Description", "Qte. Tax", "P.U.", "Remise", "Total H.T.", "TVA"];
    let x = tableX;
    headers.forEach((header, index) => {
      pdfCell(commands, x, tableTop, colW[index], 14, header, { bold: true, align: "center", size: 7 });
      x += colW[index];
    });
    const bodyTop = tableTop - 14;
    commands.push(pdfRect(tableX, 180, 525, bodyTop - 180));
    x = tableX;
    for (let index = 0; index < colW.length - 1; index += 1) {
      x += colW[index];
      commands.push(`${x} 180 m ${x} ${bodyTop} l S`);
    }
    let y = bodyTop - 18;
    for (const line of rows) {
      const description = wrapPdfText(cleanInvoiceText(line.description), 48).slice(0, 3);
      commands.push(pdfTextLine(tableX + 3, y, 7, line.identifier || line.matched_receipt_no || ""));
      description.forEach((part, partIndex) => commands.push(pdfTextLine(tableX + colW[0] + 5, y - (partIndex * 10), 7, part)));
      commands.push(pdfTextLine(tableX + colW[0] + colW[1] + 3, y, 7, moneyFr(lineTaxableQuantity(line)), false, "right", colW[2] - 6));
      commands.push(pdfTextLine(tableX + colW[0] + colW[1] + colW[2] + 3, y, 7, moneyFr(lineUnitPrice(line)), false, "right", colW[3] - 6));
      commands.push(pdfTextLine(tableX + colW[0] + colW[1] + colW[2] + colW[3] + 3, y, 7, line.discount_rate ? `${moneyFr(line.discount_rate)}%` : "0,00%", false, "right", colW[4] - 6));
      commands.push(pdfTextLine(tableX + colW[0] + colW[1] + colW[2] + colW[3] + colW[4] + 3, y, 7, moneyFr(lineHtAmount(line)), false, "right", colW[5] - 6));
      commands.push(pdfTextLine(tableX + colW[0] + colW[1] + colW[2] + colW[3] + colW[4] + colW[5] + 3, y, 7, line.vat_rate ? `${moneyFr(line.vat_rate)}%` : `${moneyFr(vatRate)}%`, false, "right", colW[6] - 6));
      y -= 60;
    }
    if (pageIndex === chunks.length - 1) {
      pdfCell(commands, tableX, 166, colW[0] + colW[1], 14, `Total General : ${printableLines.length || invoice.totalPositions || 0} Position(s)`, { bold: true, size: 8 });
      pdfCell(commands, tableX + colW[0] + colW[1], 166, colW[2], 14, moneyFr(printableLines.reduce((sum, line) => sum + lineTaxableQuantity(line), 0)), { bold: true, align: "right", size: 8 });
      pdfCell(commands, tableX + colW[0] + colW[1] + colW[2], 166, colW[3], 14, "", { bold: true, align: "right", size: 8 });
      pdfCell(commands, tableX + colW[0] + colW[1] + colW[2] + colW[3], 166, colW[4], 14, "", { bold: true, align: "right", size: 8 });
      pdfCell(commands, tableX + colW[0] + colW[1] + colW[2] + colW[3] + colW[4], 166, colW[5], 14, moneyFr(ht), { bold: true, align: "right", size: 8 });
      pdfCell(commands, tableX + colW[0] + colW[1] + colW[2] + colW[3] + colW[4] + colW[5], 166, colW[6], 14, "", { bold: true, align: "right", size: 8 });

      pdfCell(commands, 45, 118, 56, 14, "Facture N", { fillGray: 0.9, bold: true, align: "center", size: 7 });
      pdfCell(commands, 101, 118, 56, 14, "Date", { fillGray: 0.9, bold: true, align: "center", size: 7 });
      pdfCell(commands, 157, 118, 56, 14, "Client", { fillGray: 0.9, bold: true, align: "center", size: 7 });
      pdfCell(commands, 213, 118, 56, 14, "TTC EUR", { fillGray: 0.9, bold: true, align: "center", size: 7 });
      pdfCell(commands, 45, 104, 56, 14, invoice.invoiceNumber || "", { bold: true, align: "center", size: 7 });
      pdfCell(commands, 101, 104, 56, 14, new Date(invoice.invoiceDate || Date.now()).toLocaleDateString("fr-FR"), { align: "center", size: 7 });
      pdfCell(commands, 157, 104, 56, 14, invoice.accountCode || "", { align: "center", size: 7 });
      pdfCell(commands, 213, 104, 56, 14, moneyFr(ttc), { align: "right", size: 7 });
      commands.push(pdfTextLine(45, 84, 6, "CC RHONE ALPES", true));
      commands.push(pdfTextLine(45, 75, 6, "BANQUE     GUICHET        N DE COMPTE      CLE RIB"));
      commands.push(pdfTextLine(45, 66, 6, "13925      00200          080107082536     44"));
      commands.push(pdfTextLine(45, 57, 6, "IBAN FR 76 1395 2002 0008 0107 0825 344"));

      pdfCell(commands, 315, 132, 70, 14, "REMISE H.T.", { fillGray: 0.9, bold: true, align: "center", size: 7 });
      pdfCell(commands, 385, 132, 56, 14, "Taux", { fillGray: 0.9, bold: true, align: "center", size: 7 });
      pdfCell(commands, 441, 132, 76, 14, "TVA", { fillGray: 0.9, bold: true, align: "center", size: 7 });
      pdfCell(commands, 517, 132, 56, 14, "TTC", { fillGray: 0.9, bold: true, align: "center", size: 7 });
      pdfCell(commands, 315, 104, 70, 28, "", {});
      pdfCell(commands, 385, 104, 56, 28, "", {});
      pdfCell(commands, 441, 104, 76, 28, "", {});
      pdfCell(commands, 517, 104, 56, 28, "", {});
      pdfCell(commands, 315, 90, 70, 14, "soit H.T.", { fillGray: 0.9, bold: true, align: "center", size: 7 });
      pdfCell(commands, 385, 90, 56, 14, "Taux", { fillGray: 0.9, bold: true, align: "center", size: 7 });
      pdfCell(commands, 441, 90, 76, 14, "TVA", { fillGray: 0.9, bold: true, align: "center", size: 7 });
      pdfCell(commands, 517, 90, 56, 14, "TTC", { fillGray: 0.9, bold: true, align: "center", size: 7 });
      pdfCell(commands, 315, 62, 70, 28, moneyFr(ht), { align: "right", size: 8 });
      pdfCell(commands, 385, 62, 56, 28, `${moneyFr(vatRate)}%`, { align: "right", size: 8 });
      pdfCell(commands, 441, 62, 76, 28, moneyFr(vat), { align: "right", size: 8 });
      pdfCell(commands, 517, 62, 56, 28, moneyFr(ttc), { align: "right", size: 8 });
    }
    return commands.join("\n");
  });
  return buildPdfBuffer(pages, logoImage ? [logoImage] : []);
}

async function loadInvoiceDocument(invoiceId) {
  const invoice = await pool.query(
    `
      SELECT
        bi.*,
        tc.billing_name, tc.billing_address1, tc.billing_address2, tc.billing_address3,
        tc.billing_postal_code, tc.billing_city, tc.billing_country_code,
        tc.vat_number,
        tc.address1 AS customer_address1, tc.address2 AS customer_address2, tc.address3 AS customer_address3,
        tc.postal_code AS customer_postal_code, tc.city AS customer_city, tc.country_code AS customer_country_code
      FROM billing_invoices bi
      LEFT JOIN transport_customers tc ON tc.id = bi.customer_id
      WHERE bi.id = $1
    `,
    [invoiceId],
  );
  const lines = await pool.query(
    `
      SELECT bil.*, null AS matched_receipt_no
      FROM billing_invoice_lines bil
      WHERE bil.invoice_id = $1
      ORDER BY bil.line_number ASC NULLS LAST, bil.id ASC
    `,
    [invoiceId],
  );
  return { invoice: invoiceFromRow(invoice.rows[0]), lines: lines.rows };
}

function smtpAddress(value) {
  const text = normalizeText(value);
  if (!text || /[\r\n<>]/.test(text)) return null;
  return text;
}

function smtpDotStuff(value) {
  return String(value || "").replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

function base64Lines(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/.{1,76}/g, "$&\r\n").trim();
}

function mimeHeader(value) {
  const text = String(value || "").replace(/[\r\n]+/g, " ").trim();
  return /[^\x20-\x7E]/.test(text) ? `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=` : text;
}

function prepareInlineImages(html) {
  const inlineImages = [];
  let index = 0;
  let bodyHtml = String(html || "").replace(/<img\b([^>]*?)\bsrc=["']data:([^;"']+)(?:;base64)?,([^"']+)["']([^>]*)>/gi, (match, before, mimeType, data, after) => {
    const cid = `signature-${Date.now()}-${index}@mytracking`;
    index += 1;
    inlineImages.push({
      cid,
      filename: `signature-${index}.${String(mimeType).split("/")[1] || "bin"}`,
      contentType: mimeType,
      content: Buffer.from(data.replace(/\s/g, ""), "base64"),
    });
    return `<img${before}src="cid:${cid}"${after}>`;
  });
  bodyHtml = bodyHtml.replace(/<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>/gi, (match, before, src, after) => {
    const source = String(src || "");
    if (/^(cid:|https?:|data:)/i.test(source)) return match;
    const relative = source.startsWith("/") ? source.slice(1) : source;
    const resolved = path.resolve(staticRoot, relative);
    const staticBase = path.resolve(staticRoot);
    if (!resolved.startsWith(staticBase) || !fs.existsSync(resolved)) return match;
    const cid = `signature-${Date.now()}-${index}@mytracking`;
    index += 1;
    inlineImages.push({
      cid,
      filename: path.basename(resolved),
      contentType: contentTypeFromPath(resolved).split(";")[0],
      content: fs.readFileSync(resolved),
    });
    return `<img${before}src="cid:${cid}"${after}>`;
  });
  return { html: bodyHtml, inlineImages };
}

async function sendSmtpMail({ host, port, from, to, subject, html, password, attachments = [] }) {
  const smtpHost = normalizeText(host);
  const smtpPort = Number(port || 465);
  const fromAddress = smtpAddress(from);
  const toAddress = smtpAddress(to);
  const smtpPassword = normalizeText(password);
  if (!smtpHost || !fromAddress || !toAddress || !smtpPassword) throw new Error("Configuration SMTP incomplete.");
  const prepared = prepareInlineImages(html);
  const mixedBoundary = `mixed_${crypto.randomBytes(12).toString("hex")}`;
  const relatedBoundary = `related_${crypto.randomBytes(12).toString("hex")}`;
  const htmlPart = [
    `--${relatedBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    prepared.html,
    "",
    ...prepared.inlineImages.flatMap((image) => [
      `--${relatedBoundary}`,
      `Content-Type: ${image.contentType}; name="${image.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-ID: <${image.cid}>`,
      "Content-Disposition: inline",
      "",
      base64Lines(image.content),
      "",
    ]),
    `--${relatedBoundary}--`,
  ].join("\r\n");
  const attachmentParts = attachments.flatMap((attachment) => [
    `--${mixedBoundary}`,
    `Content-Type: ${attachment.contentType || "application/octet-stream"}; name="${mimeHeader(attachment.filename)}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${mimeHeader(attachment.filename)}"`,
    "",
    base64Lines(attachment.content),
    "",
  ]);

  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: smtpHost, port: smtpPort, servername: smtpHost, rejectUnauthorized: true });
    let buffer = "";
    let settled = false;
    let dataResponse = "";
    const cleanup = () => socket.removeAllListeners();
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    };
    const waitResponse = () => new Promise((responseResolve, responseReject) => {
      const timer = setTimeout(() => responseReject(new Error("Timeout SMTP.")), 15000);
      const onData = (chunk) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split(/\r?\n/).filter(Boolean);
        if (!lines.length) return;
        const last = lines[lines.length - 1];
        if (!/^\d{3} /.test(last)) return;
        const response = buffer.trim();
        buffer = "";
        clearTimeout(timer);
        socket.off("data", onData);
        responseResolve(response);
      };
      socket.on("data", onData);
    });
    const writeCommand = async (command, expected) => {
      socket.write(`${command}\r\n`);
      const response = await waitResponse();
      if (!expected.some((code) => response.startsWith(String(code)))) {
        throw new Error(`SMTP ${response.split(/\r?\n/).pop()}`);
      }
      return response;
    };
    socket.setTimeout(30000, () => fail(new Error("Timeout SMTP.")));
    socket.on("error", fail);
    socket.on("secureConnect", async () => {
      try {
        let response = await waitResponse();
        if (!response.startsWith("220")) throw new Error(`SMTP ${response.split(/\r?\n/).pop()}`);
        await writeCommand("EHLO mytracking-beta", [250]);
        await writeCommand("AUTH LOGIN", [334]);
        await writeCommand(Buffer.from(fromAddress, "utf8").toString("base64"), [334]);
        await writeCommand(Buffer.from(smtpPassword, "utf8").toString("base64"), [235]);
        await writeCommand(`MAIL FROM:<${fromAddress}>`, [250]);
        await writeCommand(`RCPT TO:<${toAddress}>`, [250, 251]);
        await writeCommand("DATA", [354]);
        const message = [
          `From: ${mimeHeader("SGA Facturation")} <${fromAddress}>`,
          `To: <${toAddress}>`,
          `Subject: ${mimeHeader(subject)}`,
          "MIME-Version: 1.0",
          `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
          `Date: ${new Date().toUTCString()}`,
          "",
          `--${mixedBoundary}`,
          `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
          "",
          htmlPart,
          "",
          ...attachmentParts,
          `--${mixedBoundary}--`,
          ".",
        ].join("\r\n");
        socket.write(`${message}\r\n`);
        dataResponse = await waitResponse();
        if (!dataResponse.startsWith("250")) throw new Error(`SMTP ${dataResponse.split(/\r?\n/).pop()}`);
        await writeCommand("QUIT", [221]);
        if (settled) return;
        settled = true;
        cleanup();
        socket.end();
        resolve(dataResponse.split(/\r?\n/).pop());
      } catch (error) {
        fail(error);
      }
    });
  });
}

async function sendTestInvoiceDispatch(req, res) {
  await ensureBillingSchema();
  await ensureStaffSchema();
  const body = await readJsonBody(req);
  if (body.__invalidJson) return sendJson(res, 400, { error: "JSON invalide." });

  const session = clientSessionFromRequest(req);
  const requestedActor = normalizeText(body.actor);
  const sessionEmail = normalizeText(session?.email);
  const testRecipient = "jurgielewicz.mikael@orange.fr";
  const limit = 4;
  const forceTest = body.forceTest === true;
  const staff = await getStaffByActor(sessionEmail) || await getStaffByActor(requestedActor);
  const actor = staff?.email || sessionEmail || requestedActor || "Client SGA";

  const result = await pool.query(
    `
      SELECT
        bi.id,
        bi.company_id,
        bi.invoice_number,
        bi.invoice_date,
        bi.customer_id,
        bi.customer_name,
        bi.account_code,
        bi.is_credit_note,
        bi.total_ht,
        tc.billing_email,
        tc.contact_email,
        tc.email
      FROM billing_invoices bi
      LEFT JOIN transport_customers tc ON tc.id = bi.customer_id
      WHERE bi.sent_to_client = false
      ORDER BY lower(coalesce(bi.customer_name, '')), bi.invoice_date ASC NULLS LAST, bi.invoice_number ASC
    `,
  );
  if (!result.rowCount) return sendJson(res, 404, { error: "Aucune facture ou avoir en attente." });

  const groupsByKey = new Map();
  for (const row of result.rows) {
    const key = row.customer_id ? `customer:${row.customer_id}` : `account:${row.account_code || row.customer_name || "unknown"}`;
    if (!groupsByKey.has(key)) {
      groupsByKey.set(key, {
        key,
        customerName: row.customer_name || "Client non renseigne",
        originalRecipients: invoiceRecipientEmails(row.billing_email, row.contact_email, row.email),
        rows: [],
      });
    }
    groupsByKey.get(key).rows.push(row);
  }
  const groups = Array.from(groupsByKey.values()).slice(0, limit);
  if (!groups.length) return sendJson(res, 404, { error: "Aucun groupe client en attente." });

  let smtpPassword = null;
  try {
    smtpPassword = staff?.mail_password_encrypted ? decryptSecret(staff.mail_password_encrypted) : null;
  } catch (error) {
    smtpPassword = null;
  }
  const smtpReady = Boolean(staff?.smtp_server && staff?.email && smtpPassword);

  const mailResults = [];
  for (const group of groups) {
    const rows = group.rows;
    const subject = invoiceDispatchSubject(rows);
    const bodyHtml = invoiceDispatchBodyHtml(rows, staff);
    const attachments = [];
    for (const row of rows) {
      const document = await loadInvoiceDocument(row.id);
      attachments.push({
        filename: `${row.is_credit_note ? "Avoir" : "Facture"}-${String(row.invoice_number || row.id).replace(/[^A-Za-z0-9_-]/g, "")}.pdf`,
        contentType: "application/pdf",
        content: generateInvoicePdf(document.invoice, document.lines),
      });
    }
    let status = smtpReady ? "ready_to_send" : "prepared";
    let technicalMessage = smtpReady
      ? "Demande prete pour le connecteur SMTP serveur."
      : "Demande enregistree. Envoi SMTP reel non declenche car le mot de passe SMTP chiffre n'est pas disponible cote serveur.";
    const payload = {
      test: true,
      limit,
      groupKey: group.key,
      customerName: group.customerName,
      recipientLocked: true,
      originalRecipients: group.originalRecipients,
      originalRecipientsIgnored: true,
      sentToClientUpdated: false,
      documentIds: rows.map((row) => row.id),
      attachments: attachments.map((attachment) => ({ filename: attachment.filename, contentType: attachment.contentType })),
    };

    const recentDuplicate = await pool.query(
      `
        SELECT count(DISTINCT invoice_id)::int AS sent_count
        FROM billing_invoice_mail_dispatches
        WHERE dispatch_mode = 'test'
          AND recipient_email = $1
          AND status = 'sent'
          AND invoice_id = ANY($2::bigint[])
          AND created_at > now() - interval '10 minutes'
      `,
      [testRecipient, rows.map((row) => row.id)],
    );
    const duplicateSent = Number(recentDuplicate.rows[0]?.sent_count || 0) >= rows.length;

    if (duplicateSent && !forceTest) {
      status = "skipped";
      technicalMessage = "Envoi test ignore : ce lot a deja ete envoye dans les 10 dernieres minutes.";
      payload.smtp = { host: staff?.smtp_server, port: staff?.smtp_port, sent: false, skippedDuplicate: true };
    } else if (smtpReady) {
      try {
        const providerResponse = await sendSmtpMail({
          host: staff.smtp_server,
          port: staff.smtp_port,
          from: staff.email,
          to: testRecipient,
          subject: `[TEST] ${subject}`,
          html: bodyHtml,
          password: smtpPassword,
          attachments,
        });
        status = "sent";
        technicalMessage = `Email test envoye via SMTP. ${providerResponse || ""}`.trim();
        payload.smtp = { host: staff.smtp_server, port: staff.smtp_port, sent: true };
      } catch (error) {
        status = "failed";
        technicalMessage = `Echec SMTP : ${error.message}`;
        payload.smtp = { host: staff?.smtp_server, port: staff?.smtp_port, sent: false };
      }
    }
    mailResults.push({ group, rows, subject, bodyHtml, status, technicalMessage, payload });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const history = [];
    for (const mailResult of mailResults) {
      for (const row of mailResult.rows) {
        const inserted = await client.query(
          `
            INSERT INTO billing_invoice_mail_dispatches (
              company_id, invoice_id, staff_id, document_type, invoice_number, recipient_email,
              subject, body_html, total_ht, status, technical_message, dispatch_mode, created_by, payload
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'test', $12, $13::jsonb)
            RETURNING id, invoice_id, invoice_number, document_type, status, created_at
          `,
          [
            row.company_id,
            row.id,
            staff?.id || null,
            row.is_credit_note ? "credit_note" : "invoice",
            row.invoice_number,
            testRecipient,
            mailResult.subject,
            mailResult.bodyHtml,
            row.total_ht,
            mailResult.status,
            mailResult.technicalMessage,
            actor,
            JSON.stringify(mailResult.payload),
          ],
        );
        history.push(inserted.rows[0]);
      }
    }
    await client.query("COMMIT");
    const sentCount = mailResults.filter((item) => item.status === "sent").length;
    const failedCount = mailResults.filter((item) => item.status === "failed").length;
    const preparedCount = mailResults.filter((item) => item.status === "prepared").length;
    const skippedCount = mailResults.filter((item) => item.status === "skipped").length;
    const status = failedCount ? "failed" : preparedCount ? "prepared" : skippedCount && !sentCount ? "skipped" : "sent";
    sendJson(res, 200, {
      dispatch: {
        mode: "test",
        recipientEmail: testRecipient,
        subject: `${mailResults.length} mail(s) facture test`,
        bodyHtml: mailResults.map((item) => item.bodyHtml).join("<hr>"),
        status,
        technicalMessage: `${sentCount} mail(s) envoye(s), ${failedCount} en echec, ${preparedCount} prepare(s), ${skippedCount} ignore(s) anti-doublon.`,
        mailCount: mailResults.length,
        documentCount: mailResults.reduce((sum, item) => sum + item.rows.length, 0),
        totalHt: mailResults.reduce((sum, item) => sum + invoiceDispatchTotalHt(item.rows), 0),
        sentToClientUpdated: false,
        history,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getInvoice(req, res, id) {
  await ensureBillingSchema();
  const invoice = await pool.query(
    `
      SELECT
        bi.*,
        tc.billing_name,
        tc.billing_address1,
        tc.billing_address2,
        tc.billing_address3,
        tc.billing_postal_code,
        tc.billing_city,
        tc.billing_country_code,
        tc.billing_phone,
        tc.billing_email,
        tc.vat_number,
        tc.address1 AS customer_address1,
        tc.address2 AS customer_address2,
        tc.address3 AS customer_address3,
        tc.postal_code AS customer_postal_code,
        tc.city AS customer_city,
        tc.country_code AS customer_country_code
      FROM billing_invoices bi
      LEFT JOIN transport_customers tc ON tc.id = bi.customer_id
      WHERE bi.id = $1
    `,
    [id],
  );
  if (!invoice.rowCount) return sendJson(res, 404, { error: "Facture introuvable." });
  const lines = await pool.query(
    `
      SELECT
        bil.*,
        match.receipt_no AS matched_receipt_no,
        ts.id AS shipment_id,
        ts.vat_amount AS shipment_vat_amount,
        ts.transport_amount AS shipment_transport_amount,
        ts.invoice_number AS shipment_invoice_number,
        ts.sender_name AS shipment_sender_name,
        ts.recipient_name AS shipment_recipient_name
      FROM billing_invoice_lines bil
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          substring(coalesce(bil.identifier, '') FROM '(0[0-9]{5,})'),
          substring(coalesce(bil.description, '') FROM '(0[0-9]{5,})')
        ) AS receipt_no
      ) match ON true
      LEFT JOIN billing_invoices bi ON bi.id = bil.invoice_id
      LEFT JOIN transport_shipments ts ON ts.company_id = bi.company_id AND ts.receipt_no = match.receipt_no
      WHERE bil.invoice_id = $1
      ORDER BY bil.line_number ASC NULLS LAST, bil.id ASC
    `,
    [id],
  );
  const invoiceData = invoiceFromRow(invoice.rows[0]);
  const rows = lines.rows;
  const htTotal = Number(invoiceData.totalHt || 0);
  const vatTotal = Number(invoiceData.totalVat || 0);
  const sign = invoiceData.isCreditNote ? -1 : 1;
  const amountSum = rows.reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0);
  let distributedVat = 0;
  const enrichedRows = rows.map((row, index) => {
    const amount = Math.abs(Number(row.amount || 0));
    const lineVat = Number(row.shipment_vat_amount || 0) || Number(row.vat_amount || 0);
    let computedVat = lineVat;
    if (!computedVat && vatTotal && amountSum) {
      computedVat = index === rows.length - 1
        ? Math.round((Math.abs(vatTotal) - distributedVat) * 100) / 100
        : Math.round((Math.abs(vatTotal) * amount / amountSum) * 100) / 100;
      distributedVat += computedVat;
    }
    const signedAmount = sign * amount;
    row.amount = signedAmount;
    row.computed_vat_amount = sign * computedVat;
    row.computed_amount_ttc = sign * (amount + computedVat);
    row.vat_rate = amount ? Math.round((computedVat / amount) * 10000) / 100 : row.vat_rate;
    if (!row.amount_ttc || Number(row.amount_ttc) === 0) row.amount_ttc = row.computed_amount_ttc;
    return row;
  });
  const lineHt = enrichedRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const lineVat = enrichedRows.reduce((sum, row) => sum + Number(row.computed_vat_amount || 0), 0);
  const lineTtc = enrichedRows.reduce((sum, row) => sum + Number(row.computed_amount_ttc || 0), 0);
  sendJson(res, 200, {
    invoice: invoiceData,
    lines: enrichedRows.map(invoiceLineFromRow),
    lineTotals: {
      ht: Math.round(lineHt * 100) / 100,
      vat: Math.round(lineVat * 100) / 100,
      ttc: Math.round(lineTtc * 100) / 100,
      alignedWithHeader: Math.round(lineHt * 100) / 100 === Math.round(sign * htTotal * 100) / 100
        && Math.round(lineVat * 100) / 100 === Math.round(sign * vatTotal * 100) / 100,
    },
  });
}

async function getCharteringConfirmation(req, res, id) {
  await ensureShipmentSchema();
  await ensureStaffSchema();
  const result = await pool.query(
    `
      SELECT
        ts.*,
        to_char(ts.legacy_created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS legacy_created_at,
        c.name AS company_name,
        c.code AS company_code,
        c.siret AS company_siret,
        c.vat_number AS company_vat_number,
        c.address1 AS company_address1,
        c.address2 AS company_address2,
        c.address3 AS company_address3,
        c.postal_code AS company_postal_code,
        c.city AS company_city,
        c.phone AS company_phone,
        c.email AS company_email,
        c.logo_url AS company_logo_url,
        c.notes AS company_notes,
        cst.name AS customer_name,
        payer.name AS payer_name,
        COALESCE(ts.product_name, tp.label) AS product_name,
        COALESCE(ts.carrier_name, tc.name) AS carrier_name,
        tc.address1 AS carrier_address1,
        tc.address2 AS carrier_address2,
        tc.address3 AS carrier_address3,
        tc.country_code AS carrier_country_code,
        tc.postal_code AS carrier_postal_code,
        tc.city AS carrier_city,
        tc.phone AS carrier_phone,
        tc.email AS carrier_email,
        tc.vat_number AS carrier_vat_number,
        tc.siret AS carrier_siret,
        contact.display_name AS carrier_contact_name,
        contact.email AS carrier_contact_email,
        contact.carrier_contact_names,
        sm.id AS staff_id,
        sm.display_name AS staff_display_name,
        sm.email AS staff_email,
        sm.phone AS staff_phone,
        sm.smtp_server AS staff_smtp_server,
        sm.smtp_port AS staff_smtp_port,
        sm.mail_signature_html AS staff_mail_signature_html,
        sm.mail_password_configured AS staff_mail_password_configured
      FROM transport_shipments ts
      JOIN companies c ON c.id = ts.company_id
      LEFT JOIN transport_customers cst ON cst.id = ts.customer_id
      LEFT JOIN transport_customers payer ON payer.id = ts.payer_customer_id
      LEFT JOIN transport_products tp ON tp.company_id = ts.company_id AND tp.code = ts.product_code
      LEFT JOIN transport_carriers tc ON tc.company_id = ts.company_id AND tc.legacy_id = ts.carrier_legacy_id
      LEFT JOIN staff_members sm ON sm.company_id = ts.company_id
        AND (
          upper(sm.first_name) = CASE
            WHEN upper(coalesce(ts.legacy_created_by, '')) IN ('ELO', 'ELODIE') THEN 'ELODIE'
            ELSE upper(coalesce(ts.legacy_created_by, ''))
          END
          OR upper(sm.display_name) = CASE
            WHEN upper(coalesce(ts.legacy_created_by, '')) IN ('ELO', 'ELODIE') THEN 'ELODIE'
            ELSE upper(coalesce(ts.legacy_created_by, ''))
          END
          OR upper(sm.legacy_id) = upper(coalesce(ts.legacy_created_by, ''))
        )
      LEFT JOIN LATERAL (
        SELECT
          min(NULLIF(tcc.display_name, '')) AS display_name,
          min(NULLIF(tcc.email, '')) AS email,
          string_agg(DISTINCT NULLIF(tcc.display_name, ''), ', ' ORDER BY NULLIF(tcc.display_name, '')) AS carrier_contact_names
        FROM transport_carrier_contacts tcc
        WHERE tcc.carrier_id = tc.id
      ) contact ON true
      WHERE ts.id = $1
    `,
    [id],
  );
  if (!result.rowCount) return sendJson(res, 404, { error: "Affretement introuvable." });
  const row = result.rows[0];
  if (!row.is_chartering) return sendJson(res, 400, { error: "Cette expedition n'est pas un affretement." });
  sendJson(res, 200, {
    company: {
      name: row.company_name,
      code: row.company_code,
      siret: row.company_siret,
      vatNumber: row.company_vat_number,
      address1: row.company_address1,
      address2: row.company_address2,
      address3: row.company_address3,
      postalCode: row.company_postal_code,
      city: row.company_city,
      phone: row.company_phone,
      email: row.company_email,
      logoUrl: row.company_logo_url,
      notes: row.company_notes,
    },
    shipment: shipmentFromRow(row),
    interlocutor: {
      id: row.staff_id,
      name: row.staff_display_name || row.legacy_created_by,
      email: row.staff_email,
      phone: row.staff_phone,
      smtpServer: row.staff_smtp_server,
      smtpPort: row.staff_smtp_port,
      mailSignatureHtml: row.staff_mail_signature_html,
      mailPasswordConfigured: row.staff_mail_password_configured,
    },
    carrier: {
      legacyId: row.carrier_legacy_id,
      name: row.carrier_name,
      address1: row.carrier_address1,
      address2: row.carrier_address2,
      address3: row.carrier_address3,
      countryCode: row.carrier_country_code,
      postalCode: row.carrier_postal_code,
      city: row.carrier_city,
      phone: row.carrier_phone,
      email: row.carrier_email,
      vatNumber: row.carrier_vat_number,
      siret: row.carrier_siret,
    },
    contact: {
      displayName: row.carrier_contact_name,
      email: row.carrier_contact_email,
      names: row.carrier_contact_names,
    },
  });
}

async function getStaffByActor(actor) {
  await ensureStaffSchema();
  const normalized = normalizeText(actor);
  if (!normalized) return null;
  const key = normalized.toUpperCase() === "ELO" ? "ELODIE" : normalized.toUpperCase();
  const canonicalEmail = canonicalStaffEmail(normalized);
  const result = await pool.query(
    `
      SELECT s.*
      FROM staff_members s
      JOIN companies c ON c.id = s.company_id
      WHERE c.legacy_id = 1970324836974592001
        AND (
          upper(s.first_name) = $1
          OR upper(s.display_name) = $1
          OR upper(s.login) = $1
          OR upper(s.legacy_id) = $1
          OR lower(s.email) = lower($2)
          OR lower(s.email) = lower($3)
        )
      ORDER BY CASE WHEN upper(s.first_name) = $1 THEN 0 ELSE 1 END, s.display_name ASC
      LIMIT 1
    `,
    [key, normalized, canonicalEmail],
  );
  return result.rows[0] || null;
}

async function getCurrentStaff(req, res, url) {
  const session = clientSessionFromRequest(req);
  const staff = await getStaffByActor(session?.email) || await getStaffByActor(url.searchParams.get("actor"));
  if (!staff) return sendJson(res, 404, { error: "Personnel introuvable." });
  sendJson(res, 200, { staff: staffFromRow(staff) });
}

async function sendCharteringConfirmation(req, res, id) {
  await ensureShipmentSchema();
  await ensureStaffSchema();
  const body = await readJsonBody(req);
  if (body.__invalidJson) return sendJson(res, 400, { error: "JSON invalide." });
  const recipientEmail = normalizeText(body.recipientEmail);
  const subject = normalizeText(body.subject);
  const bodyHtml = normalizeText(body.bodyHtml);
  const session = clientSessionFromRequest(req);
  const requestedActor = normalizeText(body.actor);
  const sessionEmail = normalizeText(session?.email);
  const staff = await getStaffByActor(sessionEmail) || await getStaffByActor(requestedActor);
  const actor = staff?.email || sessionEmail || requestedActor || "Client SGA";
  if (!recipientEmail || !subject || !bodyHtml) {
    return sendJson(res, 400, { error: "Destinataire, sujet et corps du mail sont obligatoires." });
  }

  const shipment = await pool.query(
    "SELECT id, is_chartering FROM transport_shipments WHERE id = $1",
    [id],
  );
  if (!shipment.rowCount) return sendJson(res, 404, { error: "Affretement introuvable." });
  if (!shipment.rows[0].is_chartering) return sendJson(res, 400, { error: "Cette expedition n'est pas un affretement." });

  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  const smtpReady = Boolean(staff?.smtp_server && staff?.email && staff?.mail_password_configured);
  const status = smtpReady ? "ready_to_send" : "prepared";
  const technicalMessage = smtpReady
    ? "Demande prete pour le connecteur SMTP serveur."
    : "Demande enregistree. Envoi SMTP reel non declenche car le mot de passe SMTP n'est pas disponible cote serveur.";

  const inserted = await pool.query(
    `
      INSERT INTO transport_document_mail_dispatches (
        shipment_id, staff_id, document_type, recipient_email, cc_email, subject,
        body_html, attachments, status, technical_message, created_by
      )
      VALUES ($1, $2, 'chartering_confirmation', $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
      RETURNING id, status, technical_message, created_at
    `,
    [
      id,
      staff?.id || null,
      recipientEmail,
      normalizeText(body.ccEmail),
      subject,
      bodyHtml,
      JSON.stringify(attachments),
      status,
      technicalMessage,
      actor,
    ],
  );
  await pool.query(
    "INSERT INTO transport_shipment_change_events (shipment_id, changed_by, action, changes) VALUES ($1, $2, 'mail_confirmation', $3::jsonb)",
    [id, actor, JSON.stringify({ recipientEmail, subject, status, attachments })],
  );
  sendJson(res, 200, { dispatch: inserted.rows[0] });
}

async function getShipmentHistory(req, res, id) {
  await ensureShipmentSchema();
  const result = await pool.query(
    "SELECT id, changed_at, changed_by, action, changes FROM transport_shipment_change_events WHERE shipment_id = $1 ORDER BY changed_at DESC, id DESC LIMIT 100",
    [id],
  );
  sendJson(res, 200, {
    events: result.rows.map((row) => ({
      id: row.id,
      changedAt: row.changed_at,
      changedBy: row.changed_by,
      action: row.action,
      changes: row.changes,
    })),
  });
}

async function listPerformanceAnalytics(req, res, url) {
  await ensureShipmentSchema();
  const range = analyticsRange(url);
  const requestedCreator = normalizeText(url.searchParams.get("creator"));
  const selectedCreator = requestedCreator
    ? (requestedCreator.toUpperCase() === "ELO" ? "ELODIE" : requestedCreator.toUpperCase())
    : null;
  const rangeParams = [range.dateFrom, range.dateTo];
  const previousRangeParams = [range.previousFrom, range.previousTo];
  const metricParams = [range.dateFrom, range.dateTo, selectedCreator];
  const previousMetricParams = [range.previousFrom, range.previousTo, selectedCreator];
  const periodBuckets = analyticsPeriodBuckets(range);
  const periodValues = periodBuckets.map((bucket, index) => {
    const offset = index * 4;
    return `($${offset + 1}::int, $${offset + 2}::text, $${offset + 3}::date, $${offset + 4}::date)`;
  }).join(", ");
  const periodParams = periodBuckets.flatMap((bucket, index) => [index, bucket.label, bucket.dateFrom, bucket.dateTo]).concat(selectedCreator);
  const periodCreatorParam = periodBuckets.length * 4 + 1;
  const creatorKeySql = (alias) => `
    CASE
      WHEN upper(coalesce(${alias}.legacy_created_by, '')) IN ('ELO', 'ELODIE') THEN 'ELODIE'
      WHEN upper(coalesce(${alias}.legacy_created_by, '')) = '' THEN 'NON RENSEIGNE'
      ELSE upper(coalesce(${alias}.legacy_created_by, ''))
    END
  `;
  const creatorFilterSql = `AND ($3::text IS NULL OR ${creatorKeySql("ts")} = $3::text)`;
  const currentWhere = `ts.departure_date >= $1::date AND ts.departure_date <= $2::date ${creatorFilterSql}`;
  const totalsSql = (whereClause) => `
    SELECT
      count(*)::int AS shipments,
      coalesce(sum(coalesce(ts.transport_amount, 0)), 0)::numeric(14, 2) AS revenue,
      coalesce(sum(coalesce(ts.agreed_price, 0)), 0)::numeric(14, 2) AS purchase,
      coalesce(sum(coalesce(ts.transport_amount, 0) - coalesce(ts.agreed_price, 0)), 0)::numeric(14, 2) AS margin
    FROM transport_shipments ts
    JOIN companies c ON c.id = ts.company_id
    WHERE c.legacy_id = 1970324836974592001
      AND ${whereClause}
  `;
  const [
    totalsResult,
    previousTotalsResult,
    staffResult,
    staffDailyResult,
    topShipmentsResult,
    periodSeriesResult,
    topRevenueResult,
    dailyResult,
    statusResult,
    productResult,
  ] = await Promise.all([
    pool.query(totalsSql(currentWhere), metricParams),
    pool.query(totalsSql(currentWhere), previousMetricParams),
    pool.query(
      `
        WITH filtered AS (
          SELECT
            ts.*,
            CASE
              WHEN upper(coalesce(ts.legacy_created_by, '')) IN ('ELO', 'ELODIE') THEN 'ELODIE'
              WHEN upper(coalesce(ts.legacy_created_by, '')) = '' THEN 'NON RENSEIGNE'
              ELSE upper(coalesce(ts.legacy_created_by, ''))
            END AS creator_key
          FROM transport_shipments ts
          JOIN companies c ON c.id = ts.company_id
          WHERE c.legacy_id = 1970324836974592001
            AND ts.departure_date >= $1::date
            AND ts.departure_date <= $2::date
        )
        SELECT
          f.creator_key,
          coalesce(max(sm.display_name), initcap(lower(f.creator_key))) AS display_name,
          count(*)::int AS shipments,
          coalesce(sum(coalesce(f.transport_amount, 0)), 0)::numeric(14, 2) AS revenue,
          coalesce(sum(coalesce(f.agreed_price, 0)), 0)::numeric(14, 2) AS purchase,
          coalesce(sum(coalesce(f.transport_amount, 0) - coalesce(f.agreed_price, 0)), 0)::numeric(14, 2) AS margin
        FROM filtered f
        LEFT JOIN staff_members sm ON sm.company_id = f.company_id
          AND (
            upper(sm.first_name) = f.creator_key
            OR upper(sm.display_name) = f.creator_key
            OR (f.creator_key = 'ELODIE' AND upper(sm.first_name) = 'ELODIE')
          )
        GROUP BY f.creator_key
        ORDER BY margin DESC, shipments DESC
      `,
      rangeParams,
    ),
    pool.query(
      `
        WITH filtered AS (
          SELECT
            ts.*,
            CASE
              WHEN upper(coalesce(ts.legacy_created_by, '')) IN ('ELO', 'ELODIE') THEN 'ELODIE'
              WHEN upper(coalesce(ts.legacy_created_by, '')) = '' THEN 'NON RENSEIGNE'
              ELSE upper(coalesce(ts.legacy_created_by, ''))
            END AS creator_key
          FROM transport_shipments ts
          JOIN companies c ON c.id = ts.company_id
          WHERE c.legacy_id = 1970324836974592001
            AND ts.departure_date >= $1::date
            AND ts.departure_date <= $2::date
        )
        SELECT
          f.creator_key,
          coalesce(max(sm.display_name), initcap(lower(f.creator_key))) AS display_name,
          to_char(f.departure_date, 'YYYY-MM-DD') AS day,
          count(*)::int AS shipments,
          coalesce(sum(coalesce(f.transport_amount, 0)), 0)::numeric(14, 2) AS revenue,
          coalesce(sum(coalesce(f.transport_amount, 0) - coalesce(f.agreed_price, 0)), 0)::numeric(14, 2) AS margin
        FROM filtered f
        LEFT JOIN staff_members sm ON sm.company_id = f.company_id
          AND (
            upper(sm.first_name) = f.creator_key
            OR upper(sm.display_name) = f.creator_key
            OR (f.creator_key = 'ELODIE' AND upper(sm.first_name) = 'ELODIE')
          )
        GROUP BY f.creator_key, f.departure_date
        ORDER BY f.creator_key, f.departure_date
      `,
      rangeParams,
    ),
    pool.query(
      `
        SELECT
          coalesce(cst.name, ts.customer_code, 'Client non renseigne') AS customer_name,
          coalesce(ts.customer_code, '') AS customer_code,
          count(*)::int AS shipments,
          coalesce(sum(coalesce(ts.transport_amount, 0)), 0)::numeric(14, 2) AS revenue,
          coalesce(sum(coalesce(ts.transport_amount, 0) - coalesce(ts.agreed_price, 0)), 0)::numeric(14, 2) AS margin
        FROM transport_shipments ts
        JOIN companies c ON c.id = ts.company_id
        LEFT JOIN transport_customers cst ON cst.id = ts.customer_id
        WHERE c.legacy_id = 1970324836974592001
          AND ts.departure_date >= $1::date
          AND ts.departure_date <= $2::date
          ${creatorFilterSql}
        GROUP BY coalesce(cst.name, ts.customer_code, 'Client non renseigne'), coalesce(ts.customer_code, '')
        ORDER BY shipments DESC, revenue DESC
        LIMIT 10
      `,
      metricParams,
    ),
    pool.query(
      `
        WITH buckets(period_index, period_label, date_from, date_to) AS (
          VALUES ${periodValues}
        )
        SELECT
          b.period_index::int,
          b.period_label,
          to_char(b.date_from, 'YYYY-MM-DD') AS date_from,
          to_char(b.date_to, 'YYYY-MM-DD') AS date_to,
          count(ts.id) FILTER (WHERE c.id IS NOT NULL)::int AS shipments,
          coalesce(sum(coalesce(ts.transport_amount, 0)) FILTER (WHERE c.id IS NOT NULL), 0)::numeric(14, 2) AS revenue,
          coalesce(sum((coalesce(ts.transport_amount, 0) - coalesce(ts.agreed_price, 0))) FILTER (WHERE c.id IS NOT NULL), 0)::numeric(14, 2) AS margin
        FROM buckets b
        LEFT JOIN transport_shipments ts ON ts.departure_date >= b.date_from
          AND ts.departure_date <= b.date_to
          AND ($${periodCreatorParam}::text IS NULL OR ${creatorKeySql("ts")} = $${periodCreatorParam}::text)
        LEFT JOIN companies c ON c.id = ts.company_id AND c.legacy_id = 1970324836974592001
        GROUP BY b.period_index, b.period_label, b.date_from, b.date_to
        ORDER BY b.period_index
      `,
      periodParams,
    ),
    pool.query(
      `
        SELECT
          coalesce(cst.name, ts.customer_code, 'Client non renseigne') AS customer_name,
          coalesce(ts.customer_code, '') AS customer_code,
          count(*)::int AS shipments,
          coalesce(sum(coalesce(ts.transport_amount, 0)), 0)::numeric(14, 2) AS revenue,
          coalesce(sum(coalesce(ts.transport_amount, 0) - coalesce(ts.agreed_price, 0)), 0)::numeric(14, 2) AS margin
        FROM transport_shipments ts
        JOIN companies c ON c.id = ts.company_id
        LEFT JOIN transport_customers cst ON cst.id = ts.customer_id
        WHERE c.legacy_id = 1970324836974592001
          AND ts.departure_date >= $1::date
          AND ts.departure_date <= $2::date
          ${creatorFilterSql}
        GROUP BY coalesce(cst.name, ts.customer_code, 'Client non renseigne'), coalesce(ts.customer_code, '')
        ORDER BY revenue DESC, shipments DESC
        LIMIT 10
      `,
      metricParams,
    ),
    pool.query(
      `
        SELECT
          to_char(ts.departure_date, 'YYYY-MM-DD') AS day,
          count(*)::int AS shipments,
          coalesce(sum(coalesce(ts.transport_amount, 0)), 0)::numeric(14, 2) AS revenue,
          coalesce(sum(coalesce(ts.transport_amount, 0) - coalesce(ts.agreed_price, 0)), 0)::numeric(14, 2) AS margin
        FROM transport_shipments ts
        JOIN companies c ON c.id = ts.company_id
        WHERE c.legacy_id = 1970324836974592001
          AND ts.departure_date >= $1::date
          AND ts.departure_date <= $2::date
          ${creatorFilterSql}
        GROUP BY ts.departure_date
        ORDER BY ts.departure_date
      `,
      metricParams,
    ),
    pool.query(
      `
        SELECT
          coalesce(NULLIF(ts.status, ''), 'non renseigne') AS label,
          count(*)::int AS value
        FROM transport_shipments ts
        JOIN companies c ON c.id = ts.company_id
        WHERE c.legacy_id = 1970324836974592001
          AND ts.departure_date >= $1::date
          AND ts.departure_date <= $2::date
          ${creatorFilterSql}
        GROUP BY coalesce(NULLIF(ts.status, ''), 'non renseigne')
        ORDER BY value DESC
      `,
      metricParams,
    ),
    pool.query(
      `
        SELECT
          coalesce(NULLIF(ts.product_code, ''), 'N/A') AS label,
          count(*)::int AS value
        FROM transport_shipments ts
        JOIN companies c ON c.id = ts.company_id
        WHERE c.legacy_id = 1970324836974592001
          AND ts.departure_date >= $1::date
          AND ts.departure_date <= $2::date
          ${creatorFilterSql}
        GROUP BY coalesce(NULLIF(ts.product_code, ''), 'N/A')
        ORDER BY value DESC
      `,
      metricParams,
    ),
  ]);

  function totals(row) {
    const revenue = moneyNumber(row.revenue);
    const purchase = moneyNumber(row.purchase);
    const margin = moneyNumber(row.margin);
    const shipments = Number(row.shipments || 0);
    return {
      shipments,
      revenue,
      purchase,
      margin,
      averageMargin: shipments ? margin / shipments : 0,
      marginRate: revenue ? (margin / revenue) * 100 : 0,
    };
  }

  function moneyRow(row) {
    const revenue = moneyNumber(row.revenue);
    const purchase = moneyNumber(row.purchase);
    const margin = moneyNumber(row.margin);
    return {
      ...row,
      shipments: Number(row.shipments || 0),
      revenue,
      purchase,
      margin,
      marginRate: revenue ? (margin / revenue) * 100 : 0,
    };
  }

  sendJson(res, 200, {
    range,
    selectedCreator,
    totals: totals(totalsResult.rows[0] || {}),
    previousTotals: totals(previousTotalsResult.rows[0] || {}),
    staff: staffResult.rows.map((row) => ({
      creator: row.creator_key,
      name: row.display_name,
      ...moneyRow(row),
    })),
    topClientsByShipments: topShipmentsResult.rows.map(moneyRow),
    topClientsByRevenue: topRevenueResult.rows.map(moneyRow),
    daily: dailyResult.rows.map((row) => ({
      day: row.day,
      shipments: Number(row.shipments || 0),
      revenue: moneyNumber(row.revenue),
      margin: moneyNumber(row.margin),
    })),
    periodSeries: periodSeriesResult.rows.map((row) => ({
      label: row.period_label,
      dateFrom: row.date_from,
      dateTo: row.date_to,
      shipments: Number(row.shipments || 0),
      revenue: moneyNumber(row.revenue),
      margin: moneyNumber(row.margin),
    })),
    staffDaily: staffDailyResult.rows.map((row) => ({
      creator: row.creator_key,
      name: row.display_name,
      day: row.day,
      shipments: Number(row.shipments || 0),
      revenue: moneyNumber(row.revenue),
      margin: moneyNumber(row.margin),
    })),
    status: statusResult.rows.map((row) => ({ label: row.label, value: Number(row.value || 0) })),
    product: productResult.rows.map((row) => ({ label: row.label, value: Number(row.value || 0) })),
  });
}

async function resolveCustomerId(companyId, code) {
  if (!code) return null;
  const result = await pool.query("SELECT id FROM transport_customers WHERE company_id = $1 AND code = $2", [companyId, code]);
  return result.rowCount ? result.rows[0].id : null;
}

async function upsertCustomerSender(client, customerId, payload) {
  if (!customerId) return;
  const hasSender =
    payload.senderName ||
    payload.senderAddress1 ||
    payload.senderAddress2 ||
    payload.senderAddress3 ||
    payload.senderPostalCode ||
    payload.senderCity ||
    payload.senderPhone;
  if (!hasSender) return;
  await ensureCustomerSenderSchema();
  await client.query(
    `
      INSERT INTO transport_customer_senders (
        customer_id, source_key, name, address1, address2, address3, country_code,
        postal_code, city, phone, instructions, observations, shipment_count,
        last_used_at, source_system, updated_at
      )
      VALUES (
        $1,
        md5($1::text || '|' || coalesce($2, '') || '|' || coalesce($3, '') || '|' ||
          coalesce($4, '') || '|' || coalesce($5, '') || '|' || coalesce($6, '') || '|' ||
          coalesce($7, '') || '|' || coalesce($8, '') || '|' || coalesce($9, '')),
        $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, $12::date, 'manual_chartering', now()
      )
      ON CONFLICT (source_key) DO UPDATE SET
        name = EXCLUDED.name,
        address1 = EXCLUDED.address1,
        address2 = EXCLUDED.address2,
        address3 = EXCLUDED.address3,
        country_code = EXCLUDED.country_code,
        postal_code = EXCLUDED.postal_code,
        city = EXCLUDED.city,
        phone = EXCLUDED.phone,
        instructions = coalesce(EXCLUDED.instructions, transport_customer_senders.instructions),
        observations = coalesce(EXCLUDED.observations, transport_customer_senders.observations),
        shipment_count = transport_customer_senders.shipment_count + 1,
        last_used_at = nullif(
          greatest(
            coalesce(transport_customer_senders.last_used_at, '0001-01-01'::date),
            coalesce(EXCLUDED.last_used_at, '0001-01-01'::date)
          ),
          '0001-01-01'::date
        ),
        source_system = 'manual_chartering',
        updated_at = now()
    `,
    [
      customerId,
      payload.senderName,
      payload.senderAddress1,
      payload.senderAddress2,
      payload.senderAddress3,
      payload.senderCountryCode,
      payload.senderPostalCode,
      payload.senderCity,
      payload.senderPhone,
      payload.senderInstructions,
      payload.senderObservations,
      payload.departureDate,
    ],
  );
}

async function resolveCompanyId() {
  await ensureShipmentSchema();
  const result = await pool.query("SELECT id FROM companies WHERE legacy_id = 1970324836974592001");
  if (!result.rowCount) throw new Error("Societe SGA introuvable.");
  return result.rows[0].id;
}

async function listProducts(req, res) {
  await ensureShipmentSchema();
  const result = await pool.query(
    `
      SELECT tp.code, tp.label, tp.is_chartering
      FROM transport_products tp
      JOIN companies c ON c.id = tp.company_id
      WHERE c.legacy_id = 1970324836974592001
      ORDER BY tp.code
    `,
  );
  sendJson(res, 200, {
    products: result.rows.map((row) => ({
      code: row.code,
      label: row.label,
      isChartering: row.is_chartering,
    })),
  });
}

async function listCarriers(req, res, url) {
  await ensureShipmentSchema();
  const search = normalizeText(url.searchParams.get("search"));
  const result = await pool.query(
    `
      SELECT tc.legacy_id, tc.name, tc.country_code, tc.postal_code, tc.city, tc.phone, tc.email
      FROM transport_carriers tc
      JOIN companies c ON c.id = tc.company_id
      WHERE c.legacy_id = 1970324836974592001
        AND (
          $1::text IS NULL OR
          lower(tc.name || ' ' || coalesce(tc.postal_code, '') || ' ' || coalesce(tc.city, '')) LIKE '%' || lower($1) || '%'
        )
      ORDER BY tc.name ASC
      LIMIT 80
    `,
    [search],
  );
  sendJson(res, 200, {
    carriers: result.rows.map((row) => ({
      legacyId: row.legacy_id,
      name: row.name,
      countryCode: row.country_code,
      postalCode: row.postal_code,
      city: row.city,
      phone: row.phone,
      email: row.email,
    })),
  });
}

async function listCarrierContacts(req, res, url) {
  await ensureShipmentSchema();
  const carrierLegacyId = normalizeText(url.searchParams.get("carrierLegacyId"));
  if (!carrierLegacyId) return sendJson(res, 200, { contacts: [] });
  const result = await pool.query(
    `
      SELECT tcc.display_name, tcc.email
      FROM transport_carrier_contacts tcc
      JOIN transport_carriers tc ON tc.id = tcc.carrier_id
      JOIN companies c ON c.id = tc.company_id
      WHERE c.legacy_id = 1970324836974592001
        AND tc.legacy_id = $1
      ORDER BY tcc.display_name ASC NULLS LAST
      LIMIT 40
    `,
    [carrierLegacyId],
  );
  sendJson(res, 200, {
    contacts: result.rows.map((row) => ({
      displayName: row.display_name,
      email: row.email,
    })),
  });
}

async function listRouteCarrierSuggestions(req, res, url) {
  await ensureShipmentSchema();
  const senderPostalCode = normalizeText(url.searchParams.get("senderPostalCode"));
  const recipientPostalCode = normalizeText(url.searchParams.get("recipientPostalCode"));
  const senderDepartment = (senderPostalCode || "").replace(/\D/g, "").slice(0, 2);
  const recipientDepartment = (recipientPostalCode || "").replace(/\D/g, "").slice(0, 2);
  if (senderDepartment.length < 2 || recipientDepartment.length < 2) {
    return sendJson(res, 200, { suggestions: [] });
  }
  const result = await pool.query(
    `
      WITH filtered AS (
        SELECT
          ts.id,
          ts.receipt_no,
          ts.carrier_legacy_id,
          ts.carrier_name,
          ts.sender_postal_code,
          ts.sender_city,
          ts.recipient_postal_code,
          ts.recipient_city,
          ts.parcels,
          ts.weight,
          ts.agreed_price,
          ts.transport_amount,
          coalesce(ts.departure_date, ts.pickup_date, ts.legacy_created_at::date, ts.imported_at::date) AS route_date
        FROM transport_shipments ts
        JOIN companies c ON c.id = ts.company_id
        WHERE c.legacy_id = 1970324836974592001
          AND left(regexp_replace(coalesce(ts.sender_postal_code, ''), '\\D', '', 'g'), 2) = $1
          AND left(regexp_replace(coalesce(ts.recipient_postal_code, ''), '\\D', '', 'g'), 2) = $2
          AND ts.carrier_name IS NOT NULL
          AND trim(ts.carrier_name) <> ''
          AND ts.agreed_price IS NOT NULL
          AND ts.agreed_price > 0
      ),
      ranked AS (
        SELECT
          filtered.*,
          row_number() OVER (
            PARTITION BY coalesce(carrier_legacy_id, ''), carrier_name
            ORDER BY route_date DESC NULLS LAST, id DESC
          ) AS carrier_rank
        FROM filtered
      )
      SELECT
        carrier_legacy_id,
        carrier_name,
        count(*)::int AS shipment_count,
        round(avg(agreed_price)::numeric, 2) AS average_price,
        min(agreed_price) AS min_price,
        max(agreed_price) AS max_price,
        round(avg(transport_amount)::numeric, 2) AS average_sale_price,
        max(route_date) AS last_date,
        json_agg(
          json_build_object(
            'id', id,
            'receiptNo', receipt_no,
            'date', route_date,
            'senderPostalCode', sender_postal_code,
            'senderCity', sender_city,
            'recipientPostalCode', recipient_postal_code,
            'recipientCity', recipient_city,
            'parcels', parcels,
            'weight', weight,
            'agreedPrice', agreed_price,
            'transportAmount', transport_amount
          )
          ORDER BY route_date DESC NULLS LAST, id DESC
        ) FILTER (WHERE carrier_rank <= 6) AS shipments
      FROM ranked
      GROUP BY carrier_legacy_id, carrier_name
      ORDER BY shipment_count DESC, last_date DESC NULLS LAST, carrier_name ASC
      LIMIT 8
    `,
    [senderDepartment, recipientDepartment],
  );
  sendJson(res, 200, {
    route: { senderDepartment, recipientDepartment },
    suggestions: result.rows.map((row) => ({
      carrierLegacyId: row.carrier_legacy_id,
      carrierName: row.carrier_name,
      shipmentCount: row.shipment_count,
      averagePrice: row.average_price,
      minPrice: row.min_price,
      maxPrice: row.max_price,
      averageSalePrice: row.average_sale_price,
      lastDate: row.last_date,
      shipments: row.shipments || [],
    })),
  });
}

const COUNTRY_NAMES = {
  AT: "Autriche",
  BE: "Belgique",
  CH: "Suisse",
  CZ: "Tchequie",
  DE: "Allemagne",
  DK: "Danemark",
  ES: "Espagne",
  FR: "France",
  GB: "Royaume-Uni",
  GR: "Grece",
  HK: "Hong Kong",
  HU: "Hongrie",
  IT: "Italie",
  IZ: "IZ",
  MC: "Monaco",
  MT: "Malte",
  NL: "Pays-Bas",
  PL: "Pologne",
  PT: "Portugal",
  RO: "Roumanie",
  SE: "Suede",
  SI: "Slovenie",
};

function countryFlag(code) {
  if (code === "IZ") return "";
  if (!/^[A-Z]{2}$/.test(code || "")) return "";
  return String.fromCodePoint(...code.split("").map((letter) => letter.charCodeAt(0) + 127397));
}

function countrySort(a, b) {
  return a.name.localeCompare(b.name, "fr") || a.code.localeCompare(b.code);
}

function orderCountries(countries) {
  const mostUsedCodes = new Set(
    countries
      .filter((country) => country.code !== "FR")
      .sort((a, b) => b.usageCount - a.usageCount || countrySort(a, b))
      .slice(0, 6)
      .map((country) => country.code),
  );
  return [
    ...countries.filter((country) => country.code === "FR"),
    ...countries.filter((country) => mostUsedCodes.has(country.code)).sort(countrySort),
    ...countries.filter((country) => country.code !== "FR" && !mostUsedCodes.has(country.code)).sort(countrySort),
  ];
}

async function listCountries(req, res) {
  await ensureShipmentSchema();
  const result = await pool.query(
    `
      SELECT normalized_country AS country_code, count(*)::int AS usage_count
      FROM (
        SELECT CASE upper(country_code)
          WHEN 'F' THEN 'FR' WHEN 'D' THEN 'DE' WHEN 'B' THEN 'BE' WHEN 'I' THEN 'IT'
          WHEN 'ESP' THEN 'ES' WHEN 'S' THEN 'SE' WHEN 'A' THEN 'AT' WHEN 'H' THEN 'HU'
          ELSE upper(country_code)
        END AS normalized_country FROM transport_customers
        UNION ALL SELECT CASE upper(billing_country_code)
          WHEN 'F' THEN 'FR' WHEN 'D' THEN 'DE' WHEN 'B' THEN 'BE' WHEN 'I' THEN 'IT'
          WHEN 'ESP' THEN 'ES' WHEN 'S' THEN 'SE' WHEN 'A' THEN 'AT' WHEN 'H' THEN 'HU'
          ELSE upper(billing_country_code)
        END FROM transport_customers
        UNION ALL SELECT CASE upper(sender_country_code)
          WHEN 'F' THEN 'FR' WHEN 'D' THEN 'DE' WHEN 'B' THEN 'BE' WHEN 'I' THEN 'IT'
          WHEN 'ESP' THEN 'ES' WHEN 'S' THEN 'SE' WHEN 'A' THEN 'AT' WHEN 'H' THEN 'HU'
          ELSE upper(sender_country_code)
        END FROM transport_shipments
        UNION ALL SELECT CASE upper(recipient_country_code)
          WHEN 'F' THEN 'FR' WHEN 'D' THEN 'DE' WHEN 'B' THEN 'BE' WHEN 'I' THEN 'IT'
          WHEN 'ESP' THEN 'ES' WHEN 'S' THEN 'SE' WHEN 'A' THEN 'AT' WHEN 'H' THEN 'HU'
          ELSE upper(recipient_country_code)
        END FROM transport_shipments
      ) countries
      WHERE normalized_country IS NOT NULL AND normalized_country ~ '^[A-Z]{2}$'
      GROUP BY normalized_country
    `,
  );
  const countries = orderCountries(result.rows.map((row) => ({
    code: row.country_code,
    flag: countryFlag(row.country_code),
    name: COUNTRY_NAMES[row.country_code] || row.country_code,
    usageCount: row.usage_count,
  })));
  sendJson(res, 200, { countries });
}

async function listCities(req, res, url) {
  await ensureShipmentSchema();
  const country = normalizeText(url.searchParams.get("country"));
  const postalCode = normalizeText(url.searchParams.get("postalCode"));
  let officialCities = [];
  if ((!country || country === "FR" || country === "F") && /^\d{5}$/.test(postalCode || "")) {
    try {
      const apiUrl = `https://geo.api.gouv.fr/communes?codePostal=${encodeURIComponent(postalCode)}&fields=nom,codesPostaux&format=json`;
      const communes = await fetchJson(apiUrl);
      officialCities = Array.isArray(communes)
        ? communes
            .filter((commune) => Array.isArray(commune.codesPostaux) && commune.codesPostaux.includes(postalCode))
            .map((commune) => ({
              postalCode,
              city: commune.nom,
              countryCode: "FR",
              usageCount: 0,
              source: "geo.gouv.fr",
            }))
        : [];
    } catch (error) {
      officialCities = [];
    }
  }
  const result = await pool.query(
    `
      SELECT postal_code, city, country_code, count(*)::int AS usage_count
      FROM (
        SELECT postal_code, city, CASE upper(country_code) WHEN 'F' THEN 'FR' WHEN 'D' THEN 'DE' WHEN 'B' THEN 'BE' WHEN 'I' THEN 'IT' WHEN 'ESP' THEN 'ES' WHEN 'S' THEN 'SE' WHEN 'A' THEN 'AT' WHEN 'H' THEN 'HU' ELSE upper(country_code) END AS country_code FROM transport_customers
        UNION ALL SELECT billing_postal_code, billing_city, CASE upper(billing_country_code) WHEN 'F' THEN 'FR' WHEN 'D' THEN 'DE' WHEN 'B' THEN 'BE' WHEN 'I' THEN 'IT' WHEN 'ESP' THEN 'ES' WHEN 'S' THEN 'SE' WHEN 'A' THEN 'AT' WHEN 'H' THEN 'HU' ELSE upper(billing_country_code) END FROM transport_customers
        UNION ALL SELECT sender_postal_code, sender_city, CASE upper(sender_country_code) WHEN 'F' THEN 'FR' WHEN 'D' THEN 'DE' WHEN 'B' THEN 'BE' WHEN 'I' THEN 'IT' WHEN 'ESP' THEN 'ES' WHEN 'S' THEN 'SE' WHEN 'A' THEN 'AT' WHEN 'H' THEN 'HU' ELSE upper(sender_country_code) END FROM transport_shipments
        UNION ALL SELECT recipient_postal_code, recipient_city, CASE upper(recipient_country_code) WHEN 'F' THEN 'FR' WHEN 'D' THEN 'DE' WHEN 'B' THEN 'BE' WHEN 'I' THEN 'IT' WHEN 'ESP' THEN 'ES' WHEN 'S' THEN 'SE' WHEN 'A' THEN 'AT' WHEN 'H' THEN 'HU' ELSE upper(recipient_country_code) END FROM transport_shipments
      ) places
      WHERE city IS NOT NULL AND city <> ''
        AND ($1::text IS NULL OR country_code = $1)
        AND ($2::text IS NULL OR postal_code LIKE $2 || '%')
      GROUP BY postal_code, city, country_code
      ORDER BY usage_count DESC, city ASC
      LIMIT 60
    `,
    [country, postalCode],
  );
  const internalCities = result.rows.map((row) => ({
      postalCode: row.postal_code,
      city: row.city,
      countryCode: row.country_code,
      usageCount: row.usage_count,
      source: "mytracking",
    }));
  const cityMap = new Map();
  for (const city of [...officialCities, ...internalCities]) {
    const key = `${city.countryCode || ""}|${city.postalCode || ""}|${normalizeText(city.city).toUpperCase()}`;
    const existing = cityMap.get(key);
    cityMap.set(key, existing ? { ...existing, usageCount: Math.max(existing.usageCount || 0, city.usageCount || 0) } : city);
  }
  sendJson(res, 200, {
    cities: Array.from(cityMap.values()).sort((left, right) => {
      if (left.source !== right.source) return left.source === "geo.gouv.fr" ? -1 : 1;
      return String(left.city || "").localeCompare(String(right.city || ""), "fr");
    }),
  });
}

async function createShipment(req, res) {
  await ensureShipmentSchema();
  const body = await readJsonBody(req);
  const payload = shipmentPayload(body);
  if (!payload.receiptNo) return sendJson(res, 400, { error: "Le recepisse est obligatoire." });
  const companyId = await resolveCompanyId();
  const customerId = await resolveCustomerId(companyId, payload.customerCode);
  const payerCustomerId = await resolveCustomerId(companyId, payload.payerCode);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `
        INSERT INTO transport_shipments (
          company_id, customer_id, payer_customer_id, receipt_no,
          customer_code, payer_code,
          sender_name, sender_address1, sender_address2, sender_address3,
          sender_country_code, sender_postal_code, sender_city, sender_phone,
          recipient_name, recipient_address1, recipient_address2, recipient_address3,
          recipient_country_code, recipient_postal_code, recipient_city,
          recipient_phone, recipient_email, parcels, weight, volume,
          goods_nature, product_code, departure_date, arrival_date, pickup_date,
          requested_delivery_date, estimated_delivery_date, invoice_number,
          invoice_validation_code, order_reference, transport_amount, agreed_price,
          sale_price, carrier_legacy_id, carrier_name, status, is_closed,
          is_dispute, is_chartering, notes, source_system
        )
        VALUES (
          $1, $2, $3, $4,
          $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14,
          $15, $16, $17, $18,
          $19, $20, $21,
          $22, $23, $24, $25, $26,
          $27, $28, $29, $30, $31,
          $32, $33, $34,
          $35, $36, $37, $38,
          $39, $40, $41, $42, $43,
          $44, $45, $46, 'manual_chartering'
        )
        RETURNING *
      `,
      [
        companyId,
        customerId,
        payerCustomerId,
        payload.receiptNo,
        payload.customerCode,
        payload.payerCode,
        payload.senderName,
        payload.senderAddress1,
        payload.senderAddress2,
        payload.senderAddress3,
        payload.senderCountryCode,
        payload.senderPostalCode,
        payload.senderCity,
        payload.senderPhone,
        payload.recipientName,
        payload.recipientAddress1,
        payload.recipientAddress2,
        payload.recipientAddress3,
        payload.recipientCountryCode,
        payload.recipientPostalCode,
        payload.recipientCity,
        payload.recipientPhone,
        payload.recipientEmail,
        payload.parcels,
        payload.weight,
        payload.volume,
        payload.goodsNature,
        payload.productCode,
        payload.departureDate,
        payload.arrivalDate,
        payload.pickupDate,
        payload.requestedDeliveryDate,
        payload.estimatedDeliveryDate,
        payload.invoiceNumber,
        payload.invoiceValidationCode,
        payload.orderReference,
        payload.transportAmount,
        payload.agreedPrice,
        payload.salePrice,
        payload.carrierLegacyId,
        payload.carrierName,
        payload.status,
        payload.isClosed,
        payload.isDispute,
        true,
        payload.notes,
      ],
    );
    await upsertCustomerSender(client, customerId, payload);
    await client.query(
      "INSERT INTO transport_shipment_change_events (shipment_id, changed_by, action, changes) VALUES ($1, $2, 'create', $3::jsonb)",
      [inserted.rows[0].id, actorFromRequest(req, body), JSON.stringify(payload)],
    );
    await client.query("COMMIT");
    sendJson(res, 201, { shipment: shipmentFromRow(inserted.rows[0]), changed: true });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return sendJson(res, 409, { error: "Ce recepisse existe deja." });
    throw error;
  } finally {
    client.release();
  }
}

async function saveShipment(req, res, id) {
  await ensureShipmentSchema();
  const body = await readJsonBody(req);
  const payload = shipmentPayload(body);
  if (!payload.receiptNo) return sendJson(res, 400, { error: "Le recepisse est obligatoire." });
  const beforeResult = await pool.query(
    `
      SELECT ts.*, cst.name AS customer_name, payer.name AS payer_name
      FROM transport_shipments ts
      LEFT JOIN transport_customers cst ON cst.id = ts.customer_id
      LEFT JOIN transport_customers payer ON payer.id = ts.payer_customer_id
      WHERE ts.id = $1
    `,
    [id],
  );
  if (!beforeResult.rowCount) return sendJson(res, 404, { error: "Expedition introuvable." });
  const before = shipmentFromRow(beforeResult.rows[0]);
  const changes = diffObject(before, payload);
  if (!Object.keys(changes).length) return sendJson(res, 200, { shipment: before, changed: false });

  const companyId = beforeResult.rows[0].company_id;
  const customerId = await resolveCustomerId(companyId, payload.customerCode);
  const payerCustomerId = await resolveCustomerId(companyId, payload.payerCode);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `
        UPDATE transport_shipments SET
          customer_id = $1, payer_customer_id = $2, receipt_no = $3,
          customer_code = $4, payer_code = $5,
          sender_name = $6, sender_address1 = $7, sender_address2 = $8, sender_address3 = $9,
          sender_country_code = $10, sender_postal_code = $11, sender_city = $12, sender_phone = $13,
          recipient_name = $14, recipient_address1 = $15, recipient_address2 = $16, recipient_address3 = $17,
          recipient_country_code = $18, recipient_postal_code = $19, recipient_city = $20,
          recipient_phone = $21, recipient_email = $22, parcels = $23, weight = $24, volume = $25,
          goods_nature = $26, product_code = $27, departure_date = $28, pickup_date = $29,
          requested_delivery_date = $30, estimated_delivery_date = $31, invoice_number = $32,
          invoice_validation_code = $33, order_reference = $34, status = $35, is_closed = $36,
          is_dispute = $37, is_chartering = $38, notes = $39, updated_at = now()
        WHERE id = $40
        RETURNING *
      `,
      [
        customerId,
        payerCustomerId,
        payload.receiptNo,
        payload.customerCode,
        payload.payerCode,
        payload.senderName,
        payload.senderAddress1,
        payload.senderAddress2,
        payload.senderAddress3,
        payload.senderCountryCode,
        payload.senderPostalCode,
        payload.senderCity,
        payload.senderPhone,
        payload.recipientName,
        payload.recipientAddress1,
        payload.recipientAddress2,
        payload.recipientAddress3,
        payload.recipientCountryCode,
        payload.recipientPostalCode,
        payload.recipientCity,
        payload.recipientPhone,
        payload.recipientEmail,
        payload.parcels,
        payload.weight,
        payload.volume,
        payload.goodsNature,
        payload.productCode,
        payload.departureDate,
        payload.pickupDate,
        payload.requestedDeliveryDate,
        payload.estimatedDeliveryDate,
        payload.invoiceNumber,
        payload.invoiceValidationCode,
        payload.orderReference,
        payload.status,
        payload.isClosed,
        payload.isDispute,
        payload.isChartering,
        payload.notes,
        id,
      ],
    );
    await client.query(
      "INSERT INTO transport_shipment_change_events (shipment_id, changed_by, action, changes) VALUES ($1, $2, 'update', $3::jsonb)",
      [id, actorFromRequest(req, body), JSON.stringify(changes)],
    );
    await client.query("COMMIT");
    const fresh = await pool.query(
      `
        SELECT ts.*, cst.name AS customer_name, payer.name AS payer_name
        FROM transport_shipments ts
        LEFT JOIN transport_customers cst ON cst.id = ts.customer_id
        LEFT JOIN transport_customers payer ON payer.id = ts.payer_customer_id
        WHERE ts.id = $1
      `,
      [updated.rows[0].id],
    );
    sendJson(res, 200, { shipment: shipmentFromRow(fresh.rows[0]), changed: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listStaff(req, res, url) {
  await ensureStaffSchema();
  const search = normalizeText(url.searchParams.get("search"));
  const result = await pool.query(
    `
      SELECT s.*
      FROM staff_members s
      JOIN companies c ON c.id = s.company_id
      WHERE c.legacy_id = 1970324836974592001
        AND (
          $1::text IS NULL OR
          lower(s.display_name || ' ' || coalesce(s.email, '') || ' ' || coalesce(s.role, '')) LIKE '%' || lower($1) || '%'
        )
      ORDER BY s.display_name ASC
    `,
    [search],
  );
  sendJson(res, 200, { staff: result.rows.map(staffFromRow) });
}

async function getStaff(req, res, id) {
  await ensureStaffSchema();
  const result = await pool.query("SELECT * FROM staff_members WHERE id = $1", [id]);
  if (!result.rowCount) return sendJson(res, 404, { error: "Personnel introuvable." });
  sendJson(res, 200, { staff: staffFromRow(result.rows[0]) });
}

async function getStaffHistory(req, res, id) {
  await ensureStaffSchema();
  const result = await pool.query(
    "SELECT id, changed_at, changed_by, action, changes FROM staff_change_events WHERE staff_id = $1 ORDER BY changed_at DESC, id DESC LIMIT 100",
    [id],
  );
  sendJson(res, 200, {
    events: result.rows.map((row) => ({
      id: row.id,
      changedAt: row.changed_at,
      changedBy: row.changed_by,
      action: row.action,
      changes: row.changes,
    })),
  });
}

async function saveStaff(req, res, id) {
  await ensureStaffSchema();
  const body = await readJsonBody(req);
  const payload = staffPayload(body);
  if (!payload.firstName || !payload.displayName) return sendJson(res, 400, { error: "Le prenom est obligatoire." });
  const beforeResult = await pool.query("SELECT * FROM staff_members WHERE id = $1", [id]);
  if (!beforeResult.rowCount) return sendJson(res, 404, { error: "Personnel introuvable." });
  const before = staffFromRow(beforeResult.rows[0]);
  const { smtpPassword, ...diffPayload } = payload;
  const changes = diffObject(before, diffPayload);
  if (smtpPassword) changes.smtpPassword = { from: before.mailPasswordConfigured ? "renseigne" : "vide", to: "remplace" };
  if (!Object.keys(changes).length) return sendJson(res, 200, { staff: before, changed: false });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const encryptedPassword = smtpPassword ? encryptSecret(smtpPassword) : beforeResult.rows[0].mail_password_encrypted;
    const passwordConfigured = Boolean(encryptedPassword || beforeResult.rows[0].mail_password_configured);
    const updated = await client.query(
      `
        UPDATE staff_members SET
          first_name = $1,
          last_name = $2,
          display_name = $3,
          login = $4,
          email = $5,
          phone = $6,
          smtp_server = $7,
          smtp_port = $8,
          mail_signature_html = $9,
          mail_html_file = $10,
          mail_password_encrypted = $11,
          mail_password_configured = $12,
          role = $13,
          status = $14,
          notes = $15,
          updated_at = now()
        WHERE id = $16
        RETURNING *
      `,
      [
        payload.firstName,
        payload.lastName,
        payload.displayName,
        payload.login,
        payload.email,
        payload.phone,
        payload.smtpServer,
        payload.smtpPort,
        payload.mailSignatureHtml,
        payload.mailHtmlFile,
        encryptedPassword,
        passwordConfigured,
        payload.role,
        payload.status,
        payload.notes,
        id,
      ],
    );
    await client.query(
      "INSERT INTO staff_change_events (staff_id, changed_by, action, changes) VALUES ($1, $2, 'update', $3::jsonb)",
      [id, actorFromRequest(req, body), JSON.stringify(changes)],
    );
    await client.query("COMMIT");
    sendJson(res, 200, { staff: staffFromRow(updated.rows[0]), changed: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function syncRunFromRow(row) {
  if (!row) return null;
  const startedAt = row.started_at ? new Date(row.started_at) : null;
  const finishedAt = row.finished_at ? new Date(row.finished_at) : null;
  const durationMs = startedAt && finishedAt ? finishedAt.getTime() - startedAt.getTime() : null;
  return {
    id: row.id,
    status: row.status,
    triggeredBy: row.triggered_by,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs,
    commandLabel: row.command_label,
    outputTail: row.output_tail,
    errorMessage: row.error_message,
  };
}

function syncSummary(run) {
  if (!run) return "Aucune synchronisation lancee.";
  if (run.status === "running") return `Synchro en cours depuis ${run.startedAt ? new Date(run.startedAt).toLocaleString("fr-FR") : "maintenant"}.`;
  if (run.status === "success") return `Derniere synchro terminee avec succes.`;
  if (run.status === "error") return `Derniere synchro en erreur : ${run.errorMessage || "erreur inconnue"}.`;
  return `Derniere synchro : ${run.status}.`;
}

function runConfiguredWindevSync(command, timeoutMs) {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: timeoutMs, maxBuffer: 1024 * 1024, env: process.env }, (error, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join("\n").slice(-6000);
      if (error) {
        error.outputTail = output;
        reject(error);
        return;
      }
      resolve(output);
    });
  });
}

async function getWindevSyncStatus(req, res, requireAdmin = true) {
  if (requireAdmin && !isAuthenticated(req)) return sendJson(res, 401, { error: "Unauthorized" });
  await ensureWindevSyncSchema();
  const result = await pool.query("SELECT * FROM windev_sync_runs ORDER BY started_at DESC LIMIT 5");
  const runs = result.rows.map(syncRunFromRow);
  sendJson(res, 200, {
    configured: Boolean(process.env.WINDEV_SYNC_COMMAND),
    running: Boolean(activeWindevSync),
    active: activeWindevSync,
    summary: syncSummary(activeWindevSync ? runs.find((run) => String(run.id) === String(activeWindevSync.runId)) || { status: "running", startedAt: activeWindevSync.startedAt } : runs[0]),
    runs,
  });
}

async function startWindevSync(req, res, requireAdmin = true) {
  if (requireAdmin && !isAuthenticated(req)) return sendJson(res, 401, { error: "Unauthorized" });
  await ensureWindevSyncSchema();
  const body = await readJsonBody(req);
  if (body.confirmation !== "SYNCHRONISER WINDEV") {
    return sendJson(res, 400, { error: "Confirmation incorrecte." });
  }
  const command = process.env.WINDEV_SYNC_COMMAND;
  if (!command) {
    const failed = await pool.query(
      `
        INSERT INTO windev_sync_runs (status, triggered_by, finished_at, command_label, error_message, output_tail)
        VALUES ('error', $1, now(), $2, $3, $4)
        RETURNING *
      `,
      [
        actorFromRequest(req, body),
        body.commandLabel || "windev-to-beta",
        "Commande WINDEV_SYNC_COMMAND non configuree sur le serveur beta.",
        "Perimetre attendu : societe, personnel, clients, expeditions, produits, affretes et contacts affretes.",
      ],
    );
    return sendJson(res, 409, {
      error: "Commande WINDEV_SYNC_COMMAND non configuree sur le serveur beta.",
      run: syncRunFromRow(failed.rows[0]),
    });
  }
  if (activeWindevSync) return sendJson(res, 409, { error: "Une synchronisation est deja en cours." });
  const timeoutMs = Number(process.env.WINDEV_SYNC_TIMEOUT_MS || 15 * 60 * 1000);
  const actor = actorFromRequest(req, body);
  const started = await pool.query(
    "INSERT INTO windev_sync_runs (status, triggered_by, command_label) VALUES ('running', $1, $2) RETURNING *",
    [actor, body.commandLabel || "windev-to-beta"],
  );
  const runId = started.rows[0].id;
  activeWindevSync = { runId, startedAt: new Date().toISOString() };
  runConfiguredWindevSync(command, timeoutMs)
    .then((output) =>
      pool.query(
        "UPDATE windev_sync_runs SET status = 'success', finished_at = now(), output_tail = $1 WHERE id = $2",
        [output, runId],
      ),
    )
    .catch((error) =>
      pool.query(
        "UPDATE windev_sync_runs SET status = 'error', finished_at = now(), output_tail = $1, error_message = $2 WHERE id = $3",
        [error.outputTail || "", error.message || "Erreur synchro", runId],
      ),
    )
    .finally(() => {
      activeWindevSync = null;
    });
  sendJson(res, 202, { run: syncRunFromRow(started.rows[0]), running: true });
}

function loginPage(error = "") {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>MyTracking Admin - Connexion</title>
    <link rel="stylesheet" href="/auth.css">
  </head>
  <body>
    <main class="auth-shell">
      <section class="auth-frame" aria-label="Connexion administrateur plateforme">
        <aside class="brand-panel">
          <div class="brand-mark">
            <img class="brand-logo" src="/assets/mytracking-logo.svg" alt="MyTracking">
          </div>
          <div class="brand-copy">
            <p class="eyebrow">Backoffice plateforme</p>
            <h1>Creer les societes.</h1>
            <p>Connexion dediee a l'administration plateforme, separee de l'espace client.</p>
          </div>
          <div class="signal-strip" aria-label="Indicateurs plateforme">
            <div class="signal"><span>Tenants</span><strong>isoles</strong></div>
            <div class="signal"><span>Bases</span><strong>dediees</strong></div>
            <div class="signal"><span>Migration</span><strong>ODBC</strong></div>
          </div>
        </aside>
        <section class="form-panel">
          <div class="login-card">
            <header>
              <p class="access-kicker">Console plateforme</p>
              <h2>Acces administrateur</h2>
              <p>Saisissez votre email administrateur et votre mot de passe.</p>
            </header>
            ${error ? `<div class="error-note">${error}</div>` : ""}
            <form method="post" action="/admin/login">
              <div class="field-group">
                <div class="field">
                  <label for="admin-email">Email administrateur</label>
                  <div class="input-wrap">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M4 6h16v12H4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                      <path d="m4 7 8 6 8-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <input id="admin-email" name="email" type="email" autocomplete="email" placeholder="mikael.jurgielewicz@cw2s.fr" required>
                  </div>
                </div>
                <div class="field">
                  <label for="admin-password">Mot de passe</label>
                  <div class="input-wrap">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M7 11V8a5 5 0 0 1 10 0v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                      <path d="M6 11h12v9H6z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                    </svg>
                    <input id="admin-password" name="password" type="password" autocomplete="current-password" placeholder="Votre mot de passe" required>
                  </div>
                </div>
              </div>
              <div class="form-row">
                <label class="checkline"><input type="checkbox" name="trusted"><span>Poste de confiance</span></label>
                <a class="text-link" href="#">Recuperation admin</a>
              </div>
              <button class="primary-button" type="submit">Ouvrir le backoffice</button>
            </form>
            <div class="security-note">
              <span>Cette connexion est separee de l'espace client et protegee cote serveur.</span>
            </div>
          </div>
        </section>
      </section>
    </main>
  </body>
</html>`;
}

function serveAdminFile(req, res) {
  if (!isAuthenticated(req)) return redirect(res, "/admin/login.html");
  const relative = req.url === "/admin/" ? "index.html" : req.url.replace(/^\/admin\//, "");
  const filePath = path.normalize(path.join(staticRoot, "admin", relative));
  if (!filePath.startsWith(path.join(staticRoot, "admin"))) return send(res, 403, "Forbidden");
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(res, 404, "Not found");
  send(res, 200, fs.readFileSync(filePath), contentTypeFromPath(filePath));
}

function serveRootStaticFile(req, res, relative) {
  const root = path.resolve(staticRoot);
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(root + path.sep)) return send(res, 403, "Forbidden");
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(res, 404, "Not found");
  send(res, 200, fs.readFileSync(filePath), contentTypeFromPath(filePath));
}

function serveClientFile(req, res, pathname) {
  if (!isClientAuthenticated(req)) return redirect(res, "/login-client.html");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  return serveRootStaticFile(req, res, pathname.replace(/^\//, ""));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "HEAD" && url.pathname === "/admin/login.html") return sendHead(res, 200);
    if (req.method === "GET" && url.pathname === "/admin/login.html") return send(res, 200, loginPage());
    if (req.method === "HEAD" && url.pathname === "/login-client.html") return sendHead(res, 200);
    if (req.method === "GET" && url.pathname === "/login-client.html") return serveRootStaticFile(req, res, "login-client.html");
    if (req.method === "GET" && url.pathname === "/client/logout") {
      res.writeHead(302, {
        Location: "/login-client.html",
        "Set-Cookie": "mt_client=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      });
      return res.end();
    }
    if (req.method === "POST" && url.pathname === "/client/login") {
      if (!sessionSecret) return send(res, 503, "Secret de session client non configure.");
      const body = querystring.parse(await readBody(req));
      const email = String(body.email || "").trim();
      const password = String(body.password || "").trim();
      if (!email || !password) return redirect(res, "/login-client.html");
      if (clientPasswordHash && sha256(password) !== clientPasswordHash) return redirect(res, "/login-client.html");
      const payload = Buffer.from(JSON.stringify({ email, ts: Date.now() })).toString("base64url");
      res.writeHead(302, {
        Location: "/client-customers.html",
        "Set-Cookie": `mt_client=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`,
      });
      return res.end();
    }
    if ((req.method === "GET" || req.method === "HEAD") && /^\/client-[^/]+\.html$/.test(url.pathname)) return serveClientFile(req, res, url.pathname);
    if (url.pathname.startsWith("/client-api/") && !isClientAuthenticated(req)) return sendJson(res, 401, { error: "Identification client requise." });
    if (req.method === "GET" && url.pathname === "/admin/api/companies") return listCompanies(req, res);
    if (req.method === "POST" && url.pathname === "/admin/api/companies") return saveCompany(req, res);
    if (req.method === "GET" && url.pathname === "/admin/api/windev-sync") return getWindevSyncStatus(req, res);
    if (req.method === "POST" && url.pathname === "/admin/api/windev-sync") return startWindevSync(req, res);
    const companyMatch = url.pathname.match(/^\/admin\/api\/companies\/(\d+)$/);
    if (companyMatch && req.method === "GET") return getCompany(req, res, Number(companyMatch[1]));
    if (companyMatch && req.method === "PUT") return saveCompany(req, res, Number(companyMatch[1]));
    if (req.method === "GET" && url.pathname === "/client-api/customers") return listCustomers(req, res, url);
    if (req.method === "GET" && url.pathname === "/client-api/windev-sync") return getWindevSyncStatus(req, res, false);
    if (req.method === "POST" && url.pathname === "/client-api/windev-sync") return startWindevSync(req, res, false);
    const customerMatch = url.pathname.match(/^\/client-api\/customers\/(\d+)$/);
    if (customerMatch && req.method === "GET") return getCustomer(req, res, Number(customerMatch[1]));
    if (customerMatch && req.method === "PUT") return saveCustomer(req, res, Number(customerMatch[1]));
    const customerHistoryMatch = url.pathname.match(/^\/client-api\/customers\/(\d+)\/history$/);
    if (customerHistoryMatch && req.method === "GET") return getCustomerHistory(req, res, Number(customerHistoryMatch[1]));
    const customerSendersMatch = url.pathname.match(/^\/client-api\/customers\/(\d+)\/senders$/);
    if (customerSendersMatch && req.method === "GET") return getCustomerSenders(req, res, Number(customerSendersMatch[1]));
    if (req.method === "GET" && url.pathname === "/client-api/staff") return listStaff(req, res, url);
    if (req.method === "GET" && url.pathname === "/client-api/current-staff") return getCurrentStaff(req, res, url);
    const staffMatch = url.pathname.match(/^\/client-api\/staff\/(\d+)$/);
    if (staffMatch && req.method === "GET") return getStaff(req, res, Number(staffMatch[1]));
    if (staffMatch && req.method === "PUT") return saveStaff(req, res, Number(staffMatch[1]));
    const staffHistoryMatch = url.pathname.match(/^\/client-api\/staff\/(\d+)\/history$/);
    if (staffHistoryMatch && req.method === "GET") return getStaffHistory(req, res, Number(staffHistoryMatch[1]));
    if (req.method === "GET" && url.pathname === "/client-api/analytics/performance") return listPerformanceAnalytics(req, res, url);
    if (req.method === "GET" && url.pathname === "/client-api/products") return listProducts(req, res, url);
    if (req.method === "GET" && url.pathname === "/client-api/carriers") return listCarriers(req, res, url);
    if (req.method === "GET" && url.pathname === "/client-api/carrier-contacts") return listCarrierContacts(req, res, url);
    if (req.method === "GET" && url.pathname === "/client-api/route-carrier-suggestions") return listRouteCarrierSuggestions(req, res, url);
    if (req.method === "GET" && url.pathname === "/client-api/countries") return listCountries(req, res, url);
    if (req.method === "GET" && url.pathname === "/client-api/cities") return listCities(req, res, url);
    if (req.method === "GET" && url.pathname === "/client-api/shipments") return listShipments(req, res, url);
    if (req.method === "GET" && url.pathname === "/client-api/invoices") return listInvoices(req, res, url);
    if (req.method === "GET" && url.pathname === "/client-api/invoices/pending-dispatch-preview") return listPendingInvoiceDispatchPreview(req, res);
    if (req.method === "POST" && url.pathname === "/client-api/invoices/test-dispatch") return sendTestInvoiceDispatch(req, res);
    const invoiceMatch = url.pathname.match(/^\/client-api\/invoices\/(\d+)$/);
    if (invoiceMatch && req.method === "GET") return getInvoice(req, res, Number(invoiceMatch[1]));
    if (req.method === "POST" && url.pathname === "/client-api/shipments") return createShipment(req, res);
    const charteringConfirmationMatch = url.pathname.match(/^\/client-api\/chartering-confirmations\/(\d+)$/);
    if (charteringConfirmationMatch && req.method === "GET") return getCharteringConfirmation(req, res, Number(charteringConfirmationMatch[1]));
    if (charteringConfirmationMatch && req.method === "POST") return await sendCharteringConfirmation(req, res, Number(charteringConfirmationMatch[1]));
    const shipmentMatch = url.pathname.match(/^\/client-api\/shipments\/(\d+)$/);
    if (shipmentMatch && req.method === "GET") return getShipment(req, res, Number(shipmentMatch[1]));
    if (shipmentMatch && req.method === "PUT") return saveShipment(req, res, Number(shipmentMatch[1]));
    const shipmentHistoryMatch = url.pathname.match(/^\/client-api\/shipments\/(\d+)\/history$/);
    if (shipmentHistoryMatch && req.method === "GET") return getShipmentHistory(req, res, Number(shipmentHistoryMatch[1]));
  } catch (error) {
    console.error(error.message);
    if (error.statusCode) return sendJson(res, error.statusCode, { error: error.message });
    return sendJson(res, 500, { error: "Erreur serveur admin." });
  }
  if (req.method === "GET" && url.pathname === "/admin/logout") {
    res.writeHead(302, {
      Location: "/admin/login.html",
      "Set-Cookie": "mt_admin=; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    });
    return res.end();
  }
  if (req.method === "POST" && url.pathname === "/admin/login") {
    const body = querystring.parse(await readBody(req));
    const emailOk = String(body.email || "").toLowerCase() === adminEmail.toLowerCase();
    const passOk = sha256(String(body.password || "")) === passwordHash;
    if (!emailOk || !passOk) return send(res, 401, loginPage("Email ou mot de passe incorrect."));
    const payload = Buffer.from(JSON.stringify({ email: adminEmail, ts: Date.now() })).toString("base64url");
    res.writeHead(302, {
      Location: "/admin/index.html",
      "Set-Cookie": `mt_admin=${payload}.${sign(payload)}; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`,
    });
    return res.end();
  }
  if (url.pathname.startsWith("/admin/")) {
    req.url = url.pathname;
    return serveAdminFile(req, res);
  }
  send(res, 404, "Not found");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`mytracking admin auth listening on ${port}`);
});
