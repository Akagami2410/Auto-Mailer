import crypto from "crypto";

export const verifyShopifyWebhook = (req, res, next) => {
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
  const shopDomain = req.get("X-Shopify-Shop-Domain");
  const webhookId = req.get("X-Shopify-Webhook-Id");
  const topic = req.get("X-Shopify-Topic");

  // console.log(`[verifyWebhook] incoming webhook`);
  // console.log(`[verifyWebhook] shop=${shopDomain} topic=${topic} webhookId=${webhookId}`);
  // console.log(`[verifyWebhook] hmacHeader present=${!!hmacHeader}`);

  if (!hmacHeader) {
    console.error(`[verifyWebhook] REJECT: missing HMAC header`);
    return res.status(401).json({ error: "missing_hmac" });
  }

  if (!req.rawBody || !req.rawBody.length) {
    console.error(`[verifyWebhook] REJECT: missing rawBody`);
    return res.status(400).json({ error: "missing_body" });
  }

  const secret = process.env.SHOPIFY_ADMIN_WEBHOOK_SECRET;
  if (!secret) {
    console.error(`[verifyWebhook] REJECT: SHOPIFY_ADMIN_WEBHOOK_SECRET not configured`);
    return res.status(500).json({ error: "server_config_error" });
  }

  const computedHmac = crypto
    .createHmac("sha256", secret)
    .update(req.rawBody)
    .digest("base64");

  const isValid = crypto.timingSafeEqual(
    Buffer.from(hmacHeader, "utf8"),
    Buffer.from(computedHmac, "utf8")
  );

  // console.log(`[verifyWebhook] computed=${computedHmac.slice(0, 20)}... valid=${isValid}`);

  if (!isValid) {
    console.error(`[verifyWebhook] REJECT: HMAC mismatch`);
    return res.status(401).json({ error: "invalid_hmac" });
  }

  req.shopifyWebhook = {
    shop: shopDomain,
    topic,
    webhookId,
    hmacValid: true,
  };

  // console.log(`[verifyWebhook] ACCEPT: HMAC valid for shop=${shopDomain}`);
  next();
};
