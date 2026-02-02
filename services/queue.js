import { getPool } from "../utils/db.js";
import crypto from "crypto";

const workerId = `worker_${crypto.randomBytes(4).toString("hex")}_${process.pid}`;

export const enqueueJob = async ({ shop, jobType, orderId, webhookId, payload, delaySeconds = 0 }) => {
  const pool = getPool();
  const payloadJson = JSON.stringify(payload);

  // console.log(`[queue] enqueue job shop=${shop} type=${jobType} orderId=${orderId} webhookId=${webhookId} delay=${delaySeconds}s`);

  try {
    const [result] = await pool.execute(
      `INSERT INTO webhook_jobs (shop, webhook_id, job_type, order_id, status, payload_json, run_after)
       VALUES (?, ?, ?, ?, 'queued', ?, DATE_ADD(NOW(), INTERVAL ? SECOND))
       ON DUPLICATE KEY UPDATE
         webhook_id = COALESCE(VALUES(webhook_id), webhook_id),
         payload_json = CASE WHEN status = 'completed' THEN payload_json ELSE VALUES(payload_json) END`,
      [shop, webhookId, jobType, orderId, payloadJson, delaySeconds]
    );

    const inserted = result.affectedRows === 1;
    const updated = result.affectedRows === 2;

    if (inserted) {
      // console.log(`[queue] NEW job inserted id=${result.insertId}`);
    } else if (updated) {
      // console.log(`[queue] job already exists, payload updated if not completed`);
    } else {
      // console.log(`[queue] job exists and completed, no update`);
    }

    return { inserted, updated, insertId: result.insertId };
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      // console.log(`[queue] duplicate job ignored (race condition)`);
      return { inserted: false, updated: false, duplicate: true };
    }
    throw err;
  }
};

export const claimJob = async (limit = 1) => {
  const pool = getPool();
  const conn = await pool.getConnection();

  // console.log(`[queue] ${workerId} attempting to claim ${limit} job(s)`);

  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      `SELECT id, shop, job_type, order_id, payload_json, attempts
       FROM webhook_jobs
       WHERE status = 'queued'
         AND run_after <= NOW()
       ORDER BY run_after ASC, id ASC
       LIMIT ?
       FOR UPDATE SKIP LOCKED`,
      [limit]
    );

    if (!rows.length) {
      await conn.rollback();
      // console.log(`[queue] ${workerId} no jobs available`);
      return [];
    }

    const jobIds = rows.map((r) => r.id);
    // console.log(`[queue] ${workerId} claiming jobs: ${jobIds.join(", ")}`);

    const placeholders = jobIds.map(() => "?").join(",");
    await conn.execute(
      `UPDATE webhook_jobs
       SET status = 'processing', locked_at = NOW(), locked_by = ?, attempts = attempts + 1
       WHERE id IN (${placeholders})`,
      [workerId, ...jobIds]
    );

    await conn.commit();

    const jobs = rows.map((r) => ({
      id: r.id,
      shop: r.shop,
      jobType: r.job_type,
      orderId: r.order_id,
      payload: JSON.parse(r.payload_json || "{}"),
      attempts: r.attempts + 1,
    }));

    // console.log(`[queue] ${workerId} claimed ${jobs.length} job(s)`);
    return jobs;
  } catch (err) {
    await conn.rollback();
    console.error(`[queue] ${workerId} claim error:`, err.message);
    throw err;
  } finally {
    conn.release();
  }
};

export const completeJob = async (jobId) => {
  const pool = getPool();

  // console.log(`[queue] completing job id=${jobId}`);

  const [result] = await pool.execute(
    `UPDATE webhook_jobs
     SET status = 'completed', locked_at = NULL, locked_by = NULL, last_error = NULL
     WHERE id = ?`,
    [jobId]
  );

  // console.log(`[queue] job ${jobId} marked completed, affectedRows=${result.affectedRows}`);
  return result.affectedRows > 0;
};

export const failJob = async (jobId, error, retryAfterSeconds = null) => {
  const pool = getPool();
  const maxAttempts = parseInt(process.env.WORKER_MAX_ATTEMPTS || "5", 10);

  // console.log(`[queue] failing job id=${jobId} error="${error}" retryAfter=${retryAfterSeconds}s`);

  const [rows] = await pool.execute(
    `SELECT attempts FROM webhook_jobs WHERE id = ?`,
    [jobId]
  );

  const attempts = rows[0]?.attempts || 0;
  const exhausted = attempts >= maxAttempts;

  if (exhausted) {
    // console.log(`[queue] job ${jobId} exhausted after ${attempts} attempts, marking failed`);

    await pool.execute(
      `UPDATE webhook_jobs
       SET status = 'failed', locked_at = NULL, locked_by = NULL, last_error = ?
       WHERE id = ?`,
      [String(error).slice(0, 2000), jobId]
    );
    return { status: "failed", attempts };
  }

  let backoffSeconds;
  if (retryAfterSeconds !== null) {
    backoffSeconds = retryAfterSeconds;
    // console.log(`[queue] using Retry-After header: ${backoffSeconds}s`);
  } else {
    backoffSeconds = Math.min(300, Math.pow(2, attempts) * 5);
    // console.log(`[queue] exponential backoff attempt ${attempts}: ${backoffSeconds}s`);
  }

  await pool.execute(
    `UPDATE webhook_jobs
     SET status = 'queued', locked_at = NULL, locked_by = NULL,
         last_error = ?, run_after = DATE_ADD(NOW(), INTERVAL ? SECOND)
     WHERE id = ?`,
    [String(error).slice(0, 2000), backoffSeconds, jobId]
  );

  // console.log(`[queue] job ${jobId} requeued, next attempt in ${backoffSeconds}s`);
  return { status: "requeued", attempts, backoffSeconds };
};

export const rescheduleJob = async (jobId, delaySeconds) => {
  const pool = getPool();

  // console.log(`[queue] rescheduling job id=${jobId} delay=${delaySeconds}s`);

  await pool.execute(
    `UPDATE webhook_jobs
     SET status = 'queued', locked_at = NULL, locked_by = NULL,
         run_after = DATE_ADD(NOW(), INTERVAL ? SECOND)
     WHERE id = ?`,
    [delaySeconds, jobId]
  );

  // console.log(`[queue] job ${jobId} rescheduled`);
};

export const getQueueStats = async () => {
  const pool = getPool();

  const [rows] = await pool.execute(
    `SELECT status, COUNT(*) as count
     FROM webhook_jobs
     GROUP BY status`
  );

  const stats = { queued: 0, processing: 0, completed: 0, failed: 0 };
  for (const r of rows) {
    stats[r.status] = r.count;
  }

  // console.log(`[queue] stats: queued=${stats.queued} processing=${stats.processing} completed=${stats.completed} failed=${stats.failed}`);
  return stats;
};

export { workerId };
