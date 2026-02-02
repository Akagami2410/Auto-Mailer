import { getPool } from "../utils/db.js";
import { getCustomerEmail, ShopifyRateLimitError as ShopifyRateLimit } from "./customerLookup.js";
import {
  getCalendarKeyForVariant,
  getCalendarId,
  ensureSnapshot,
  lookupSubscriberByEmail,
  deleteSubscriber,
  AddEventRateLimitError,
} from "./addEvent.js";

export const createRemovalJob = async (shop, monthStamp) => {
  const pool = getPool();

  // console.log(`[removalProcessor] createRemovalJob shop=${shop} month=${monthStamp}`);

  try {
    const [result] = await pool.execute(
      `INSERT INTO removal_jobs (shop, month_stamp, status, attempts)
       VALUES (?, ?, 'queued', 0)
       ON DUPLICATE KEY UPDATE
         status = CASE WHEN status IN ('completed', 'failed') THEN 'queued' ELSE status END,
         attempts = CASE WHEN status IN ('completed', 'failed') THEN 0 ELSE attempts END`,
      [shop, monthStamp]
    );

    // console.log(`[removalProcessor] job created/updated affectedRows=${result.affectedRows}`);

    const [rows] = await pool.execute(
      `SELECT id, status FROM removal_jobs WHERE shop = ? AND month_stamp = ?`,
      [shop, monthStamp]
    );

    // console.log(`[removalProcessor] job id=${rows[0]?.id} status=${rows[0]?.status}`);
    return rows[0];
  } catch (err) {
    console.error(`[removalProcessor] createRemovalJob error:`, err.message);
    throw err;
  }
};

export const claimRemovalJob = async (shop, monthStamp, workerId) => {
  const pool = getPool();
  const conn = await pool.getConnection();

  // console.log(`[removalProcessor] claimRemovalJob shop=${shop} month=${monthStamp} worker=${workerId}`);

  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      `SELECT id, status, attempts FROM removal_jobs
       WHERE shop = ? AND month_stamp = ? AND status = 'queued'
       FOR UPDATE`,
      [shop, monthStamp]
    );

    if (rows.length === 0) {
      await conn.rollback();
      // console.log(`[removalProcessor] no queued job found`);
      return null;
    }

    const job = rows[0];

    await conn.execute(
      `UPDATE removal_jobs
       SET status = 'processing', locked_at = NOW(), locked_by = ?, attempts = attempts + 1
       WHERE id = ?`,
      [workerId, job.id]
    );

    await conn.commit();

    // console.log(`[removalProcessor] claimed job id=${job.id}`);
    return { ...job, id: job.id };
  } catch (err) {
    await conn.rollback();
    console.error(`[removalProcessor] claimRemovalJob error:`, err.message);
    throw err;
  } finally {
    conn.release();
  }
};

export const completeRemovalJob = async (jobId, stats) => {
  const pool = getPool();

  // console.log(`[removalProcessor] completeRemovalJob jobId=${jobId}`);

  await pool.execute(
    `UPDATE removal_jobs
     SET status = 'completed', locked_at = NULL, locked_by = NULL, stats_json = ?, last_error = NULL
     WHERE id = ?`,
    [JSON.stringify(stats), jobId]
  );

  // console.log(`[removalProcessor] job ${jobId} marked completed`);
};

export const failRemovalJob = async (jobId, error, retryAfterSeconds = null) => {
  const pool = getPool();
  const maxAttempts = 5;

  // console.log(`[removalProcessor] failRemovalJob jobId=${jobId} error="${error}"`);

  const [rows] = await pool.execute(
    `SELECT attempts FROM removal_jobs WHERE id = ?`,
    [jobId]
  );

  const attempts = rows[0]?.attempts || 0;

  if (attempts >= maxAttempts) {
    // console.log(`[removalProcessor] job ${jobId} exhausted after ${attempts} attempts`);

    await pool.execute(
      `UPDATE removal_jobs SET status = 'failed', locked_at = NULL, locked_by = NULL, last_error = ? WHERE id = ?`,
      [String(error).slice(0, 2000), jobId]
    );

    return { status: "failed" };
  }

  const backoff = retryAfterSeconds || Math.min(300, Math.pow(2, attempts) * 10);

  // console.log(`[removalProcessor] job ${jobId} will retry in ${backoff}s`);

  await pool.execute(
    `UPDATE removal_jobs SET status = 'queued', locked_at = NULL, locked_by = NULL, last_error = ? WHERE id = ?`,
    [String(error).slice(0, 2000), jobId]
  );

  return { status: "requeued", backoff };
};

