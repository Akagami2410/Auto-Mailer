import { Router } from "express";
import { getPool } from "../utils/db.js";
import { processSingleContractRemoval } from "../services/removalProcessor.js";

const router = Router();

const FLOW_SHARED_SECRET = process.env.FLOW_SHARED_SECRET || "";

const verifyFlowSecret = (req, res, next) => {
  const providedSecret = req.headers["x-flow-secret"] || req.headers["X-Flow-Secret"];

  // console.log(`[subscriptionContract] verifying flow secret`);

  if (!FLOW_SHARED_SECRET) {
    // console.log(`[subscriptionContract] FLOW_SHARED_SECRET not configured, allowing request`);
    return next();
  }

  if (providedSecret !== FLOW_SHARED_SECRET) {
    console.error(`[subscriptionContract] invalid flow secret`);
    return res.status(401).json({ ok: false, error: "invalid_secret" });
  }

  // console.log(`[subscriptionContract] flow secret verified`);
  next();
};

const extractContractId = (handle) => {
  if (!handle) return null;
  const match = String(handle).match(/(\d+)$/);
  return match ? match[1] : null;
};

const normalizeId = (value) => {
  if (!value) return null;
  let str = String(value).trim();
  str = str.replace(/^['"]|['"]$/g, "");
  str = str.replace(/,+$/, "");
  return str.trim() || null;
};

router.post("/updated", verifyFlowSecret, async (req, res) => {
  const startTime = Date.now();

  // console.log(`\n========================================`);
  // console.log(`[subscriptionContract] POST /updated`);
  // console.log(`[subscriptionContract] body:`, JSON.stringify(req.body).slice(0, 1000));
  // console.log(`========================================`);

  try {
    const pool = getPool();

    const shop = normalizeId(req.body?.shop) ||
                 normalizeId(req.headers["x-shopify-shop-domain"]) ||
                 normalizeId(req.body?.shopDomain);

    if (!shop) {
      console.error(`[subscriptionContract] no shop provided`);
      return res.status(400).json({ ok: false, error: "shop_required" });
    }

    const handle = req.body?.handle || req.body?.contract_handle || null;
    const contractId = normalizeId(req.body?.contract_id) || extractContractId(handle);
    const customerId = normalizeId(req.body?.customer_id);
    const lineVariantId = normalizeId(req.body?.line_variant_id);
    const status = String(req.body?.status || "").toUpperCase().trim();

    // console.log(`[subscriptionContract] parsed: shop=${shop} contract=${contractId} customer=${customerId} variant=${lineVariantId} status=${status}`);

    if (!contractId) {
      console.error(`[subscriptionContract] no contract_id`);
      return res.status(400).json({ ok: false, error: "contract_id_required" });
    }

    if (!customerId) {
      console.error(`[subscriptionContract] no customer_id`);
      return res.status(400).json({ ok: false, error: "customer_id_required" });
    }

    if (!status) {
      console.error(`[subscriptionContract] no status`);
      return res.status(400).json({ ok: false, error: "status_required" });
    }

    res.json({ ok: true, received: true });
    // console.log(`[subscriptionContract] ACK sent (200 OK)`);

    if (status === "ACTIVE") {
      // console.log(`[subscriptionContract] status=ACTIVE, upserting into active_subs`);

      await pool.execute(
        `INSERT INTO active_subs (shop, contract_id, customer_id, email, line_variant_id, handle)
         VALUES (?, ?, ?, NULL, ?, ?)
         ON DUPLICATE KEY UPDATE
           customer_id = VALUES(customer_id),
           line_variant_id = VALUES(line_variant_id),
           handle = VALUES(handle)`,
        [shop, contractId, customerId, lineVariantId, handle]
      );

      // console.log(`[subscriptionContract] upserted into active_subs`);

      await pool.execute(
        `DELETE FROM currently_cancelled_subs WHERE shop = ? AND contract_id = ?`,
        [shop, contractId]
      );

      // console.log(`[subscriptionContract] removed from currently_cancelled_subs if existed`);

      const monthStamp = new Date().toISOString().slice(0, 7);

      await pool.execute(
        `UPDATE previous_cancelled_subs
         SET removal_status = 'skipped', removal_error = 'Contract reactivated'
         WHERE shop = ? AND contract_id = ? AND month_stamp = ? AND removal_status = 'pending'`,
        [shop, contractId, monthStamp]
      );

      // console.log(`[subscriptionContract] marked pending previous entries as skipped`);

    } else if (status === "PAUSED" || status === "CANCELLED") {
      // console.log(`[subscriptionContract] status=${status}, upserting into currently_cancelled_subs`);

      await pool.execute(
        `INSERT INTO currently_cancelled_subs (shop, contract_id, customer_id, email, line_variant_id, handle, status)
         VALUES (?, ?, ?, NULL, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           customer_id = VALUES(customer_id),
           line_variant_id = VALUES(line_variant_id),
           handle = VALUES(handle),
           status = VALUES(status)`,
        [shop, contractId, customerId, lineVariantId, handle, status]
      );

      // console.log(`[subscriptionContract] upserted into currently_cancelled_subs`);

      await pool.execute(
        `DELETE FROM active_subs WHERE shop = ? AND contract_id = ?`,
        [shop, contractId]
      );

      // console.log(`[subscriptionContract] removed from active_subs if existed`);

      // console.log(`[subscriptionContract] starting single contract removal`);

      processSingleContractRemoval(shop, contractId, customerId, lineVariantId)
        .then((result) => {
          // console.log(`[subscriptionContract] single removal result:`, result);
        })
        .catch((err) => {
          console.error(`[subscriptionContract] single removal error:`, err.message);
        });

    } else {
      // console.log(`[subscriptionContract] unknown status "${status}", no action taken`);
    }

    // console.log(`[subscriptionContract] done in ${Date.now() - startTime}ms`);

  } catch (err) {
    console.error(`[subscriptionContract] error:`, err.message);
    console.error(err.stack);
  }
});

router.get("/health", (req, res) => {
  // console.log(`[subscriptionContract] health check`);
  res.json({ ok: true, endpoint: "subscription_contract_updated" });
});

export default router;
