import { useEffect, useMemo, useRef, useState } from "react";
import Flatpickr from "react-flatpickr";
import "flatpickr/dist/flatpickr.min.css";
import toast from "react-hot-toast";
import { DateTime } from "luxon";
import makeShopifyFetch from "../lib/apiFetch";

const UK_ZONE = "Europe/London";

/**
 * Convert UTC ISO -> a JS Date that will DISPLAY the same wall-clock time
 * as UK time in Flatpickr (Flatpickr uses browser local timezone).
 */
const utcIsoToPickerDate = (utcIso) => {
  if (!utcIso) return null;
  const uk = DateTime.fromISO(utcIso, { zone: "utc" }).setZone(UK_ZONE);
  // create local Date with UK wall-clock components
  return new Date(uk.year, uk.month - 1, uk.day, uk.hour, uk.minute, 0, 0);
};

/**
 * Convert a JS Date from Flatpickr -> UTC ISO,
 * interpreting the picked wall-clock as UK time.
 */
const pickerDateToUtcIso = (pickedDate) => {
  if (!pickedDate) return null;
  const dt = DateTime.fromObject(
    {
      year: pickedDate.getFullYear(),
      month: pickedDate.getMonth() + 1,
      day: pickedDate.getDate(),
      hour: pickedDate.getHours(),
      minute: pickedDate.getMinutes(),
    },
    { zone: UK_ZONE }
  );
  return dt.toUTC().toISO({ suppressMilliseconds: true });
};

const formatUtcIsoAsUk = (utcIso) => {
  if (!utcIso) return "";
  return DateTime.fromISO(utcIso, { zone: "utc" })
    .setZone(UK_ZONE)
    .toFormat("dd-LL-yyyy HH:mm");
};

const WorkshopSettings = () => {
  // store canonical value for DB
  const [workshopAtUtcIso, setWorkshopAtUtcIso] = useState(null);

  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [notify, setNotify] = useState({
    h24: true,
    h1: true,
    h6: false,
    h2: false,
  });

  const wrapRef = useRef(null);

  const notifyOptions = useMemo(
    () => [
      { id: "h24", label: "24 hours before", minutes: 24 * 60 },
      { id: "h1", label: "1 hour before", minutes: 60 },
      { id: "h6", label: "6 hours before", minutes: 6 * 60 },
      { id: "h2", label: "2 hours before", minutes: 2 * 60 },
    ],
    []
  );

  const fpOptions = useMemo(
    () => ({
      inline: true,
      enableTime: true,
      time_24hr: true,
      minuteIncrement: 5,
      dateFormat: "d-m-Y H:i",
      disableMobile: true,
    }),
    []
  );

  // Close ONLY when clicking outside both input + popover wrapper
  useEffect(() => {
    if (!isOpen) return;

    const onDocMouseDown = (e) => {
      const wrap = wrapRef.current;
      if (wrap && wrap.contains(e.target)) return; // click inside calendar/input area => keep open
      setIsOpen(false);
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onDocMouseDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  // Load latest settings from DB on mount
  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const shopifyFetch = makeShopifyFetch();
        const r = await shopifyFetch("/api/workshop-settings", { method: "GET" });
        const json = await r.json();

        if (!r.ok || !json?.ok) {
          throw new Error(json?.error || "load_failed");
        }

        // expected json.data = { workshop_at_utc, notify_offsets_minutes: [1440,60,...] }
        const utcIso = json?.data?.workshop_at_utc || null;
        const offsets = Array.isArray(json?.data?.notify_offsets_minutes)
          ? json.data.notify_offsets_minutes
          : [];

        setWorkshopAtUtcIso(utcIso);

        // map offsets -> notify toggles
        const nextNotify = { h24: false, h1: false, h6: false, h2: false };
        notifyOptions.forEach((opt) => {
          nextNotify[opt.id] = offsets.includes(opt.minutes);
        });

        // default if DB empty
        const hasAny = Object.values(nextNotify).some(Boolean);
        setNotify(hasAny ? nextNotify : { h24: true, h1: true, h6: false, h2: false });

        toast.success("Workshop settings loaded");
      } catch (e) {
        console.error("[workshop-settings] load failed", e);
        toast.error("Failed to load workshop settings");
      } finally {
        setIsLoading(false);
      }
    };

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifyOptions]);

  const onSave = async () => {
    setIsSaving(true);
    try {
      const shopifyFetch = makeShopifyFetch();

      const notify_offsets_minutes = notifyOptions
        .filter((opt) => Boolean(notify[opt.id]))
        .map((opt) => opt.minutes);

      const payload = {
        workshop_at_utc: workshopAtUtcIso, // UTC ISO or null
        notify_offsets_minutes,
      };

      const r = await shopifyFetch("/api/workshop-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await r.json();

      if (!r.ok || !json?.ok) {
        throw new Error(json?.error || "save_failed");
      }

      toast.success("Workshop settings saved");
    } catch (e) {
      console.error("[workshop-settings] save failed", e);
      toast.error("Failed to save workshop settings");
    } finally {
      setIsSaving(false);
    }
  };

  const pickerValue = useMemo(
    () => utcIsoToPickerDate(workshopAtUtcIso),
    [workshopAtUtcIso]
  );

  return (
    <div className="page">
      <div className="page-bar">
        <div className="flex flex-center">
          <h1 className="page-title page-title--bar ml-auto">Workshop Settings</h1>

          <button
            className="btn-save ml-auto"
            type="button"
            onClick={onSave}
            disabled={isSaving || isLoading}
            title={isSaving ? "Saving..." : "Save"}
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div className="container">
        <div className="settings-grid">
          <div className="panel">
            <div className="panel-title">Workshop Date &amp; Time</div>

            <div className="field">
              <label className="label">Select date and time (UK time)</label>

              <div className="dt-wrap" ref={wrapRef}>
                <input
                  className="input dt-input"
                  value={formatUtcIsoAsUk(workshopAtUtcIso)}
                  placeholder="Select date & time"
                  readOnly
                  onClick={() => setIsOpen(true)}
                  disabled={isLoading}
                />

                {isOpen ? (
                  <div className="dt-popover">
                    <div className="dt-fp">
                      <Flatpickr
                        value={pickerValue}
                        options={fpOptions}
                        onChange={(dates) => {
                          const d = dates?.[0] || null;
                          const utcIso = pickerDateToUtcIso(d);
                          setWorkshopAtUtcIso(utcIso);
                        }}
                      />
                    </div>

                    <div className="dt-actions">
                      <button
                        type="button"
                        className="btn dt-close"
                        onClick={() => setIsOpen(false)}
                      >
                        Done
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="hint">
              Stored in DB as UTC, displayed/edited as Europe/London.
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">Notification Schedule</div>

            <div className="field">
              <label className="label">Send notifications</label>

              <div className="checklist">
                {notifyOptions.map((opt) => (
                  <label className="check" key={opt.id}>
                    <input
                      type="checkbox"
                      checked={Boolean(notify[opt.id])}
                      disabled={isLoading}
                      onChange={(e) =>
                        setNotify((prev) => ({
                          ...prev,
                          [opt.id]: e.target.checked,
                        }))
                      }
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="hint">
              Default is 24h and 1h. You can enable more if needed.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkshopSettings;
