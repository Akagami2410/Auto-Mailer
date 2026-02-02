import { Router } from "express";
import { verifySessionToken } from "../utils/VerifySessionToken.js";
import { getPool } from "../utils/db.js";

const router = Router();

router.get("/months", verifySessionToken, async (req, res) => {
  const { shop } = req.shopify;

  // console.log(`[removalResults] GET /months shop=${shop}`);

  try {
    const pool = getPool();

    const [rows] = await pool.execute(
      `SELECT DISTINCT month_stamp
       FROM previous_cancelled_subs
       WHERE shop = ?
       ORDER BY month_stamp DESC`,
      [shop]
    );

    const months = rows.map((r) => r.month_stamp);

    // console.log(`[removalResults] found ${months.length} months`);

    res.json({ ok: true, months });
  } catch (err) {
    console.error(`[removalResults] months error:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/", verifySessionToken, async (req, res) => {
  const { shop } = req.shopify;
  const monthStamp = req.query?.month || new Date().toISOString().slice(0, 7);
  const page = Math.max(1, parseInt(req.query?.page || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query?.pageSize || "50", 10)));
  const offset = (page - 1) * pageSize;

  // console.log(`[removalResults] GET / shop=${shop} month=${monthStamp} page=${page} pageSize=${pageSize}`);

  try {
    const pool = getPool();

    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM previous_cancelled_subs WHERE shop = ? AND month_stamp = ?`,
      [shop, monthStamp]
    );

    const total = countResult[0]?.total || 0;

    // console.log(`[removalResults] total rows: ${total}`);

    const [rows] = await pool.execute(
      `SELECT id, contract_id, customer_id, email, line_variant_id, handle,
              removal_status, removal_error, removed_at, created_at, updated_at
       FROM previous_cancelled_subs
       WHERE shop = ? AND month_stamp = ?
       ORDER BY id ASC
       LIMIT ? OFFSET ?`,
      [shop, monthStamp, pageSize, offset]
    );

    // console.log(`[removalResults] returned ${rows.length} rows`);

    const [statusCounts] = await pool.execute(
      `SELECT removal_status, COUNT(*) as count
       FROM previous_cancelled_subs
       WHERE shop = ? AND month_stamp = ?
       GROUP BY removal_status`,
      [shop, monthStamp]
    );

    const summary = {
      total,
      pending: 0,
      done: 0,
      not_found: 0,
      failed: 0,
      skipped: 0,
    };

    for (const row of statusCounts) {
      summary[row.removal_status] = row.count;
    }

    // console.log(`[removalResults] summary:`, summary);

    res.json({
      ok: true,
      rows: rows.map((r) => ({
        id: r.id,
        contractId: r.contract_id,
        customerId: r.customer_id,
        email: r.email,
        lineVariantId: r.line_variant_id,
        handle: r.handle,
        removalStatus: r.removal_status,
        removalError: r.removal_error,
        removedAt: r.removed_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      summary,
    });
  } catch (err) {
    console.error(`[removalResults] error:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/logs", verifySessionToken, async (req, res) => {
  const { shop } = req.shopify;
  const prevCancelledId = req.query?.prev_cancelled_id;

  // console.log(`[removalResults] GET /logs shop=${shop} prev_cancelled_id=${prevCancelledId}`);

  if (!prevCancelledId) {
    return res.status(400).json({ ok: false, error: "prev_cancelled_id required" });
  }

  try {
    const pool = getPool();

    const [ownerCheck] = await pool.execute(
      `SELECT id FROM previous_cancelled_subs WHERE id = ? AND shop = ?`,
      [prevCancelledId, shop]
    );

    if (ownerCheck.length === 0) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const [rows] = await pool.execute(
      `SELECT id, calendar_key, email, subscriber_id, status, error, created_at
       FROM removal_logs
       WHERE prev_cancelled_id = ?
       ORDER BY created_at DESC`,
      [prevCancelledId]
    );

    // console.log(`[removalResults] found ${rows.length} logs`);

    res.json({
      ok: true,
      logs: rows.map((r) => ({
        id: r.id,
        calendarKey: r.calendar_key,
        email: r.email,
        subscriberId: r.subscriber_id,
        status: r.status,
        error: r.error,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error(`[removalResults] logs error:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/summary", verifySessionToken, async (req, res) => {
  const { shop } = req.shopify;

  // console.log(`[removalResults] GET /summary shop=${shop}`);

  try {
    const pool = getPool();

    const [rows] = await pool.execute(
      `SELECT month_stamp,
              SUM(CASE WHEN removal_status = 'pending' THEN 1 ELSE 0 END) as pending,
              SUM(CASE WHEN removal_status = 'done' THEN 1 ELSE 0 END) as done,
              SUM(CASE WHEN removal_status = 'not_found' THEN 1 ELSE 0 END) as not_found,
              SUM(CASE WHEN removal_status = 'failed' THEN 1 ELSE 0 END) as failed,
              SUM(CASE WHEN removal_status = 'skipped' THEN 1 ELSE 0 END) as skipped,
              COUNT(*) as total
       FROM previous_cancelled_subs
       WHERE shop = ?
       GROUP BY month_stamp
       ORDER BY month_stamp DESC`,
      [shop]
    );

    // console.log(`[removalResults] summary for ${rows.length} months`);

    res.json({
      ok: true,
      months: rows.map((r) => ({
        month: r.month_stamp,
        pending: r.pending,
        done: r.done,
        notFound: r.not_found,
        failed: r.failed,
        skipped: r.skipped,
        total: r.total,
      })),
    });
  } catch (err) {
    console.error(`[removalResults] summary error:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
