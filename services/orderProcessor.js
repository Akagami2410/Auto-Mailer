import { getPool } from "../utils/db.js";
import { getOrderTags, fulfillOrder, ShopifyRateLimitError } from "./shopify.js";
import { sendTemplateEmail } from "./email.js";
import {
  withIdempotentAction,
  ACTION_TYPES,
  isActionDone,
} from "./idempotency.js";

const TEMPLATE_KEYS = {
  NORTHERN: "northern_subscription",
  SOUTHERN: "southern_subscription",
  WORKSHOP: "workshop_email",
};

const detectProductTypes = (lineItems) => {
  // console.log(`[orderProcessor] detecting product types from ${lineItems.length} line item(s)`);

  const result = {
    hasNorthern: false,
    hasSouthern: false,
    hasWorkshop: false,
    northernItems: [],
    southernItems: [],
    workshopItems: [],
  };

  for (const item of lineItems) {
    const title = (item.title || "").toLowerCase();
    const name = (item.name || "").toLowerCase();
    const productTitle = (item.product_title || "").toLowerCase();
    const variantTitle = (item.variant_title || "").toLowerCase();

    const combined = `${title} ${name} ${productTitle} ${variantTitle}`;

    // console.log(`[orderProcessor] checking item: "${item.title}" (sku=${item.sku})`);

    if (combined.includes("northern")) {
      result.hasNorthern = true;
      result.northernItems.push(item);
      // console.log(`[orderProcessor] DETECTED: Northern subscription item`);
    }

    if (combined.includes("southern")) {
      result.hasSouthern = true;
      result.southernItems.push(item);
      // console.log(`[orderProcessor] DETECTED: Southern subscription item`);
    }

    if (combined.includes("workshop")) {
      result.hasWorkshop = true;
      result.workshopItems.push(item);
      // console.log(`[orderProcessor] DETECTED: Workshop item`);
    }
  }

  // console.log(`[orderProcessor] detection result: northern=${result.hasNorthern} southern=${result.hasSouthern} workshop=${result.hasWorkshop}`);

  return result;
};

const extractCustomerInfo = (order) => {
  const customer = order.customer || {};
  const email =
    order.contact_email ||
    order.email ||
    customer.email ||
    "";

  const firstName = customer.first_name || order.billing_address?.first_name || "";
  const lastName = customer.last_name || order.billing_address?.last_name || "";

  // console.log(`[orderProcessor] customer: email=${email} name="${firstName} ${lastName}"`);

  return {
    email,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    customerId: customer.id || null,
  };
};

const parseOrderTags = (tagsArray) => {
  const result = {
    isFirstOrder: false,
    isRecurringOrder: false,
    raw: tagsArray,
  };

  for (const tag of tagsArray) {
    const normalized = tag.toLowerCase().trim();

    if (normalized === "subscription first order") {
      result.isFirstOrder = true;
      // console.log(`[orderProcessor] TAG DETECTED: Subscription First Order`);
    }

    if (normalized === "subscription recurring order") {
      result.isRecurringOrder = true;
      // console.log(`[orderProcessor] TAG DETECTED: Subscription Recurring Order`);
    }
  }

  return result;
};

const saveOrderSeen = async (shop, order) => {
  const pool = getPool();
  const orderId = String(order.id);
  const orderName = order.name || order.order_number || null;
  const customer = extractCustomerInfo(order);

  // console.log(`[orderProcessor] saving order to orders_seen shop=${shop} orderId=${orderId}`);

  try {
    await pool.execute(
      `INSERT INTO orders_seen (shop, order_id, order_name, customer_id, email, raw_payload_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         order_name = VALUES(order_name),
         customer_id = VALUES(customer_id),
         email = VALUES(email)`,
      [shop, orderId, orderName, customer.customerId, customer.email, JSON.stringify(order).slice(0, 60000)]
    );
    // console.log(`[orderProcessor] order saved to orders_seen`);
  } catch (err) {
    console.error(`[orderProcessor] failed to save order_seen:`, err.message);
  }
};

const getWorkshopSettings = async (shop) => {
  const pool = getPool();
  // console.log(`[orderProcessor] fetching workshop_settings for shop=${shop}`);

  const [rows] = await pool.execute(
    `SELECT workshop_at, notify_offsets_json FROM workshop_settings WHERE shop = ? LIMIT 1`,
    [shop]
  );

  if (!rows.length) {
    // console.log(`[orderProcessor] no workshop_settings found for shop=${shop}`);
    return null;
  }

  // console.log(`[orderProcessor] workshop_settings found: workshop_at=${rows[0].workshop_at}`);
  return rows[0];
};

