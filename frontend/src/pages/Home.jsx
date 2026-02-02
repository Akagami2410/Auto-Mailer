// src/pages/Home.jsx
import { useEffect, useRef, useState } from "react";
import EmailComponent from "../components/Email";
import makeShopifyFetch from "../lib/apiFetch";
import toast from "react-hot-toast";
import { cacheGet, cacheSet, cacheDel } from "../lib/cache";

const empty = { calendarId: "", subject: "", html: "" };
const CACHE_KEY = "templates:northern_southern";

const Home = () => {
  const [north, setNorth] = useState(empty);
  const [south, setSouth] = useState(empty);
  const [loading, setLoading] = useState(true);
  const didRun = useRef(false);

  const fetchLatest = async ({ force = false, silent = false } = {}) => {
    if (!force) {
      const cached = cacheGet(CACHE_KEY);
      if (cached) {
        setNorth(cached.north || empty);
        setSouth(cached.south || empty);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    try {
      const shopifyFetch = makeShopifyFetch();

      const r = await shopifyFetch(
        "/api/email-templates?keys=northern_subscription,southern_subscription",
        { method: "GET" }
      );

      const json = await r.json().catch(() => null);

      if (!r.ok || !json?.ok) {
        if (!silent) toast.error("Failed to load templates");
        console.log("[templates] load failed", r.status, json);
        return;
      }

      const map = json?.templates || {};

      const nextNorth = {
        calendarId: map?.northern_subscription?.calendarId || "",
        subject: map?.northern_subscription?.subject || "",
        html: map?.northern_subscription?.html || "",
      };

      const nextSouth = {
        calendarId: map?.southern_subscription?.calendarId || "",
        subject: map?.southern_subscription?.subject || "",
        html: map?.southern_subscription?.html || "",
      };

      setNorth(nextNorth);
      setSouth(nextSouth);

      cacheSet(CACHE_KEY, { north: nextNorth, south: nextSouth });
    } catch (e) {
      if (!silent) toast.error("Load error");
      console.log("[templates] load error", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;
    fetchLatest({ force: false, silent: true });
  }, []);

  const onSave = async () => {
    const t = toast.loading("Saving templates...");
    try {
      const shopifyFetch = makeShopifyFetch();

      const payload = {
        templates: [
          {
            templateKey: "northern_subscription",
            title: "Northern Hemisphere",
            calendarId: north.calendarId,
            subject: north.subject,
            html: north.html,
          },
          {
            templateKey: "southern_subscription",
            title: "Southern Hemisphere",
            calendarId: south.calendarId,
            subject: south.subject,
            html: south.html,
          },
        ],
      };

      const r = await shopifyFetch("/api/email-templates/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await r.json().catch(() => null);
      toast.dismiss(t);

      if (!r.ok || !json?.ok) {
        toast.error("Save failed");
        console.log("[templates] save failed", r.status, json);
        return;
      }

      toast.success("Saved");

      cacheDel(CACHE_KEY);
      await fetchLatest({ force: true, silent: true });
    } catch (e) {
      toast.dismiss(t);
      toast.error("Save error");
      console.log("[templates] save error", e);
    }
  };

  return (
    <div className="page">
      <div className="page-bar">
        <div className="flex flex-center">
          <h1 className="page-title page-title--bar ml-auto">Email Templates</h1>
          <button
            className="btn-save ml-auto"
            type="button"
            onClick={onSave}
            disabled={loading}
          >
            Save
          </button>
        </div>
      </div>

      <div className="container">
        <EmailComponent title="Northern Hemisphere" value={north} onChange={setNorth} />
        <div className="my-80"></div>
        <EmailComponent title="Southern Hemisphere" value={south} onChange={setSouth} />
      </div>
    </div>
  );
};

export default Home;