export const getRemovalJobStatus = async (shop, monthStamp) => {
  const pool = getPool();

  // console.log(`[removalProcessor] getRemovalJobStatus shop=${shop} month=${monthStamp}`);

  const [jobRows] = await pool.execute(
    `SELECT id, status, attempts, stats_json, last_error, created_at, updated_at
     FROM removal_jobs
     WHERE shop = ? AND month_stamp = ?`,
    [shop, monthStamp]
  );

  const job = jobRows[0] || null;

  const [countRows] = await pool.execute(
    `SELECT removal_status, COUNT(*) as count
     FROM previous_cancelled_subs
     WHERE shop = ? AND month_stamp = ?
     GROUP BY removal_status`,
    [shop, monthStamp]
  );

  const counts = {
    pending: 0,
    done: 0,
    not_found: 0,
    failed: 0,
    skipped: 0,
  };

  for (const row of countRows) {
    counts[row.removal_status] = row.count;
  }

  // console.log(`[removalProcessor] job status:`, job?.status, `counts:`, counts);

  return {
    job: job
      ? {
          id: job.id,
          status: job.status,
          attempts: job.attempts,
          stats: job.stats_json ? JSON.parse(job.stats_json) : null,
          lastError: job.last_error,
          createdAt: job.created_at,
          updatedAt: job.updated_at,
        }
      : null,
    counts,
  };
};

