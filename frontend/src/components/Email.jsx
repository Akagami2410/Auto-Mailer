import { useState } from "react";
import RichTextEditor from "./RichTextEditor";
import makeShopifyFetch from "../lib/apiFetch";
import toast from "react-hot-toast";

const EmailComponent = ({ title = "Email Template", showCalendarId = true, value, onChange }) => {
  const [sendToEmail, setSendToEmail] = useState("");

  const v = value || { calendarId: "", subject: "", html: "" };

  const setField = (key, next) => {
    onChange?.({ ...v, [key]: next });
  };

  const onSendTest = async () => {
    const email = String(sendToEmail || "").trim();
    if (!email) return toast.error("Enter receiver email");

    const t = toast.loading("Sending test...");
    try {
      const shopifyFetch = makeShopifyFetch();

      const payload = {
        to: email,
        subject: v.subject || "",
        html: v.html || "",
      };

      const r = await shopifyFetch("/api/email-templates/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await r.json().catch(() => null);
      toast.dismiss(t);

      if (!r.ok || !json?.ok) {
        toast.error("Test failed");
        console.log("[test] failed", r.status, json);
        return;
      }

      toast.success("Test sent");
    } catch (e) {
      toast.dismiss(t);
      toast.error("Test error");
      console.log("[test] error", e);
    }
  };

  return (
    <div className="email-layout">
      <div className="panel">
        <div className="panel-title">{title}</div>

        {showCalendarId ? (
          <div className="field">
            <label className="label">AddEvent Calendar ID</label>
            <input
              value={v.calendarId || ""}
              onChange={(e) => setField("calendarId", e.target.value)}
              className="input"
              placeholder="e.g. cal_xxxxx"
            />
          </div>
        ) : null}

        <div className="field">
          <label className="label">Subject</label>
          <input
            value={v.subject || ""}
            onChange={(e) => setField("subject", e.target.value)}
            className="input"
            placeholder="e.g. Welcome to the Wheel"
          />
        </div>

        <RichTextEditor value={v.html || ""} onChange={(next) => setField("html", next)} />
      </div>

      <div className="panel">
        <div className="panel-title">Test Email</div>

        <div className="field">
          <label className="label">Send to Email</label>
          <input
            value={sendToEmail}
            onChange={(e) => setSendToEmail(e.target.value)}
            className="input"
            placeholder="e.g. yourname@gmail.com"
          />
        </div>

        <button className="btn" type="button" onClick={onSendTest}>
          Send Test
        </button>
      </div>
    </div>
  );
};

export default EmailComponent;
