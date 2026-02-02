import { Router } from "express";
import { getPool } from "../utils/db.js";
import { verifySessionToken } from "../utils/VerifySessionToken.js";
import { broadcastToRegistrations } from "../services/workshopNotifications.js";

const router = Router();

router.get("/", verifySessionToken, async (req, res) => {
  const { shop } = req.shopify;
  const month = req.query.month || null;
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || "50", 10)));
  const offset = (page - 1) * pageSize;

  // console.log(`[workshopRegistrations] GET shop=${shop} month=${month} page=${page} pageSize=${pageSize}`);

  try {
    const pool = getPool();
    let whereClause = "shop = ?";
    const params = [shop];

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      whereClause += " AND DATE_FORMAT(created_at, '%Y-%m') = ?";
      params.push(month);
      // console.log(`[workshopRegistrations] filtering by month=${month}`);
    }

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as total FROM workshop_registrations WHERE ${whereClause}`,
      params
    );
    const total = countRows[0]?.total || 0;

    // console.log(`[workshopRegistrations] total count=${total}`);

    const [rows] = await pool.execute(
      `SELECT id, order_id, order_name, customer_id, email, first_name, last_name,
              purchased_at, workshop_at, created_at, updated_at
       FROM workshop_registrations
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    // console.log(`[workshopRegistrations] returning ${rows.length} row(s)`);

    res.json({
      ok: true,
      data: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });

  } catch (err) {
    console.error(`[workshopRegistrations] GET failed:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/months", verifySessionToken, async (req, res) => {
  const { shop } = req.shopify;

  // console.log(`[workshopRegistrations] GET /months shop=${shop}`);

  try {
    const pool = getPool();

    const [rows] = await pool.execute(
      `SELECT DISTINCT DATE_FORMAT(created_at, '%Y-%m') as month_stamp
       FROM workshop_registrations
       WHERE shop = ?
       ORDER BY month_stamp DESC`,
      [shop]
    );

    const months = rows.map((r) => r.month_stamp);

    // console.log(`[workshopRegistrations] found ${months.length} distinct month(s)`);

    res.json({
      ok: true,
      months,
    });

  } catch (err) {
    console.error(`[workshopRegistrations] GET /months failed:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/broadcast", verifySessionToken, async (req, res) => {
  const { shop } = req.shopify;
  const month = req.body?.month || null;

  // console.log(`[workshopRegistrations] POST /broadcast shop=${shop} month=${month}`);

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    console.error(`[workshopRegistrations] invalid month format: ${month}`);
    return res.status(400).json({ ok: false, error: "invalid_month_format" });
  }

  try {
    const stats = await broadcastToRegistrations(shop, month);

    // console.log(`[workshopRegistrations] broadcast complete: ${JSON.stringify(stats)}`);

    res.json({
      ok: true,
      sent: stats.sent,
      skipped: stats.skipped,
      failed: stats.failed,
      total: stats.total,
    });

  } catch (err) {
    console.error(`[workshopRegistrations] POST /broadcast failed:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/stats", verifySessionToken, async (req, res) => {
  const { shop } = req.shopify;
  const month = req.query.month || null;

  // console.log(`[workshopRegistrations] GET /stats shop=${shop} month=${month}`);

  try {
    const pool = getPool();

    let whereClause = "shop = ?";
    const params = [shop];

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      whereClause += " AND DATE_FORMAT(created_at, '%Y-%m') = ?";
      params.push(month);
    }

    const [regCount] = await pool.execute(
      `SELECT COUNT(*) as count FROM workshop_registrations WHERE ${whereClause}`,
      params
    );

    let broadcastParams = [shop];
    let broadcastWhere = "shop = ?";
    if (month) {
      broadcastWhere += " AND month_stamp = ?";
      broadcastParams.push(month);
    }

    const [broadcastCount] = await pool.execute(
      `SELECT
         SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
         COUNT(*) as total
       FROM workshop_broadcast_logs
       WHERE ${broadcastWhere}`,
      broadcastParams
    );

    res.json({
      ok: true,
      registrations: regCount[0]?.count || 0,
      broadcast: {
        sent: broadcastCount[0]?.sent || 0,
        failed: broadcastCount[0]?.failed || 0,
        total: broadcastCount[0]?.total || 0,
      },
    });

  } catch (err) {
    console.error(`[workshopRegistrations] GET /stats failed:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
