import { useEffect, useRef, useState } from "react";
import makeShopifyFetch from "../lib/apiFetch";
import toast from "react-hot-toast";

const WorkshopRegistrations = () => {
  const [registrations, setRegistrations] = useState([]);
  const [months, setMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [loading, setLoading] = useState(true);
  const [broadcasting, setBroadcasting] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 0 });
  const [stats, setStats] = useState(null);
  const didRun = useRef(false);

  const getCurrentMonth = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  };

  const fetchMonths = async () => {
    console.log("[registrations] fetching months");
    try {
      const shopifyFetch = makeShopifyFetch();
      const r = await shopifyFetch("/api/workshop-registrations/months", { method: "GET" });
      const json = await r.json().catch(() => null);

      if (r.ok && json?.ok) {
        const monthList = json.months || [];
        console.log("[registrations] months:", monthList);
        setMonths(monthList);

        if (monthList.length > 0 && !selectedMonth) {
          const current = getCurrentMonth();
          const hasCurrentMonth = monthList.includes(current);
          setSelectedMonth(hasCurrentMonth ? current : monthList[0]);
        } else if (monthList.length === 0) {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    } catch (e) {
      console.log("[registrations] fetch months error", e);
      setLoading(false);
    }
  };

  const fetchRegistrations = async (month, page = 1) => {
    console.log("[registrations] fetching registrations month=", month, "page=", page);
    setLoading(true);

    try {
      const shopifyFetch = makeShopifyFetch();
      const url = `/api/workshop-registrations?month=${month}&page=${page}&pageSize=50`;
      const r = await shopifyFetch(url, { method: "GET" });
      const json = await r.json().catch(() => null);

      if (!r.ok || !json?.ok) {
        toast.error("Failed to load registrations");
        console.log("[registrations] load failed", r.status, json);
        return;
      }

      console.log("[registrations] loaded", json.data?.length, "registrations");
      setRegistrations(json.data || []);
      setPagination(json.pagination || { page: 1, pageSize: 50, total: 0, totalPages: 0 });
    } catch (e) {
      toast.error("Load error");
      console.log("[registrations] load error", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async (month) => {
    console.log("[registrations] fetching stats month=", month);
    try {
      const shopifyFetch = makeShopifyFetch();
      const r = await shopifyFetch(`/api/workshop-registrations/stats?month=${month}`, { method: "GET" });
      const json = await r.json().catch(() => null);

      if (r.ok && json?.ok) {
        console.log("[registrations] stats:", json);
        setStats(json);
      }
    } catch (e) {
      console.log("[registrations] fetch stats error", e);
    }
  };

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;
    fetchMonths();
  }, []);

  useEffect(() => {
    if (selectedMonth) {
      fetchRegistrations(selectedMonth, 1);
      fetchStats(selectedMonth);
    }
  }, [selectedMonth]);

  const handleMonthChange = (e) => {
    const month = e.target.value;
    console.log("[registrations] month changed to", month);
    setSelectedMonth(month);
  };

  const handlePageChange = (newPage) => {
    fetchRegistrations(selectedMonth, newPage);
  };

  const handleBroadcast = async () => {
    if (!selectedMonth) {
      toast.error("Please select a month");
      return;
    }

    const confirmed = window.confirm(
      `Send registrant email to all registrations for ${selectedMonth}?\n\nThis will use the "Workshop Registrant Broadcast" template.`
    );

    if (!confirmed) return;

    console.log("[registrations] broadcasting to month", selectedMonth);
    setBroadcasting(true);
    const t = toast.loading("Sending emails...");

    try {
      const shopifyFetch = makeShopifyFetch();
      const r = await shopifyFetch("/api/workshop-registrations/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: selectedMonth }),
      });

      const json = await r.json().catch(() => null);
      toast.dismiss(t);

      if (!r.ok || !json?.ok) {
        toast.error(json?.error || "Broadcast failed");
        console.log("[registrations] broadcast failed", r.status, json);
        return;
      }

      const msg = `Sent: ${json.sent}, Skipped: ${json.skipped}, Failed: ${json.failed}`;
      console.log("[registrations] broadcast result:", msg);

      if (json.sent > 0) {
        toast.success(`Broadcast complete! ${msg}`);
      } else if (json.skipped > 0) {
        toast.success(`All already sent. ${msg}`);
      } else {
        toast.success(`No emails to send. ${msg}`);
      }

      await fetchStats(selectedMonth);
    } catch (e) {
      toast.dismiss(t);
      toast.error("Broadcast error");
      console.log("[registrations] broadcast error", e);
    } finally {
      setBroadcasting(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="page">
      <div className="page-bar">
        <div className="flex flex-center">
          <h1 className="page-title page-title--bar ml-auto">Workshop Registrations</h1>
          <button
            className="btn-save ml-auto"
            type="button"
            onClick={handleBroadcast}
            disabled={loading || broadcasting || !selectedMonth}
          >
            {broadcasting ? "Sending..." : "Send Emails"}
          </button>
        </div>
      </div>

      <div className="container">
        <div className="panel" style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", gap: "24px", alignItems: "center", flexWrap: "wrap" }}>
            <div className="field" style={{ marginBottom: 0, minWidth: "200px" }}>
              <label className="label">Select Month</label>
              <select
                className="input"
                value={selectedMonth}
                onChange={handleMonthChange}
                disabled={loading}
              >
                {months.length === 0 && <option value="">No registrations yet</option>}
                {months.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {stats && (
              <div style={{ display: "flex", gap: "24px", fontSize: "14px" }}>
                <div>
                  <strong>Registrations:</strong> {stats.registrations}
                </div>
                <div>
                  <strong>Emails Sent:</strong> {stats.broadcast?.sent || 0}
                </div>
                <div>
                  <strong>Failed:</strong> {stats.broadcast?.failed || 0}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <h2 className="panel-title">Registrations for {selectedMonth || "..."}</h2>

          {loading ? (
            <p style={{ textAlign: "center", padding: "40px 0", color: "var(--muted-text)" }}>
              Loading...
            </p>
          ) : registrations.length === 0 ? (
            <p style={{ textAlign: "center", padding: "40px 0", color: "var(--muted-text)" }}>
              No registrations found for this month.
            </p>
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid var(--black)" }}>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Order</th>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Customer</th>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Email</th>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Purchased At</th>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Workshop At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {registrations.map((reg) => (
                      <tr key={reg.id} style={{ borderBottom: "1px solid #ddd" }}>
                        <td style={{ padding: "10px 8px" }}>
                          {reg.order_name || reg.order_id}
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          {[reg.first_name, reg.last_name].filter(Boolean).join(" ") || "-"}
                        </td>
                        <td style={{ padding: "10px 8px" }}>{reg.email || "-"}</td>
                        <td style={{ padding: "10px 8px" }}>
                          {formatDate(reg.purchased_at || reg.created_at)}
                        </td>
                        <td style={{ padding: "10px 8px" }}>{formatDate(reg.workshop_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {pagination.totalPages > 1 && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    gap: "8px",
                    marginTop: "20px",
                    paddingTop: "20px",
                    borderTop: "1px solid #ddd",
                  }}
                >
                  <button
                    className="btn"
                    style={{ width: "auto", padding: "8px 16px" }}
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={pagination.page <= 1}
                  >
                    Previous
                  </button>
                  <span style={{ padding: "8px 16px", fontSize: "14px" }}>
                    Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
                  </span>
                  <button
                    className="btn"
                    style={{ width: "auto", padding: "8px 16px" }}
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={pagination.page >= pagination.totalPages}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkshopRegistrations;
