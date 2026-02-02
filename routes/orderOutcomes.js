import { Router } from "express";
import { verifySessionToken } from "../utils/VerifySessionToken.js";
import { getPool } from "../utils/db.js";

const router = Router();

router.get("/", verifySessionToken, async (req, res) => {
  const { shop } = req.shopify;

  const fromDate = req.query?.from || null;
  const toDate = req.query?.to || null;
  const search = String(req.query?.q || "").trim();
  const page = Math.max(1, parseInt(req.query?.page || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query?.pageSize || "50", 10)));
  const offset = (page - 1) * pageSize;

  // console.log(`[orderOutcomes] GET / shop=${shop} from=${fromDate} to=${toDate} q=${search} page=${page}`);

  try {
    const pool = getPool();

    let whereClause = "WHERE os.shop = ?";
    const params = [shop];

    if (fromDate) {
      whereClause += " AND os.created_at >= ?";
      params.push(`${fromDate} 00:00:00`);
    }

    if (toDate) {
      whereClause += " AND os.created_at <= ?";
      params.push(`${toDate} 23:59:59`);
    }

    if (search) {
      whereClause += " AND (os.email LIKE ? OR os.order_id LIKE ? OR os.order_name LIKE ?)";
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM orders_seen os ${whereClause}`,
      params
    );

    const total = countResult[0]?.total || 0;
    // console.log(`[orderOutcomes] total orders: ${total}`);

    const [orders] = await pool.execute(
      `SELECT os.id, os.order_id, os.order_name, os.customer_id, os.email, os.created_at
       FROM orders_seen os
       ${whereClause}
       ORDER BY os.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    // console.log(`[orderOutcomes] fetched ${orders.length} orders`);

    const orderIds = orders.map((o) => o.order_id);

    let actionsMap = {};
    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => "?").join(",");
      const [actions] = await pool.execute(
        `SELECT order_id, action, status, details_json, created_at, updated_at
         FROM order_action_logs
         WHERE shop = ? AND order_id IN (${placeholders})
         ORDER BY created_at ASC`,
        [shop, ...orderIds]
      );

      for (const a of actions) {
        if (!actionsMap[a.order_id]) actionsMap[a.order_id] = [];
        actionsMap[a.order_id].push({
          action: a.action,
          status: a.status,
          details: a.details_json ? JSON.parse(a.details_json) : null,
          createdAt: a.created_at,
          updatedAt: a.updated_at,
        });
      }
    }

    const rows = orders.map((o) => {
      const actions = actionsMap[o.order_id] || [];
      const lastAction = actions.length > 0 ? actions[actions.length - 1] : null;

      return {
        id: o.id,
        orderId: o.order_id,
        orderName: o.order_name,
        customerId: o.customer_id,
        email: o.email,
        createdAt: o.created_at,
        actions: actions.map((a) => a.action),
        actionDetails: actions,
        lastStatus: lastAction?.status || null,
        lastAction: lastAction?.action || null,
      };
    });

    const [statusCounts] = await pool.execute(
      `SELECT oal.status, COUNT(DISTINCT oal.order_id) as count
       FROM order_action_logs oal
       INNER JOIN orders_seen os ON os.shop = oal.shop AND os.order_id = oal.order_id
       ${whereClause.replace(/os\./g, "oal.").replace("oal.order_id", "os.order_id").replace("oal.order_name", "os.order_name").replace("oal.email", "os.email").replace("oal.created_at >=", "os.created_at >=").replace("oal.created_at <=", "os.created_at <=")}
       GROUP BY oal.status`,
      params
    );

    const summary = { total, completed: 0, failed: 0, skipped: 0 };
    for (const row of statusCounts) {
      summary[row.status] = row.count;
    }

    // console.log(`[orderOutcomes] summary:`, summary);

    res.json({
      ok: true,
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      summary,
    });
  } catch (err) {
    console.error(`[orderOutcomes] error:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/actions/:orderId", verifySessionToken, async (req, res) => {
  const { shop } = req.shopify;
  const orderId = req.params.orderId;

  // console.log(`[orderOutcomes] GET /actions/${orderId} shop=${shop}`);

  try {
    const pool = getPool();

    const [rows] = await pool.execute(
      `SELECT id, action, status, details_json, created_at, updated_at
       FROM order_action_logs
       WHERE shop = ? AND order_id = ?
       ORDER BY created_at ASC`,
      [shop, orderId]
    );

    // console.log(`[orderOutcomes] found ${rows.length} actions for order ${orderId}`);

    res.json({
      ok: true,
      actions: rows.map((r) => ({
        id: r.id,
        action: r.action,
        status: r.status,
        details: r.details_json ? JSON.parse(r.details_json) : null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    console.error(`[orderOutcomes] actions error:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