const saveWorkshopRegistration = async (shop, order, workshopItems) => {
  const pool = getPool();
  const customer = extractCustomerInfo(order);
  const orderId = String(order.id);
  const orderName = order.name || `#${order.order_number}` || null;

  const purchasedAtRaw = order.processed_at || order.created_at || null;
  let purchasedAtSql = null;
  if (purchasedAtRaw) {
    const d = new Date(purchasedAtRaw);
    if (!Number.isNaN(d.getTime())) {
      purchasedAtSql = d.toISOString().slice(0, 19).replace("T", " ");
    }
  }

  // console.log(`[orderProcessor] saving workshop registration orderId=${orderId} orderName=${orderName}`);
  // console.log(`[orderProcessor] purchasedAt=${purchasedAtSql}`);

  const settings = await getWorkshopSettings(shop);
  const workshopAt = settings?.workshop_at || null;

  // console.log(`[orderProcessor] workshop_at from settings: ${workshopAt}`);

  try {
    await pool.execute(
      `INSERT INTO workshop_registrations
       (shop, order_id, order_name, customer_id, email, first_name, last_name, purchased_at, workshop_at, notified_offsets_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')
       ON DUPLICATE KEY UPDATE
         order_name = VALUES(order_name),
         email = VALUES(email),
         first_name = VALUES(first_name),
         last_name = VALUES(last_name),
         purchased_at = COALESCE(purchased_at, VALUES(purchased_at)),
         workshop_at = COALESCE(workshop_at, VALUES(workshop_at))`,
      [shop, orderId, orderName, customer.customerId, customer.email, customer.firstName, customer.lastName, purchasedAtSql, workshopAt]
    );
    // console.log(`[orderProcessor] workshop registration saved successfully`);
  } catch (err) {
    console.error(`[orderProcessor] failed to save workshop registration:`, err.message);
    throw err;
  }
};

