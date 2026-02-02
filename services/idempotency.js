import { getPool } from "../utils/db.js";

export const ACTION_TYPES = {
  EMAIL_NORTHERN: "email_northern",
  EMAIL_SOUTHERN: "email_southern",
  EMAIL_WORKSHOP: "email_workshop",
  FULFILL_SUBSCRIPTION: "fulfill_subscription",
  FULFILL_WORKSHOP: "fulfill_workshop",
};

export const acquireAction = async (shop, orderId, action, details = null) => {
  const pool = getPool();
  const detailsJson = details ? JSON.stringify(details) : null;

  // console.log(`[idempotency] attempting to acquire action shop=${shop} order=${orderId} action=${action}`);

  try {
    const [result] = await pool.execute(
      `INSERT INTO order_action_logs (shop, order_id, action, details_json, status)
       VALUES (?, ?, ?, ?, 'acquired')`,
      [shop, orderId, action, detailsJson]
    );

    // console.log(`[idempotency] ACQUIRED action=${action} for order=${orderId} insertId=${result.insertId}`);
    return { acquired: true, insertId: result.insertId };
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      // console.log(`[idempotency] ALREADY EXISTS action=${action} for order=${orderId}, skipping`);

      const [existing] = await pool.execute(
        `SELECT id, status, created_at FROM order_action_logs
         WHERE shop = ? AND order_id = ? AND action = ?`,
        [shop, orderId, action]
      );

      const row = existing[0];
      // console.log(`[idempotency] existing action status=${row?.status} created=${row?.created_at}`);

      return { acquired: false, existing: row };
    }
    throw err;
  }
};

export const markActionComplete = async (shop, orderId, action, details = null) => {
  const pool = getPool();
  const detailsJson = details ? JSON.stringify(details) : null;

  // console.log(`[idempotency] marking action complete shop=${shop} order=${orderId} action=${action}`);

  const [result] = await pool.execute(
    `UPDATE order_action_logs
     SET status = 'completed', details_json = COALESCE(?, details_json)
     WHERE shop = ? AND order_id = ? AND action = ?`,
    [detailsJson, shop, orderId, action]
  );

  // console.log(`[idempotency] action marked complete, affectedRows=${result.affectedRows}`);
  return result.affectedRows > 0;
};

export const markActionFailed = async (shop, orderId, action, error) => {
  const pool = getPool();
  const detailsJson = JSON.stringify({ error: String(error).slice(0, 1000) });

  // console.log(`[idempotency] marking action failed shop=${shop} order=${orderId} action=${action}`);

  await pool.execute(
    `UPDATE order_action_logs
     SET status = 'failed', details_json = ?
     WHERE shop = ? AND order_id = ? AND action = ?`,
    [detailsJson, shop, orderId, action]
  );
};

export const releaseAction = async (shop, orderId, action) => {
  const pool = getPool();

  // console.log(`[idempotency] releasing action shop=${shop} order=${orderId} action=${action}`);

  const [result] = await pool.execute(
    `DELETE FROM order_action_logs
     WHERE shop = ? AND order_id = ? AND action = ? AND status = 'acquired'`,
    [shop, orderId, action]
  );

  // console.log(`[idempotency] action released, affectedRows=${result.affectedRows}`);
  return result.affectedRows > 0;
};

export const isActionDone = async (shop, orderId, action) => {
  const pool = getPool();

  const [rows] = await pool.execute(
    `SELECT id, status FROM order_action_logs
     WHERE shop = ? AND order_id = ? AND action = ?`,
    [shop, orderId, action]
  );

  const exists = rows.length > 0;
  const completed = rows[0]?.status === "completed";

  // console.log(`[idempotency] isActionDone shop=${shop} order=${orderId} action=${action} exists=${exists} completed=${completed}`);
  return exists;
};

export const getOrderActions = async (shop, orderId) => {
  const pool = getPool();

  const [rows] = await pool.execute(
    `SELECT action, status, details_json, created_at
     FROM order_action_logs
     WHERE shop = ? AND order_id = ?
     ORDER BY created_at ASC`,
    [shop, orderId]
  );

  // console.log(`[idempotency] order ${orderId} has ${rows.length} action(s)`);
  return rows;
};

export const withIdempotentAction = async (shop, orderId, action, details, fn) => {
  // console.log(`[idempotency] withIdempotentAction starting action=${action} order=${orderId}`);

  const { acquired, existing } = await acquireAction(shop, orderId, action, details);

  if (!acquired) {
    // console.log(`[idempotency] action ${action} already done for order ${orderId}, skipping execution`);
    return { skipped: true, reason: "already_done", existing };
  }

  try {
    // console.log(`[idempotency] executing action ${action} for order ${orderId}`);
    const result = await fn();

    await markActionComplete(shop, orderId, action, result);
    // console.log(`[idempotency] action ${action} completed successfully for order ${orderId}`);

    return { skipped: false, result };
  } catch (err) {
    console.error(`[idempotency] action ${action} failed for order ${orderId}:`, err.message);

    const is429 = err.status === 429 || err.statusCode === 429 || err.message?.includes("429");
    const isTransient = is429 || err.code === "ECONNRESET" || err.code === "ETIMEDOUT";

    if (isTransient) {
      // console.log(`[idempotency] transient error, releasing lock for retry`);
      await releaseAction(shop, orderId, action);
    } else {
      await markActionFailed(shop, orderId, action, err.message);
    }

    throw err;
  }
};
