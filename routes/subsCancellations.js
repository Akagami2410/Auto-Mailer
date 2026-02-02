import { Router } from "express";
import { verifySessionToken } from "../utils/VerifySessionToken.js";
import { getPool } from "../utils/db.js";

const router = Router();

router.get("/months", verifySessionToken, async (req, res) => {
  const { shop } = req.shopify;

  // console.log(`[subsCancellations] GET /months shop=${shop}`);

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

    // console.log(`[subsCancellations] found ${months.length} months`);

    res.json({ ok: true, months });
  } catch (err) {
    console.error(`[subsCancellations] months error:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/", verifySessionToken, async (req, res) => {
  const { shop } = req.shopify;
  const monthStamp = req.query?.month || new Date().toISOString().slice(0, 7);
  const search = String(req.query?.q || "").trim();
  const page = Math.max(1, parseInt(req.query?.page || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query?.pageSize || "50", 10)));
  const offset = (page - 1) * pageSize;

  // console.log(`[subsCancellations] GET / shop=${shop} month=${monthStamp} q=${search} page=${page}`);

  try {
    const pool = getPool();

    let whereClause = "WHERE shop = ? AND month_stamp = ?";
    const params = [shop, monthStamp];

    if (search) {
      whereClause += " AND (email LIKE ? OR customer_id LIKE ? OR contract_id LIKE ? OR handle LIKE ?)";
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM previous_cancelled_subs ${whereClause}`,
      params
    );

    const total = countResult[0]?.total || 0;
    // console.log(`[subsCancellations] total: ${total}`);

    const [rows] = await pool.execute(
      `SELECT id, contract_id, customer_id, email, line_variant_id, handle,
              removal_status, removal_error, removed_at, created_at, updated_at
       FROM previous_cancelled_subs
       ${whereClause}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    // console.log(`[subsCancellations] fetched ${rows.length} rows`);

    const [statusCounts] = await pool.execute(
      `SELECT removal_status, COUNT(*) as count
       FROM previous_cancelled_subs
       ${whereClause}
       GROUP BY removal_status`,
      params
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

    // console.log(`[subsCancellations] summary:`, summary);

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
    console.error(`[subsCancellations] error:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/logs/:prevCancelledId", verifySessionToken, async (req, res) => {
  const { shop } = req.shopify;
  const prevCancelledId = req.params.prevCancelledId;

  // console.log(`[subsCancellations] GET /logs/${prevCancelledId} shop=${shop}`);

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

    // console.log(`[subsCancellations] found ${rows.length} logs`);

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
    console.error(`[subsCancellations] logs error:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
