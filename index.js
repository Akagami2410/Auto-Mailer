import "dotenv/config";

import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import serveStatic from "serve-static";
import { createProxyMiddleware } from "http-proxy-middleware";

import { ensureTables } from "./utils/db-init.js";
import { getPool } from "./utils/db.js";
import { seedShop } from "./utils/seed-shop.js";
import { verifySessionToken } from "./utils/VerifySessionToken.js";
import { exchangeOfflineToken } from "./utils/tokenExchange.js";
import webhookRouter from "./routes/webhook.js";
import cronRouter from "./routes/cron.js";
import workshopRegistrationsRouter from "./routes/workshopRegistrations.js";
import subsRouter from "./routes/subs.js";
import removalResultsRouter from "./routes/removalResults.js";
import subscriptionContractRouter from "./routes/subscriptionContract.js";
import orderOutcomesRouter from "./routes/orderOutcomes.js";
import subsCancellationsRouter from "./routes/subsCancellations.js";
import { startWorker, getWorkerStats, logStats } from "./services/worker.js";
import { getQueueStats } from "./services/queue.js";
import { captureRawBody } from "./middleware/rawBody.js";
import { sendEmail } from "./services/email.js";

const app = express();
app.set("trust proxy", true);

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";

app.use("/api/webhook", express.json({
  limit: "2mb",
  verify: captureRawBody,
}));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

app.use("/uploads", express.static(uploadDir));

app.get("/api/health", async (req, res) => {
  try {
    const queueStats = await getQueueStats();
    const workerStats = getWorkerStats();
    res.json({
      ok: true,
      env: NODE_ENV,
      queue: queueStats,
      worker: workerStats,
    });
  } catch (err) {
    res.json({ ok: true, env: NODE_ENV, error: err.message });
  }
});

app.use("/api/webhook", webhookRouter);
app.use("/api/cron", cronRouter);
app.use("/api/workshop-registrations", workshopRegistrationsRouter);
app.use("/api/subs", subsRouter);
app.use("/api/removal-results", removalResultsRouter);
app.use("/api/subscription_contract_updated", subscriptionContractRouter);
app.use("/api/orders/outcomes", orderOutcomesRouter);
app.use("/api/subs/cancellations", subsCancellationsRouter);

