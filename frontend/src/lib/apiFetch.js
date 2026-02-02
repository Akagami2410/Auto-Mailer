import createApp from "@shopify/app-bridge";
import { authenticatedFetch } from "@shopify/app-bridge/utilities";

const getApiKeyFromMeta = () => {
  const el = document.querySelector('meta[name="shopify-api-key"]');
  return el?.getAttribute("content") || "";
};

const hostFromUrlOrCache = () => {
  const p = new URLSearchParams(window.location.search);
  const host = p.get("host") || "";
  if (host) {
    sessionStorage.setItem("shopify_host", host);
    return host;
  }
  return sessionStorage.getItem("shopify_host") || "";
};

const makeShopifyFetch = () => {
  const apiKey = getApiKeyFromMeta();
  const host = hostFromUrlOrCache();
  const app = createApp({ apiKey, host, forceRedirect: true });
  return authenticatedFetch(app);
};

export default makeShopifyFetch;
