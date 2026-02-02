import jwt from "jsonwebtoken";

const normalizeShopFromDest = (dest) => {
  if (!dest) return "";
  try {
    const u = new URL(dest);
    return String(u.hostname || "").toLowerCase();
  } catch {
    return "";
  }
};

export const verifySessionToken = (req, res, next) => {
  try {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ ok: false, error: "missing_bearer" });

    const payload = jwt.verify(token, process.env.SHOPIFY_API_SECRET);

    const aud = String(payload?.aud || "");
    if (aud !== String(process.env.SHOPIFY_API_KEY || "")) {
      return res.status(401).json({ ok: false, error: "bad_aud" });
    }

    const shop = normalizeShopFromDest(payload?.dest);
    if (!shop) return res.status(401).json({ ok: false, error: "missing_shop" });

    req.shopify = { shop, sessionToken: token, payload };
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "invalid_session_token" });
  }
};