app.get("/api/queue/stats", async (req, res) => {
  // console.log(`[api] queue stats requested`);
  try {
    const stats = await logStats();
    res.json({ ok: true, ...stats });
  } catch (err) {
    console.error(`[api] queue stats error:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

const upload = multer({ dest: uploadDir });

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "no_file" });
  res.json({ ok: true, filename: req.file.filename });
});

app.post("/api/bootstrap", verifySessionToken, async (req, res) => {
  try {
    const { shop, sessionToken } = req.shopify;
    const pool = getPool();

    const [rows] = await pool.execute(
      `SELECT access_token, scope, is_uninstalled
       FROM shopify_sessions
       WHERE shop = ?
       LIMIT 1`,
      [shop]
    );

    const existing = rows?.[0];
    const hasToken = Boolean(existing?.access_token);
    const isUninstalled = Number(existing?.is_uninstalled || 0) === 1;

    if (hasToken && !isUninstalled) {
      return res.json({ ok: true, shop, already: true });
    }

    const { accessToken, scope } = await exchangeOfflineToken({ shop, sessionToken });

    await pool.execute(
      `INSERT INTO shopify_sessions (shop, access_token, scope, is_uninstalled)
       VALUES (?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         access_token = VALUES(access_token),
         scope = VALUES(scope),
         is_uninstalled = 0`,
      [shop, accessToken, scope]
    );


    res.json({ ok: true, shop, already: false });
  } catch (e) {
    console.error("[bootstrap] failed", e);
    res.status(500).json({ ok: false, error: "bootstrap_failed" });
  }
});

const cleanKey = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");

app.get("/api/email-templates", verifySessionToken, async (req, res) => {
  try {
    const { shop } = req.shopify;
    const pool = getPool();

    const rawKeys = String(req.query.keys || "");
    const keys = rawKeys
      .split(",")
      .map(cleanKey)
      .filter(Boolean);

    if (!keys.length) return res.json({ ok: true, templates: {} });

    const placeholders = keys.map(() => "?").join(",");
    const sql = `SELECT template_key, title, subject, html, calendar_id
                 FROM email_templates
                 WHERE shop = ? AND template_key IN (${placeholders})`;

    const [rows] = await pool.execute(sql, [shop, ...keys]);

    const templates = {};
    for (const r of rows || []) {
      templates[r.template_key] = {
        templateKey: r.template_key,
        title: r.title || "",
        subject: r.subject || "",
        html: r.html || "",
        calendarId: r.calendar_id || "",
      };
    }

    res.json({ ok: true, templates });
  } catch (e) {
    console.error("[email-templates:get] failed", e);
    res.status(500).json({ ok: false, error: "templates_get_failed" });
  }
});

app.post("/api/email-templates/bulk", verifySessionToken, async (req, res) => {
  try {
    const { shop } = req.shopify;
    const pool = getPool();

    const templates = Array.isArray(req.body?.templates) ? req.body.templates : [];

    if (!templates.length) {
      return res.status(400).json({ ok: false, error: "no_templates" });
    }

    for (const t of templates) {
      const templateKey = cleanKey(t?.templateKey);
      if (!templateKey) continue;

      const title = String(t?.title || "");
      const subject = String(t?.subject || "");
      const html = String(t?.html || "");
      const calendarId = t?.calendarId === null ? null : String(t?.calendarId || "");

      await pool.execute(
        `INSERT INTO email_templates (shop, template_key, title, subject, html, calendar_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           title = VALUES(title),
           subject = VALUES(subject),
           html = VALUES(html),
           calendar_id = VALUES(calendar_id)`,
        [shop, templateKey, title, subject, html, calendarId]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("[email-templates:bulk] failed", e);
    res.status(500).json({ ok: false, error: "templates_save_failed" });
  }
});

app.post("/api/email-templates/test", verifySessionToken, async (req, res) => {
  try {
    const toEmail = String(req.body?.to || "").trim();
    const subject = String(req.body?.subject || "").trim();
    const html = String(req.body?.html || "");

    if (!toEmail) {
      return res.status(400).json({ ok: false, error: "to_email_required" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(toEmail)) {
      return res.status(400).json({ ok: false, error: "invalid_email" });
    }

    if (!subject) {
      return res.status(400).json({ ok: false, error: "subject_required" });
    }

    // console.log(`[email-templates:test] sending test email to=${toEmail} subject="${subject}"`);

    const result = await sendEmail(toEmail, subject, html);

    // console.log(`[email-templates:test] test email sent messageId=${result.messageId}`);

    res.json({ ok: true, messageId: result.messageId });
  } catch (e) {
    console.error("[email-templates:test] failed", e);
    res.status(500).json({ ok: false, error: "test_email_failed" });
  }
});

app.get("/api/workshop-settings", verifySessionToken, async (req, res) => {
  try {
    const { shop } = req.shopify;
    const pool = getPool();

    const [rows] = await pool.execute(
      `SELECT workshop_at, notify_offsets_json
       FROM workshop_settings
       WHERE shop = ?
       LIMIT 1`,
      [shop]
    );

    const row = rows?.[0] || null;

    let offsets = [];
    const raw = row?.notify_offsets_json;

    if (Array.isArray(raw)) {
      offsets = raw;
    } else if (typeof raw === "string") {
      try {
        offsets = JSON.parse(raw) || [];
      } catch {
        offsets = [];
      }
    } else if (raw && typeof raw === "object") {
      offsets = raw;
    }

    res.json({
      ok: true,
      data: {
        workshop_at_utc: row?.workshop_at ? new Date(row.workshop_at).toISOString() : null,
        notify_offsets_minutes: Array.isArray(offsets) ? offsets : [],
      },
    });
  } catch (e) {
    console.error("[workshop-settings:get] failed", e);
    res.status(500).json({ ok: false, error: "workshop_settings_get_failed" });
  }
});

app.post("/api/workshop-settings", verifySessionToken, async (req, res) => {
  try {
    const { shop } = req.shopify;
    const pool = getPool();

    const workshopAtUtcIso = req.body?.workshop_at_utc || null;
    const notifyOffsetsMinutes = Array.isArray(req.body?.notify_offsets_minutes)
      ? req.body.notify_offsets_minutes
      : [];

    const d = workshopAtUtcIso ? new Date(workshopAtUtcIso) : null;
    const workshopAtSql =
      d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 19).replace("T", " ") : null;

    const notifyOffsetsJson = JSON.stringify(notifyOffsetsMinutes);

    await pool.execute(
      `INSERT INTO workshop_settings (shop, workshop_at, notify_offsets_json)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         workshop_at = VALUES(workshop_at),
         notify_offsets_json = VALUES(notify_offsets_json)`,
      [shop, workshopAtSql, notifyOffsetsJson]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("[workshop-settings:save] failed", e);
    res.status(500).json({ ok: false, error: "workshop_settings_save_failed" });
  }
});


app.use("/api", (req, res) => {
  res.status(404).json({ ok: false, error: "not_found" });
});

if (isProd) {
  const distDir = path.join(__dirname, "frontend", "dist");
  app.use(serveStatic(distDir));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
} else {
  const viteProxy = createProxyMiddleware({
    target: "http://localhost:5173",
    changeOrigin: true,
    ws: true,
    logLevel: "debug",
  });

  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    return viteProxy(req, res, next);
  });
}

const start = async () => {
  try {
    // console.log(`[startup] initializing database tables...`);
    await ensureTables();

    // console.log(`[startup] starting worker pool...`);
    await startWorker();

    app.listen(PORT, () => {
      console.log(`\n========================================`);
      console.log(`[startup] Server running http://localhost:${PORT}`);
      console.log(`[startup] Webhook endpoint: POST /api/webhook/order_payment`);
      console.log(`[startup] Cron endpoint: POST /api/cron/workshop-notifications`);
      console.log(`[startup] Workshop registrations: GET /api/workshop-registrations`);
      console.log(`[startup] Subs import: POST /api/subs/import`);
      console.log(`[startup] Subs remove: POST /api/subs/remove`);
      console.log(`[startup] Removal results: GET /api/removal-results`);
      console.log(`[startup] Subscription contract: POST /api/subscription_contract_updated/updated`);
      console.log(`[startup] Health check: GET /api/health`);
      console.log(`[startup] Queue stats: GET /api/queue/stats`);
      console.log(`========================================\n`);
    });
  } catch (e) {
    console.error("[startup] failed:", e);
    process.exit(1);
  }
};

start();
