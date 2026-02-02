import { getPool } from "../utils/db.js";
import { parse } from "csv-parse/sync";

const normalizeId = (value) => {
  if (!value) return null;
  let str = String(value).trim();
  str = str.replace(/^['"]|['"]$/g, "");
  str = str.replace(/,+$/, "");
  str = str.trim();
  return str || null;
};

const extractContractId = (handle) => {
  if (!handle) return null;
  const match = String(handle).match(/(\d+)$/);
  return match ? match[1] : null;
};

export const parseSubscriptionCsv = (csvBuffer) => {
  // console.log(`[subsImporter] parsing CSV buffer length=${csvBuffer.length}`);

  const content = csvBuffer.toString("utf8");
  // console.log(`[subsImporter] CSV content length=${content.length}`);

  let records;
  try {
    records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (err) {
    console.error(`[subsImporter] CSV parse error:`, err.message);
    throw new Error(`CSV parse error: ${err.message}`);
  }

  // console.log(`[subsImporter] parsed ${records.length} records`);

  const rows = [];
  const skipped = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const rowNum = i + 2;

    const handle = normalizeId(record.handle);
    const contractId = extractContractId(handle);
    const customerId = normalizeId(record.customer_id);
    const lineVariantId = normalizeId(record.line_variant_id);
    const status = String(record.status || "").toUpperCase().trim();

    // console.log(`[subsImporter] row ${rowNum}: handle=${handle} contractId=${contractId} customerId=${customerId} status=${status}`);

    if (!contractId) {
      // console.log(`[subsImporter] row ${rowNum}: SKIPPED - no contract_id from handle`);
      skipped.push({ rowNum, reason: "no_contract_id", handle });
      continue;
    }

    if (!customerId) {
      // console.log(`[subsImporter] row ${rowNum}: SKIPPED - no customer_id`);
      skipped.push({ rowNum, reason: "no_customer_id" });
      continue;
    }

    if (!["ACTIVE", "PAUSED", "CANCELLED"].includes(status)) {
      // console.log(`[subsImporter] row ${rowNum}: SKIPPED - unknown status "${status}"`);
      skipped.push({ rowNum, reason: "unknown_status", status });
      continue;
    }

    rows.push({
      handle,
      contractId,
      customerId,
      lineVariantId,
      status,
    });
  }

  // console.log(`[subsImporter] valid rows: ${rows.length}, skipped: ${skipped.length}`);

  return { rows, skipped, totalParsed: records.length };
};

export const importSubscriptions = async (shop, rows) => {
  const pool = getPool();

  // console.log(`[subsImporter] importSubscriptions shop=${shop} rows=${rows.length}`);

  const stats = {
    activeInserted: 0,
    activeUpdated: 0,
    cancelledInserted: 0,
    cancelledUpdated: 0,
  };

  const activeRows = rows.filter((r) => r.status === "ACTIVE");
  const cancelledRows = rows.filter((r) => r.status === "PAUSED" || r.status === "CANCELLED");

  // console.log(`[subsImporter] ACTIVE rows: ${activeRows.length}, PAUSED/CANCELLED rows: ${cancelledRows.length}`);

  if (activeRows.length > 0) {
    // console.log(`[subsImporter] bulk upserting ${activeRows.length} into active_subs`);

    const batchSize = 500;
    for (let i = 0; i < activeRows.length; i += batchSize) {
      const batch = activeRows.slice(i, i + batchSize);
      const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?)").join(",");
      const values = batch.flatMap((r) => [
        shop,
        r.contractId,
        r.customerId,
        null,
        r.lineVariantId,
        r.handle,
      ]);

      const [result] = await pool.execute(
        `INSERT INTO active_subs (shop, contract_id, customer_id, email, line_variant_id, handle)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           customer_id = VALUES(customer_id),
           line_variant_id = VALUES(line_variant_id),
           handle = VALUES(handle)`,
        values
      );

      const inserted = result.affectedRows - (result.affectedRows > batch.length ? batch.length : 0);
      stats.activeInserted += Math.max(0, batch.length * 2 - result.affectedRows);
      stats.activeUpdated += result.affectedRows - stats.activeInserted;

      // console.log(`[subsImporter] active_subs batch ${Math.floor(i / batchSize) + 1}: affectedRows=${result.affectedRows}`);
    }
  }

  if (cancelledRows.length > 0) {
    // console.log(`[subsImporter] bulk upserting ${cancelledRows.length} into currently_cancelled_subs`);

    const batchSize = 500;
    for (let i = 0; i < cancelledRows.length; i += batchSize) {
      const batch = cancelledRows.slice(i, i + batchSize);
      const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(",");
      const values = batch.flatMap((r) => [
        shop,
        r.contractId,
        r.customerId,
        null,
        r.lineVariantId,
        r.handle,
        r.status,
      ]);

      const [result] = await pool.execute(
        `INSERT INTO currently_cancelled_subs (shop, contract_id, customer_id, email, line_variant_id, handle, status)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           customer_id = VALUES(customer_id),
           line_variant_id = VALUES(line_variant_id),
           handle = VALUES(handle),
           status = VALUES(status)`,
        values
      );

      // console.log(`[subsImporter] currently_cancelled_subs batch ${Math.floor(i / batchSize) + 1}: affectedRows=${result.affectedRows}`);
    }

    stats.cancelledInserted = cancelledRows.length;
  }

  // console.log(`[subsImporter] import complete:`, stats);
  return stats;
};

export const filterCancelledToPrevious = async (shop, monthStamp) => {
  const pool = getPool();

  // console.log(`[subsImporter] filterCancelledToPrevious shop=${shop} month=${monthStamp}`);

  const [cancelledRows] = await pool.execute(
    `SELECT id, contract_id, customer_id, email, line_variant_id, handle
     FROM currently_cancelled_subs
     WHERE shop = ?`,
    [shop]
  );

  // console.log(`[subsImporter] found ${cancelledRows.length} rows in currently_cancelled_subs`);

  const stats = {
    total: cancelledRows.length,
    inserted: 0,
    skippedActive: 0,
    skippedDuplicate: 0,
  };

  for (const row of cancelledRows) {
    // console.log(`[subsImporter] processing contract_id=${row.contract_id} customer_id=${row.customer_id}`);

    const [activeCheck] = await pool.execute(
      `SELECT id FROM active_subs WHERE shop = ? AND customer_id = ? LIMIT 1`,
      [shop, row.customer_id]
    );

    if (activeCheck.length > 0) {
      // console.log(`[subsImporter] SKIPPED - customer ${row.customer_id} is ACTIVE`);
      stats.skippedActive++;
      continue;
    }

    const [prevCheck] = await pool.execute(
      `SELECT id FROM previous_cancelled_subs WHERE shop = ? AND contract_id = ? AND month_stamp = ? LIMIT 1`,
      [shop, row.contract_id, monthStamp]
    );

    if (prevCheck.length > 0) {
      // console.log(`[subsImporter] SKIPPED - contract ${row.contract_id} already in previous for month ${monthStamp}`);
      stats.skippedDuplicate++;
      continue;
    }

    try {
      await pool.execute(
        `INSERT INTO previous_cancelled_subs
         (shop, month_stamp, contract_id, customer_id, email, line_variant_id, handle, removal_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [shop, monthStamp, row.contract_id, row.customer_id, row.email, row.line_variant_id, row.handle]
      );

      // console.log(`[subsImporter] INSERTED contract ${row.contract_id} into previous_cancelled_subs`);
      stats.inserted++;
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        // console.log(`[subsImporter] duplicate entry (race condition), skipping`);
        stats.skippedDuplicate++;
      } else {
        throw err;
      }
    }
  }

  // console.log(`[subsImporter] filterCancelledToPrevious complete:`, stats);
  return stats;
};
