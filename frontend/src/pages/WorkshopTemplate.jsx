import { useEffect, useRef, useState } from "react";
import EmailComponent from "../components/Email";
import makeShopifyFetch from "../lib/apiFetch";
import toast from "react-hot-toast";
import { cacheGet, cacheSet, cacheDel } from "../lib/cache";

const empty = { calendarId: "", subject: "", html: "" };
const CACHE_KEY = "templates:workshop";

const WorkshopTemplates = () => {
  const [workshopEmail, setWorkshopEmail] = useState(empty);
  const [workshopNotification, setWorkshopNotification] = useState(empty);
  const [workshopRegistrant, setWorkshopRegistrant] = useState(empty);
  const [loading, setLoading] = useState(true);
  const didRun = useRef(false);

  const fetchLatest = async ({ force = false, silent = false } = {}) => {
    if (!force) {
      const cached = cacheGet(CACHE_KEY);
      if (cached) {
        setWorkshopEmail(cached.workshopEmail || empty);
        setWorkshopNotification(cached.workshopNotification || empty);
        setWorkshopRegistrant(cached.workshopRegistrant || empty);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    try {
      const shopifyFetch = makeShopifyFetch();

      const r = await shopifyFetch(
        "/api/email-templates?keys=workshop_email,workshop_notification,workshop_registrant",
        { method: "GET" }
      );

      const json = await r.json().catch(() => null);

      if (!r.ok || !json?.ok) {
        if (!silent) toast.error("Failed to load templates");
        console.log("[workshop-templates] load failed", r.status, json);
        return;
      }

      const map = json?.templates || {};

      const nextWorkshopEmail = {
        calendarId: "",
        subject: map?.workshop_email?.subject || "",
        html: map?.workshop_email?.html || "",
      };

      const nextWorkshopNotification = {
        calendarId: "",
        subject: map?.workshop_notification?.subject || "",
        html: map?.workshop_notification?.html || "",
      };

      const nextWorkshopRegistrant = {
        calendarId: "",
        subject: map?.workshop_registrant?.subject || "",
        html: map?.workshop_registrant?.html || "",
      };

      setWorkshopEmail(nextWorkshopEmail);
      setWorkshopNotification(nextWorkshopNotification);
      setWorkshopRegistrant(nextWorkshopRegistrant);

      cacheSet(CACHE_KEY, {
        workshopEmail: nextWorkshopEmail,
        workshopNotification: nextWorkshopNotification,
        workshopRegistrant: nextWorkshopRegistrant,
      });
    } catch (e) {
      if (!silent) toast.error("Load error");
      console.log("[workshop-templates] load error", e);
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
            templateKey: "workshop_email",
            title: "Workshop Email Template",
            calendarId: null,
            subject: workshopEmail.subject,
            html: workshopEmail.html,
          },
          {
            templateKey: "workshop_notification",
            title: "Workshop Notification Template",
            calendarId: null,
            subject: workshopNotification.subject,
            html: workshopNotification.html,
          },
          {
            templateKey: "workshop_registrant",
            title: "Workshop Registrant Broadcast Template",
            calendarId: null,
            subject: workshopRegistrant.subject,
            html: workshopRegistrant.html,
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
        console.log("[workshop-templates] save failed", r.status, json);
        return;
      }

      toast.success("Saved");

      cacheDel(CACHE_KEY);
      await fetchLatest({ force: true, silent: true });
    } catch (e) {
      toast.dismiss(t);
      toast.error("Save error");
      console.log("[workshop-templates] save error", e);
    }
  };

  return (
    <div className="page">
      <div className="page-bar">
        <div className="flex flex-center">
          <h1 className="page-title page-title--bar ml-auto">Workshop Templates</h1>
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
        <EmailComponent
          title="Workshop Email Template"
          description="Sent to customers when they purchase a workshop product."
          showCalendarId={false}
          value={workshopEmail}
          onChange={setWorkshopEmail}
        />

        <div className="my-80"></div>

        <EmailComponent
          title="Workshop Notification Template"
          description="Sent as reminders before the workshop (e.g., 24h before, 1h before)."
          showCalendarId={false}
          value={workshopNotification}
          onChange={setWorkshopNotification}
        />

        <div className="my-80"></div>

        <EmailComponent
          title="Workshop Registrant Broadcast Template"
          description="Sent when you broadcast to all registrants for a specific month."
          showCalendarId={false}
          value={workshopRegistrant}
          onChange={setWorkshopRegistrant}
        />
      </div>
    </div>
  );
};

export default WorkshopTemplates;
