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
  // console.log(`[customerLookup] fetching access token for shop=${shop}`);

  const [rows] = await pool.execute(
    `SELECT access_token FROM shopify_sessions WHERE shop = ? AND is_uninstalled = 0 LIMIT 1`,
    [shop]
  );

  if (!rows.length || !rows[0].access_token) {
    console.error(`[customerLookup] NO ACCESS TOKEN found for shop=${shop}`);
    throw new Error(`No access token for shop: ${shop}`);
  }

  // console.log(`[customerLookup] access token found for shop=${shop}`);
  return rows[0].access_token;
};

export const getCustomerEmail = async (shop, customerId) => {
  // console.log(`[customerLookup] getCustomerEmail shop=${shop} customerId=${customerId}`);

  const accessToken = await getAccessToken(shop);
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;

  const gid = customerId.startsWith("gid://")
    ? customerId
    : `gid://shopify/Customer/${customerId}`;

  const query = `
    query getCustomer($id: ID!) {
      node(id: $id) {
        ... on Customer {
          id
          email
          firstName
          lastName
        }
      }
    }
  `;

  // console.log(`[customerLookup] GraphQL query for ${gid}`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query,
      variables: { id: gid },
    }),
  });

  // console.log(`[customerLookup] response status=${response.status}`);

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get("Retry-After") || "10", 10);
    console.error(`[customerLookup] 429 RATE LIMITED, Retry-After=${retryAfter}s`);
    throw new ShopifyRateLimitError(`Rate limited by Shopify`, retryAfter);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[customerLookup] API error: ${response.status} ${errorText.slice(0, 500)}`);
    throw new Error(`Shopify API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.errors) {
    console.error(`[customerLookup] GraphQL errors:`, JSON.stringify(data.errors));
    throw new Error(`GraphQL error: ${data.errors[0]?.message || "Unknown"}`);
  }

  const customer = data.data?.node;

  if (!customer) {
    // console.log(`[customerLookup] customer ${customerId} not found`);
    return null;
  }

  // console.log(`[customerLookup] found customer email=${customer.email} name=${customer.firstName} ${customer.lastName}`);

  return {
    email: customer.email || null,
    firstName: customer.firstName || "",
    lastName: customer.lastName || "",
  };
};

export const getCustomerEmailsBatch = async (shop, customerIds) => {
  // console.log(`[customerLookup] getCustomerEmailsBatch shop=${shop} count=${customerIds.length}`);

  if (customerIds.length === 0) {
    return {};
  }

  const accessToken = await getAccessToken(shop);
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;

  const gids = customerIds.map((id) =>
    id.startsWith("gid://") ? id : `gid://shopify/Customer/${id}`
  );

  const query = `
    query getCustomers($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Customer {
          id
          email
          firstName
          lastName
        }
      }
    }
  `;

  // console.log(`[customerLookup] GraphQL batch query for ${gids.length} customers`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query,
      variables: { ids: gids },
    }),
  });

  // console.log(`[customerLookup] batch response status=${response.status}`);

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get("Retry-After") || "10", 10);
    console.error(`[customerLookup] 429 RATE LIMITED, Retry-After=${retryAfter}s`);
    throw new ShopifyRateLimitError(`Rate limited by Shopify`, retryAfter);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[customerLookup] API error: ${response.status} ${errorText.slice(0, 500)}`);
    throw new Error(`Shopify API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.errors) {
    console.error(`[customerLookup] GraphQL errors:`, JSON.stringify(data.errors));
    throw new Error(`GraphQL error: ${data.errors[0]?.message || "Unknown"}`);
  }

  const nodes = data.data?.nodes || [];
  const results = {};

  for (const node of nodes) {
    if (node && node.id) {
      const numericId = node.id.split("/").pop();
      results[numericId] = {
        email: node.email || null,
        firstName: node.firstName || "",
        lastName: node.lastName || "",
      };
    }
  }

  // console.log(`[customerLookup] batch returned ${Object.keys(results).length} customers`);
  return results;
};

export { ShopifyRateLimitError };
