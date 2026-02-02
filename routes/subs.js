import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { verifySessionToken } from "../utils/VerifySessionToken.js";
import { parseSubscriptionCsv, importSubscriptions, filterCancelledToPrevious } from "../services/subsImporter.js";
import { createRemovalJob, getRemovalJobStatus, processRemovalJob } from "../services/removalProcessor.js";
import crypto from "crypto";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, "..", "uploads");

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const upload = multer({ dest: uploadDir });

router.post("/import", verifySessionToken, upload.single("file"), async (req, res) => {
  const startTime = Date.now();
  const { shop } = req.shopify;

  // console.log(`\n========================================`);
  // console.log(`[subs] POST /import shop=${shop}`);
  // console.log(`========================================`);

  try {
    if (!req.file) {
      // console.log(`[subs] no file uploaded`);
      return res.status(400).json({ ok: false, error: "no_file" });
    }

    // console.log(`[subs] file uploaded: ${req.file.originalname} size=${req.file.size}`);

    const csvBuffer = fs.readFileSync(req.file.path);
    // console.log(`[subs] read file buffer length=${csvBuffer.length}`);

    const { rows, skipped, totalParsed } = parseSubscriptionCsv(csvBuffer);

    // console.log(`[subs] parsed: total=${totalParsed} valid=${rows.length} skipped=${skipped.length}`);

    const importStats = await importSubscriptions(shop, rows);

    fs.unlinkSync(req.file.path);
    // console.log(`[subs] temp file deleted`);

    const result = {
      ok: true,
      stats: {
        totalParsed,
        validRows: rows.length,
        skippedRows: skipped.length,
        ...importStats,
      },
      skipped: skipped.slice(0, 20),
      duration: Date.now() - startTime,
    };

    // console.log(`[subs] import complete in ${result.duration}ms`);
    // console.log(`[subs] stats:`, result.stats);

    res.json(result);
  } catch (err) {
    console.error(`[subs] import error:`, err.message);
    console.error(err.stack);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/remove", verifySessionToken, async (req, res) => {
  const startTime = Date.now();
  const { shop } = req.shopify;

  const monthStamp = req.body?.month || new Date().toISOString().slice(0, 7);

  // console.log(`\n========================================`);
  // console.log(`[subs] POST /remove shop=${shop} month=${monthStamp}`);
  // console.log(`========================================`);

  try {
    // console.log(`[subs] step A: filtering currently_cancelled to previous_cancelled`);
    const filterStats = await filterCancelledToPrevious(shop, monthStamp);

    // console.log(`[subs] filter stats:`, filterStats);

    // console.log(`[subs] step B: creating/enqueueing removal job`);
    const job = await createRemovalJob(shop, monthStamp);

    // console.log(`[subs] job created id=${job.id} status=${job.status}`);

    const workerId = `api_${crypto.randomBytes(4).toString("hex")}_${process.pid}`;

    // console.log(`[subs] starting async removal processing with worker=${workerId}`);

    processRemovalJob(shop, monthStamp, workerId)
      .then((result) => {
        // console.log(`[subs] async removal completed:`, result);
      })
      .catch((err) => {
        console.error(`[subs] async removal failed:`, err.message);
      });

    const result = {
      ok: true,
      filterStats,
      jobId: job.id,
      jobStatus: job.status,
      message: "Removal job started",
      duration: Date.now() - startTime,
    };

    // console.log(`[subs] remove endpoint done in ${result.duration}ms`);

    res.json(result);
  } catch (err) {
    console.error(`[subs] remove error:`, err.message);
    console.error(err.stack);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/remove/status", verifySessionToken, async (req, res) => {
  const { shop } = req.shopify;
  const monthStamp = req.query?.month || new Date().toISOString().slice(0, 7);

  // console.log(`[subs] GET /remove/status shop=${shop} month=${monthStamp}`);

  try {
    const status = await getRemovalJobStatus(shop, monthStamp);

    // console.log(`[subs] status:`, status.job?.status, status.counts);

    res.json({ ok: true, ...status });
  } catch (err) {
    console.error(`[subs] status error:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/stats", verifySessionToken, async (req, res) => {
  const { shop } = req.shopify;

  // console.log(`[subs] GET /stats shop=${shop}`);

  try {
    const { getPool } = await import("../utils/db.js");
    const pool = getPool();

    const [activeCount] = await pool.execute(
      `SELECT COUNT(*) as count FROM active_subs WHERE shop = ?`,
      [shop]
    );

    const [cancelledCount] = await pool.execute(
      `SELECT COUNT(*) as count FROM currently_cancelled_subs WHERE shop = ?`,
      [shop]
    );

    const [previousCount] = await pool.execute(
      `SELECT COUNT(*) as count FROM previous_cancelled_subs WHERE shop = ?`,
      [shop]
    );

    const stats = {
      activeSubs: activeCount[0]?.count || 0,
      currentlyCancelled: cancelledCount[0]?.count || 0,
      previousCancelled: previousCount[0]?.count || 0,
    };

    // console.log(`[subs] stats:`, stats);

    res.json({ ok: true, stats });
  } catch (err) {
    console.error(`[subs] stats error:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/clear", verifySessionToken, async (req, res) => {
  const { shop } = req.shopify;
  const table = req.body?.table;

  // console.log(`[subs] POST /clear shop=${shop} table=${table}`);

  const validTables = ["active_subs", "currently_cancelled_subs"];

  if (!validTables.includes(table)) {
    return res.status(400).json({ ok: false, error: "invalid_table" });
  }

  try {
    const { getPool } = await import("../utils/db.js");
    const pool = getPool();

    const [result] = await pool.execute(
      `DELETE FROM ${table} WHERE shop = ?`,
      [shop]
    );

    // console.log(`[subs] cleared ${result.affectedRows} rows from ${table}`);

    res.json({ ok: true, deleted: result.affectedRows });
  } catch (err) {
    console.error(`[subs] clear error:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