export const processOrderPaid = async (shop, order) => {
  const orderId = String(order.id);
  const orderName = order.name || `#${order.order_number}`;

  // console.log(`\n========================================`);
  // console.log(`[orderProcessor] PROCESSING ORDER shop=${shop} orderId=${orderId} name=${orderName}`);
  // console.log(`========================================`);

  await saveOrderSeen(shop, order);

  const lineItems = order.line_items || [];
  const products = detectProductTypes(lineItems);
  const customer = extractCustomerInfo(order);

  if (!customer.email) {
    console.error(`[orderProcessor] NO EMAIL for order ${orderId}, cannot send emails`);
  }

  const hasSubscription = products.hasNorthern || products.hasSouthern;
  let orderTags = null;
  let parsedTags = null;

  if (hasSubscription) {
    // console.log(`[orderProcessor] subscription detected, fetching order tags from Shopify`);
    orderTags = await getOrderTags(shop, orderId);
    parsedTags = parseOrderTags(orderTags.tags);
  }

  const results = {
    orderId,
    orderName,
    shop,
    products,
    customer,
    tags: parsedTags,
    actions: [],
    errors: [],
  };

  if (hasSubscription) {
    // console.log(`[orderProcessor] processing subscription order`);

    if (parsedTags.isFirstOrder) {
      // console.log(`[orderProcessor] FIRST ORDER: will send email and fulfill with notify=true`);

      if (products.hasNorthern && customer.email) {
        try {
          const emailResult = await withIdempotentAction(
            shop,
            orderId,
            ACTION_TYPES.EMAIL_NORTHERN,
            { template: TEMPLATE_KEYS.NORTHERN, email: customer.email },
            async () => {
              // console.log(`[orderProcessor] sending northern subscription email`);
              return await sendTemplateEmail(shop, TEMPLATE_KEYS.NORTHERN, customer.email, {
                first_name: customer.firstName,
                last_name: customer.lastName,
                order_name: orderName,
                order_id: orderId,
              });
            }
          );

          if (emailResult.skipped) {
            // console.log(`[orderProcessor] northern email SKIPPED (already sent)`);
            results.actions.push({ action: "email_northern", status: "skipped" });
          } else {
            // console.log(`[orderProcessor] northern email SENT`);
            results.actions.push({ action: "email_northern", status: "sent", messageId: emailResult.result?.messageId });
          }
        } catch (err) {
          console.error(`[orderProcessor] northern email FAILED:`, err.message);
          results.errors.push({ action: "email_northern", error: err.message });
          throw err;
        }
      }

      if (products.hasSouthern && customer.email) {
        try {
          const emailResult = await withIdempotentAction(
            shop,
            orderId,
            ACTION_TYPES.EMAIL_SOUTHERN,
            { template: TEMPLATE_KEYS.SOUTHERN, email: customer.email },
            async () => {
              // console.log(`[orderProcessor] sending southern subscription email`);
              return await sendTemplateEmail(shop, TEMPLATE_KEYS.SOUTHERN, customer.email, {
                first_name: customer.firstName,
                last_name: customer.lastName,
                order_name: orderName,
                order_id: orderId,
              });
            }
          );

          if (emailResult.skipped) {
            // console.log(`[orderProcessor] southern email SKIPPED (already sent)`);
            results.actions.push({ action: "email_southern", status: "skipped" });
          } else {
            // console.log(`[orderProcessor] southern email SENT`);
            results.actions.push({ action: "email_southern", status: "sent", messageId: emailResult.result?.messageId });
          }
        } catch (err) {
          console.error(`[orderProcessor] southern email FAILED:`, err.message);
          results.errors.push({ action: "email_southern", error: err.message });
          throw err;
        }
      }

      try {
        const fulfillResult = await withIdempotentAction(
          shop,
          orderId,
          ACTION_TYPES.FULFILL_SUBSCRIPTION,
          { notifyCustomer: true },
          async () => {
            // console.log(`[orderProcessor] fulfilling subscription order with notify=true`);
            return await fulfillOrder(shop, orderId, true);
          }
        );

        if (fulfillResult.skipped) {
          // console.log(`[orderProcessor] subscription fulfillment SKIPPED (already done)`);
          results.actions.push({ action: "fulfill_subscription", status: "skipped" });
        } else {
          // console.log(`[orderProcessor] subscription fulfillment COMPLETE`);
          results.actions.push({ action: "fulfill_subscription", status: "completed", alreadyFulfilled: fulfillResult.result?.alreadyFulfilled });
        }
      } catch (err) {
        console.error(`[orderProcessor] subscription fulfillment FAILED:`, err.message);
        results.errors.push({ action: "fulfill_subscription", error: err.message });
        throw err;
      }

    } else if (parsedTags.isRecurringOrder) {
      // console.log(`[orderProcessor] RECURRING ORDER: NO email, fulfill with notify=false`);

      try {
        const fulfillResult = await withIdempotentAction(
          shop,
          orderId,
          ACTION_TYPES.FULFILL_SUBSCRIPTION,
          { notifyCustomer: false },
          async () => {
            // console.log(`[orderProcessor] fulfilling recurring subscription with notify=false`);
            return await fulfillOrder(shop, orderId, false);
          }
        );

        if (fulfillResult.skipped) {
          // console.log(`[orderProcessor] recurring fulfillment SKIPPED (already done)`);
          results.actions.push({ action: "fulfill_subscription", status: "skipped" });
        } else {
          // console.log(`[orderProcessor] recurring fulfillment COMPLETE`);
          results.actions.push({ action: "fulfill_subscription", status: "completed" });
        }
      } catch (err) {
        console.error(`[orderProcessor] recurring fulfillment FAILED:`, err.message);
        results.errors.push({ action: "fulfill_subscription", error: err.message });
        throw err;
      }

    } else {
      // console.log(`[orderProcessor] subscription order has neither First nor Recurring tag, skipping subscription actions`);
      results.actions.push({ action: "subscription_skipped", status: "no_matching_tag", tags: parsedTags.raw });
    }
  }

  if (products.hasWorkshop) {
    // console.log(`[orderProcessor] processing workshop order`);

    await saveWorkshopRegistration(shop, order, products.workshopItems);

    if (customer.email) {
      try {
        const emailResult = await withIdempotentAction(
          shop,
          orderId,
          ACTION_TYPES.EMAIL_WORKSHOP,
          { template: TEMPLATE_KEYS.WORKSHOP, email: customer.email },
          async () => {
            // console.log(`[orderProcessor] sending workshop email`);
            return await sendTemplateEmail(shop, TEMPLATE_KEYS.WORKSHOP, customer.email, {
              first_name: customer.firstName,
              last_name: customer.lastName,
              order_name: orderName,
              order_id: orderId,
            });
          }
        );

        if (emailResult.skipped) {
          // console.log(`[orderProcessor] workshop email SKIPPED (already sent)`);
          results.actions.push({ action: "email_workshop", status: "skipped" });
        } else {
          // console.log(`[orderProcessor] workshop email SENT`);
          results.actions.push({ action: "email_workshop", status: "sent", messageId: emailResult.result?.messageId });
        }
      } catch (err) {
        console.error(`[orderProcessor] workshop email FAILED:`, err.message);
        results.errors.push({ action: "email_workshop", error: err.message });
        throw err;
      }
    }

    try {
      const fulfillResult = await withIdempotentAction(
        shop,
        orderId,
        ACTION_TYPES.FULFILL_WORKSHOP,
        { notifyCustomer: true },
        async () => {
          // console.log(`[orderProcessor] fulfilling workshop order with notify=true`);
          return await fulfillOrder(shop, orderId, true);
        }
      );

      if (fulfillResult.skipped) {
        // console.log(`[orderProcessor] workshop fulfillment SKIPPED (already done)`);
        results.actions.push({ action: "fulfill_workshop", status: "skipped" });
      } else {
        // console.log(`[orderProcessor] workshop fulfillment COMPLETE`);
        results.actions.push({ action: "fulfill_workshop", status: "completed" });
      }
    } catch (err) {
      console.error(`[orderProcessor] workshop fulfillment FAILED:`, err.message);
      results.errors.push({ action: "fulfill_workshop", error: err.message });
      throw err;
    }
  }

  if (!hasSubscription && !products.hasWorkshop) {
    // console.log(`[orderProcessor] order ${orderId} has no subscription or workshop items, skipping`);
    results.actions.push({ action: "skipped", reason: "no_matching_products" });
  }

  // console.log(`[orderProcessor] ORDER COMPLETE orderId=${orderId}`);
  // console.log(`[orderProcessor] actions: ${JSON.stringify(results.actions)}`);
  // console.log(`========================================\n`);

  return results;
};

export { detectProductTypes, extractCustomerInfo, parseOrderTags };
