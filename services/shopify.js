import { getPool } from "../utils/db.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-01";

class ShopifyRateLimitError extends Error {
  constructor(message, retryAfter) {
    super(message);
    this.name = "ShopifyRateLimitError";
    this.status = 429;
    this.statusCode = 429;
    this.retryAfter = retryAfter;
  }
}

const getAccessToken = async (shop) => {
  const pool = getPool();

  // console.log(`[shopify] fetching access token for shop=${shop}`);

  const [rows] = await pool.execute(
    `SELECT access_token FROM shopify_sessions WHERE shop = ? AND is_uninstalled = 0 LIMIT 1`,
    [shop]
  );

  if (!rows.length || !rows[0].access_token) {
    console.error(`[shopify] NO ACCESS TOKEN found for shop=${shop}`);
    throw new Error(`No access token for shop: ${shop}`);
  }

  // console.log(`[shopify] access token found for shop=${shop}`);
  return rows[0].access_token;
};

const shopifyRequest = async (shop, method, endpoint, body = null) => {
  const accessToken = await getAccessToken(shop);
  const url = `https://${shop}/admin/api/${API_VERSION}${endpoint}`;

  // console.log(`[shopify] ${method} ${url}`);

  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
    // console.log(`[shopify] request body: ${JSON.stringify(body).slice(0, 500)}`);
  }

  const response = await fetch(url, options);

  // console.log(`[shopify] response status=${response.status}`);

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get("Retry-After") || "10", 10);
    console.error(`[shopify] 429 RATE LIMITED, Retry-After=${retryAfter}s`);
    throw new ShopifyRateLimitError(`Rate limited by Shopify`, retryAfter);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[shopify] API error: ${response.status} ${errorText.slice(0, 500)}`);
    throw new Error(`Shopify API error: ${response.status} - ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  // console.log(`[shopify] response received, keys: ${Object.keys(data).join(", ")}`);

  return data;
};

export const getOrderTags = async (shop, orderId) => {
  // console.log(`[shopify] getOrderTags shop=${shop} orderId=${orderId}`);

  const data = await shopifyRequest(shop, "GET", `/orders/${orderId}.json?fields=id,tags`);

  const tagsString = data.order?.tags || "";
  const tags = tagsString.split(",").map((t) => t.trim()).filter(Boolean);

  // console.log(`[shopify] order ${orderId} tags: ${JSON.stringify(tags)}`);

  return { tagsString, tags };
};

export const getOrderFulfillments = async (shop, orderId) => {
  // console.log(`[shopify] getOrderFulfillments shop=${shop} orderId=${orderId}`);

  const data = await shopifyRequest(shop, "GET", `/orders/${orderId}/fulfillments.json`);

  const fulfillments = data.fulfillments || [];
  // console.log(`[shopify] order ${orderId} has ${fulfillments.length} fulfillment(s)`);

  return fulfillments;
};

export const getFulfillmentOrders = async (shop, orderId) => {
  // console.log(`[shopify] getFulfillmentOrders shop=${shop} orderId=${orderId}`);

  const data = await shopifyRequest(shop, "GET", `/orders/${orderId}/fulfillment_orders.json`);

  const fulfillmentOrders = data.fulfillment_orders || [];
  // console.log(`[shopify] order ${orderId} has ${fulfillmentOrders.length} fulfillment order(s)`);

  for (const fo of fulfillmentOrders) {
    // console.log(`[shopify] fulfillment_order id=${fo.id} status=${fo.status} assigned_location_id=${fo.assigned_location_id}`);
  }

  return fulfillmentOrders;
};

export const createFulfillment = async (shop, orderId, { notifyCustomer = true, lineItemsByFulfillmentOrder = null } = {}) => {
  // console.log(`[shopify] createFulfillment shop=${shop} orderId=${orderId} notifyCustomer=${notifyCustomer}`);

  const fulfillmentOrders = await getFulfillmentOrders(shop, orderId);

  const openFOs = fulfillmentOrders.filter(
    (fo) => fo.status === "open" || fo.status === "in_progress"
  );

  if (!openFOs.length) {
    // console.log(`[shopify] NO open fulfillment orders for order ${orderId}, may already be fulfilled`);

    const existingFulfillments = await getOrderFulfillments(shop, orderId);
    if (existingFulfillments.length > 0) {
      // console.log(`[shopify] order ${orderId} already has ${existingFulfillments.length} fulfillment(s), skipping`);
      return { alreadyFulfilled: true, fulfillments: existingFulfillments };
    }

    throw new Error(`No open fulfillment orders and no existing fulfillments for order ${orderId}`);
  }

  const lineItemsByFO = lineItemsByFulfillmentOrder || openFOs.map((fo) => ({
    fulfillment_order_id: fo.id,
  }));

  // console.log(`[shopify] fulfilling ${lineItemsByFO.length} fulfillment order(s) for order ${orderId}`);

  const body = {
    fulfillment: {
      notify_customer: notifyCustomer,
      line_items_by_fulfillment_order: lineItemsByFO,
    },
  };

  const data = await shopifyRequest(shop, "POST", `/fulfillments.json`, body);

  // console.log(`[shopify] fulfillment created id=${data.fulfillment?.id} status=${data.fulfillment?.status}`);

  return { created: true, fulfillment: data.fulfillment };
};

export const fulfillOrder = async (shop, orderId, notifyCustomer = true) => {
  // console.log(`[shopify] fulfillOrder shop=${shop} orderId=${orderId} notifyCustomer=${notifyCustomer}`);

  try {
    const result = await createFulfillment(shop, orderId, { notifyCustomer });

    if (result.alreadyFulfilled) {
      // console.log(`[shopify] order ${orderId} was already fulfilled`);
      return { success: true, alreadyFulfilled: true };
    }

    // console.log(`[shopify] order ${orderId} fulfilled successfully`);
    return { success: true, fulfillmentId: result.fulfillment?.id };
  } catch (err) {
    console.error(`[shopify] fulfillOrder failed for order ${orderId}:`, err.message);
    throw err;
  }
};

export { ShopifyRateLimitError };
