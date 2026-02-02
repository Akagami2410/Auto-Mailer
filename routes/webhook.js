import { Router } from "express";
import { verifyShopifyWebhook } from "../middleware/verifyWebhook.js";
import { enqueueJob } from "../services/queue.js";

const router = Router();

router.post("/order_payment", verifyShopifyWebhook, async (req, res) => {
  const startTime = Date.now();
  const { shop, topic, webhookId } = req.shopifyWebhook;

  // console.log(`\n========================================`);
  // console.log(`[webhook] RECEIVED order_payment webhook`);
  // console.log(`[webhook] shop=${shop} topic=${topic} webhookId=${webhookId}`);
  // console.log(`========================================`);

  res.status(200).json({ received: true });
  // console.log(`[webhook] ACK sent (200 OK) in ${Date.now() - startTime}ms`);

  try {
    let order;
    if (req.rawBody && req.rawBody.length) {
      order = JSON.parse(req.rawBody.toString("utf8"));
      // console.log(`[webhook] parsed order from rawBody`);
    } else {
      order = req.body;
      // console.log(`[webhook] using req.body`);
    }

    const orderId = String(order.id);
    const orderName = order.name || `#${order.order_number}`;
    const customerEmail = order.contact_email || order.email || order.customer?.email || "unknown";

    // console.log(`[webhook] order details: id=${orderId} name=${orderName} email=${customerEmail}`);
    // console.log(`[webhook] line_items count: ${order.line_items?.length || 0}`);

    // for (const item of order.line_items || []) {
    //   console.log(`[webhook] line_item: "${item.title}" qty=${item.quantity} sku=${item.sku}`);
    // }

    const result = await enqueueJob({
      shop,
      jobType: "order_paid",
      orderId,
      webhookId,
      payload: order,
      delaySeconds: 3, // Wait for Shopify subscription app to add tags
    });

    // console.log(`[webhook] job enqueue result: inserted=${result.inserted} updated=${result.updated} duplicate=${result.duplicate || false}`);
    // console.log(`[webhook] webhook processing complete in ${Date.now() - startTime}ms\n`);

  } catch (err) {
    console.error(`[webhook] ERROR processing webhook:`, err.message);
    console.error(err.stack);
  }
});

router.post("/orders/paid", verifyShopifyWebhook, async (req, res) => {
  const startTime = Date.now();
  const { shop, topic, webhookId } = req.shopifyWebhook;

  // console.log(`\n========================================`);
  // console.log(`[webhook] RECEIVED orders/paid webhook`);
  // console.log(`[webhook] shop=${shop} topic=${topic} webhookId=${webhookId}`);
  // console.log(`========================================`);

  res.status(200).json({ received: true });
  // console.log(`[webhook] ACK sent (200 OK) in ${Date.now() - startTime}ms`);

  try {
    let order;
    if (req.rawBody && req.rawBody.length) {
      order = JSON.parse(req.rawBody.toString("utf8"));
    } else {
      order = req.body;
    }

    const orderId = String(order.id);

    // console.log(`[webhook] order id=${orderId} name=${order.name}`);

    const result = await enqueueJob({
      shop,
      jobType: "order_paid",
      orderId,
      webhookId,
      payload: order,
      delaySeconds: 3, // Wait for Shopify subscription app to add tags
    });

    // console.log(`[webhook] job enqueue result: ${JSON.stringify(result)}`);
    // console.log(`[webhook] done in ${Date.now() - startTime}ms\n`);

  } catch (err) {
    console.error(`[webhook] ERROR:`, err.message);
  }
});

router.get("/health", (req, res) => {
  // console.log(`[webhook] health check`);
  res.json({ ok: true, webhook: "ready" });
});

export default router;