export const processRemovalJob = async (shop, monthStamp, workerId) => {
  const pool = getPool();

  // console.log(`[removalProcessor] processRemovalJob shop=${shop} month=${monthStamp}`);

  const job = await claimRemovalJob(shop, monthStamp, workerId);

  if (!job) {
    // console.log(`[removalProcessor] no job to process`);
    return { processed: false, reason: "no_job" };
  }

  const stats = {
    processed: 0,
    done: 0,
    notFound: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  try {
    const [pendingRows] = await pool.execute(
      `SELECT id, contract_id, customer_id, email, line_variant_id, handle
       FROM previous_cancelled_subs
       WHERE shop = ? AND month_stamp = ? AND removal_status = 'pending'
       ORDER BY id ASC`,
      [shop, monthStamp]
    );

    // console.log(`[removalProcessor] found ${pendingRows.length} pending rows`);

    const snapshotCache = {};

    for (const row of pendingRows) {
      // console.log(`\n[removalProcessor] processing id=${row.id} contract=${row.contract_id} customer=${row.customer_id}`);
      stats.processed++;

      try {
        let email = row.email;

        if (!email && row.customer_id) {
          // console.log(`[removalProcessor] fetching email from Shopify for customer ${row.customer_id}`);

          const customerData = await getCustomerEmail(shop, row.customer_id);

          if (customerData?.email) {
            email = customerData.email;

            await pool.execute(
              `UPDATE previous_cancelled_subs SET email = ? WHERE id = ?`,
              [email, row.id]
            );

            // console.log(`[removalProcessor] updated email=${email}`);
          } else {
            // console.log(`[removalProcessor] no email found for customer ${row.customer_id}`);

            await pool.execute(
              `UPDATE previous_cancelled_subs SET removal_status = 'not_found', removal_error = ? WHERE id = ?`,
              ["Customer email not found in Shopify", row.id]
            );

            await logRemovalAttempt(pool, shop, row.id, null, email, null, "not_found", "Customer email not found");

            stats.notFound++;
            continue;
          }
        }

        if (!email) {
          // console.log(`[removalProcessor] no email available, marking not_found`);

          await pool.execute(
            `UPDATE previous_cancelled_subs SET removal_status = 'not_found', removal_error = ? WHERE id = ?`,
            ["No email available", row.id]
          );

          await logRemovalAttempt(pool, shop, row.id, null, null, null, "not_found", "No email available");

          stats.notFound++;
          continue;
        }

        const calendarKey = getCalendarKeyForVariant(row.line_variant_id);

        if (!calendarKey) {
          // console.log(`[removalProcessor] no calendar mapping for variant ${row.line_variant_id}, marking skipped`);

          await pool.execute(
            `UPDATE previous_cancelled_subs SET removal_status = 'skipped', removal_error = ? WHERE id = ?`,
            ["No calendar mapping for variant", row.id]
          );

          await logRemovalAttempt(pool, shop, row.id, null, email, null, "skipped", "No calendar mapping");

          stats.skipped++;
          continue;
        }

        const cacheKey = `${shop}:${monthStamp}:${calendarKey}`;
        if (!snapshotCache[cacheKey]) {
          // console.log(`[removalProcessor] ensuring snapshot for ${cacheKey}`);
          snapshotCache[cacheKey] = await ensureSnapshot(shop, monthStamp, calendarKey);
        }

        const snapshotId = snapshotCache[cacheKey];

        if (!snapshotId) {
          // console.log(`[removalProcessor] no snapshot available, marking skipped`);

          await pool.execute(
            `UPDATE previous_cancelled_subs SET removal_status = 'skipped', removal_error = ? WHERE id = ?`,
            ["Could not create snapshot", row.id]
          );

          await logRemovalAttempt(pool, shop, row.id, calendarKey, email, null, "skipped", "No snapshot");

          stats.skipped++;
          continue;
        }

        const subscriberId = await lookupSubscriberByEmail(snapshotId, email);

        if (!subscriberId) {
          // console.log(`[removalProcessor] subscriber not found in AddEvent for email=${email}`);

          await pool.execute(
            `UPDATE previous_cancelled_subs SET removal_status = 'not_found', removal_error = ? WHERE id = ?`,
            ["Subscriber not found in AddEvent calendar", row.id]
          );

          await logRemovalAttempt(pool, shop, row.id, calendarKey, email, null, "not_found", "Not in AddEvent");

          stats.notFound++;
          continue;
        }

        const calendarId = getCalendarId(calendarKey);
        // console.log(`[removalProcessor] deleting subscriber ${subscriberId} from calendar ${calendarId}`);

        await deleteSubscriber(calendarId, subscriberId);

        const removedAtSql = new Date().toISOString().slice(0, 19).replace("T", " ");

        await pool.execute(
          `UPDATE previous_cancelled_subs SET removal_status = 'done', removed_at = ?, removal_error = NULL WHERE id = ?`,
          [removedAtSql, row.id]
        );

        await logRemovalAttempt(pool, shop, row.id, calendarKey, email, subscriberId, "done", null);

        // console.log(`[removalProcessor] DONE - removed subscriber ${subscriberId}`);
        stats.done++;

      } catch (err) {
        console.error(`[removalProcessor] error processing row ${row.id}:`, err.message);

        const isRateLimit = err instanceof AddEventRateLimitError ||
          err instanceof ShopifyRateLimit ||
          err.status === 429;

        if (isRateLimit) {
          // console.log(`[removalProcessor] rate limit hit, failing job for retry`);
          throw err;
        }

        await pool.execute(
          `UPDATE previous_cancelled_subs SET removal_status = 'failed', removal_error = ? WHERE id = ?`,
          [String(err.message).slice(0, 1000), row.id]
        );

        await logRemovalAttempt(pool, shop, row.id, null, row.email, null, "failed", err.message);

        stats.failed++;
        stats.errors.push({ id: row.id, error: err.message });
      }
    }

    await completeRemovalJob(job.id, stats);

    // console.log(`[removalProcessor] job completed:`, stats);
    return { processed: true, stats };

  } catch (err) {
    console.error(`[removalProcessor] job failed:`, err.message);

    const retryAfter = err.retryAfter || null;
    await failRemovalJob(job.id, err.message, retryAfter);

    return { processed: false, error: err.message, stats };
  }
};

const logRemovalAttempt = async (pool, shop, prevCancelledId, calendarKey, email, subscriberId, status, error) => {
  // console.log(`[removalProcessor] logging removal attempt prev_id=${prevCancelledId} status=${status}`);

  try {
    await pool.execute(
      `INSERT INTO removal_logs (shop, prev_cancelled_id, calendar_key, email, subscriber_id, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [shop, prevCancelledId, calendarKey, email, subscriberId, status, error ? String(error).slice(0, 2000) : null]
    );
  } catch (err) {
    console.error(`[removalProcessor] failed to log removal attempt:`, err.message);
  }
};

export const processSingleContractRemoval = async (shop, contractId, customerId, lineVariantId) => {
  const pool = getPool();
  const monthStamp = new Date().toISOString().slice(0, 7);

  // console.log(`[removalProcessor] processSingleContractRemoval shop=${shop} contract=${contractId} customer=${customerId}`);

  const [activeCheck] = await pool.execute(
    `SELECT id FROM active_subs WHERE shop = ? AND customer_id = ? LIMIT 1`,
    [shop, customerId]
  );

  if (activeCheck.length > 0) {
    // console.log(`[removalProcessor] customer ${customerId} is ACTIVE, skipping removal`);
    return { processed: false, reason: "customer_is_active" };
  }

  const [existingCheck] = await pool.execute(
    `SELECT id, removal_status FROM previous_cancelled_subs
     WHERE shop = ? AND contract_id = ? AND month_stamp = ?`,
    [shop, contractId, monthStamp]
  );

  if (existingCheck.length > 0 && existingCheck[0].removal_status !== "pending") {
    // console.log(`[removalProcessor] contract ${contractId} already processed this month with status=${existingCheck[0].removal_status}`);
    return { processed: false, reason: "already_processed", status: existingCheck[0].removal_status };
  }

  let prevId;

  if (existingCheck.length === 0) {
    const [insertResult] = await pool.execute(
      `INSERT INTO previous_cancelled_subs
       (shop, month_stamp, contract_id, customer_id, email, line_variant_id, handle, removal_status)
       VALUES (?, ?, ?, ?, NULL, ?, NULL, 'pending')`,
      [shop, monthStamp, contractId, customerId, lineVariantId]
    );
    prevId = insertResult.insertId;
    // console.log(`[removalProcessor] inserted into previous_cancelled_subs id=${prevId}`);
  } else {
    prevId = existingCheck[0].id;
    // console.log(`[removalProcessor] using existing previous_cancelled_subs id=${prevId}`);
  }

  try {
    // console.log(`[removalProcessor] fetching customer email`);
    const customerData = await getCustomerEmail(shop, customerId);

    if (!customerData?.email) {
      await pool.execute(
        `UPDATE previous_cancelled_subs SET removal_status = 'not_found', removal_error = ? WHERE id = ?`,
        ["Customer email not found", prevId]
      );
      return { processed: true, status: "not_found", reason: "no_email" };
    }

    const email = customerData.email;

    await pool.execute(
      `UPDATE previous_cancelled_subs SET email = ? WHERE id = ?`,
      [email, prevId]
    );

    const calendarKey = getCalendarKeyForVariant(lineVariantId);

    if (!calendarKey) {
      await pool.execute(
        `UPDATE previous_cancelled_subs SET removal_status = 'skipped', removal_error = ? WHERE id = ?`,
        ["No calendar mapping for variant", prevId]
      );
      return { processed: true, status: "skipped", reason: "no_calendar_mapping" };
    }

    const snapshotId = await ensureSnapshot(shop, monthStamp, calendarKey);

    if (!snapshotId) {
      await pool.execute(
        `UPDATE previous_cancelled_subs SET removal_status = 'skipped', removal_error = ? WHERE id = ?`,
        ["Could not create snapshot", prevId]
      );
      return { processed: true, status: "skipped", reason: "no_snapshot" };
    }

    const subscriberId = await lookupSubscriberByEmail(snapshotId, email);

    if (!subscriberId) {
      await pool.execute(
        `UPDATE previous_cancelled_subs SET removal_status = 'not_found', removal_error = ? WHERE id = ?`,
        ["Subscriber not found in AddEvent", prevId]
      );
      return { processed: true, status: "not_found", reason: "not_in_addevent" };
    }

    const calendarId = getCalendarId(calendarKey);
    await deleteSubscriber(calendarId, subscriberId);

    const removedAtSql = new Date().toISOString().slice(0, 19).replace("T", " ");

    await pool.execute(
      `UPDATE previous_cancelled_subs SET removal_status = 'done', removed_at = ?, removal_error = NULL WHERE id = ?`,
      [removedAtSql, prevId]
    );

    await logRemovalAttempt(pool, shop, prevId, calendarKey, email, subscriberId, "done", null);

    // console.log(`[removalProcessor] single contract removal DONE`);
    return { processed: true, status: "done", subscriberId };

  } catch (err) {
    console.error(`[removalProcessor] single contract removal error:`, err.message);

    await pool.execute(
      `UPDATE previous_cancelled_subs SET removal_status = 'failed', removal_error = ? WHERE id = ?`,
      [String(err.message).slice(0, 1000), prevId]
    );

    return { processed: false, status: "failed", error: err.message };
  }
};
