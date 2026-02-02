const formBody = (obj) =>
  Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");

export const exchangeOfflineToken = async ({ shop, sessionToken }) => {
  const url = `https://${shop}/admin/oauth/access_token`;

  const body = formBody({
    client_id: process.env.SHOPIFY_API_KEY,
    client_secret: process.env.SHOPIFY_API_SECRET,
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: sessionToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    expiring: 0,
  });

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  const json = await r.json().catch(() => null);

  if (!r.ok) {
    const msg = json?.error_description || json?.error || `HTTP_${r.status}`;
    throw new Error(`token_exchange_failed:${msg}`);
  }

  const accessToken = String(json?.access_token || "");
  const scope = String(json?.scope || "");
  if (!accessToken) throw new Error("token_exchange_failed:missing_access_token");

  return { accessToken, scope };
};
