import { useEffect, useRef, useState } from "react";
import makeShopifyFetch from "../lib/apiFetch";
import toast from "react-hot-toast";

const RemovalResults = () => {
  const [results, setResults] = useState([]);
  const [months, setMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 0 });
  const [summary, setSummary] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const didRun = useRef(false);

  const getCurrentMonth = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  };

  const fetchMonths = async () => {
    console.log("[removalResults] fetching months");
    try {
      const shopifyFetch = makeShopifyFetch();
      const r = await shopifyFetch("/api/removal-results/months", { method: "GET" });
      const json = await r.json().catch(() => null);

      if (r.ok && json?.ok) {
        const monthList = json.months || [];
        console.log("[removalResults] months:", monthList);
        setMonths(monthList);

        if (monthList.length > 0 && !selectedMonth) {
          const current = getCurrentMonth();
          const hasCurrentMonth = monthList.includes(current);
          setSelectedMonth(hasCurrentMonth ? current : monthList[0]);
        } else if (monthList.length === 0) {
          setSelectedMonth(getCurrentMonth());
        }
      }
    } catch (e) {
      console.log("[removalResults] fetch months error", e);
    }
  };

  const fetchResults = async (month, page = 1) => {
    console.log("[removalResults] fetching results month=", month, "page=", page);
    setLoading(true);

    try {
      const shopifyFetch = makeShopifyFetch();
      const url = `/api/removal-results?month=${month}&page=${page}&pageSize=50`;
      const r = await shopifyFetch(url, { method: "GET" });
      const json = await r.json().catch(() => null);

      if (!r.ok || !json?.ok) {
        toast.error("Failed to load results");
        console.log("[removalResults] load failed", r.status, json);
        return;
      }

      console.log("[removalResults] loaded", json.rows?.length, "results");
      setResults(json.rows || []);
      setPagination({
        page: json.page,
        pageSize: json.pageSize,
        total: json.total,
        totalPages: json.totalPages,
      });
      setSummary(json.summary);
    } catch (e) {
      toast.error("Load error");
      console.log("[removalResults] load error", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async (prevCancelledId) => {
    console.log("[removalResults] fetching logs for id=", prevCancelledId);
    setLogsLoading(true);

    try {
      const shopifyFetch = makeShopifyFetch();
      const r = await shopifyFetch(`/api/removal-results/logs?prev_cancelled_id=${prevCancelledId}`, { method: "GET" });
      const json = await r.json().catch(() => null);

      if (!r.ok || !json?.ok) {
        toast.error("Failed to load logs");
        console.log("[removalResults] logs load failed", r.status, json);
        return;
      }

      console.log("[removalResults] loaded", json.logs?.length, "logs");
      setLogs(json.logs || []);
    } catch (e) {
      toast.error("Logs load error");
      console.log("[removalResults] logs load error", e);
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;
    fetchMonths();
  }, []);

  useEffect(() => {
    if (selectedMonth) {
      fetchResults(selectedMonth, 1);
      setSelectedRow(null);
      setLogs([]);
    }
  }, [selectedMonth]);

  const handleMonthChange = (e) => {
    const month = e.target.value;
    console.log("[removalResults] month changed to", month);
    setSelectedMonth(month);
  };

  const handlePageChange = (newPage) => {
    fetchResults(selectedMonth, newPage);
  };

  const handleViewLogs = (row) => {
    console.log("[removalResults] viewing logs for row", row.id);
    setSelectedRow(row);
    fetchLogs(row.id);
  };

  const handleCloseLogs = () => {
    setSelectedRow(null);
    setLogs([]);
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

  const getStatusBadge = (status) => {
    const colors = {
      pending: { bg: "#e2e3e5", color: "#383d41" },
      done: { bg: "#d4edda", color: "#155724" },
      not_found: { bg: "#fff3cd", color: "#856404" },
      failed: { bg: "#f8d7da", color: "#721c24" },
      skipped: { bg: "#cce5ff", color: "#004085" },
    };
    const style = colors[status] || colors.pending;

    return (
      <span style={{
        padding: "4px 8px",
        borderRadius: "4px",
        fontSize: "12px",
        background: style.bg,
        color: style.color,
      }}>
        {status}
      </span>
    );
  };

  return (
    <div className="page">
      <div className="page-bar">
        <div className="flex flex-center">
          <h1 className="page-title page-title--bar" style={{ textAlign: "center", width: "100%" }}>
            Removal Results
          </h1>
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
                {months.length === 0 && <option value={getCurrentMonth()}>{getCurrentMonth()}</option>}
                {months.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {summary && (
              <div style={{ display: "flex", gap: "16px", fontSize: "14px", flexWrap: "wrap" }}>
                <div><strong>Total:</strong> {summary.total}</div>
                <div style={{ color: "#383d41" }}><strong>Pending:</strong> {summary.pending}</div>
                <div style={{ color: "#155724" }}><strong>Done:</strong> {summary.done}</div>
                <div style={{ color: "#856404" }}><strong>Not Found:</strong> {summary.not_found}</div>
                <div style={{ color: "#721c24" }}><strong>Failed:</strong> {summary.failed}</div>
                <div style={{ color: "#004085" }}><strong>Skipped:</strong> {summary.skipped}</div>
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <h2 className="panel-title">Results for {selectedMonth || "..."}</h2>

          {loading ? (
            <p style={{ textAlign: "center", padding: "40px 0", color: "var(--muted-text)" }}>
              Loading...
            </p>
          ) : results.length === 0 ? (
            <p style={{ textAlign: "center", padding: "40px 0", color: "var(--muted-text)" }}>
              No removal results found for this month.
            </p>
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid var(--black)" }}>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Contract ID</th>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Customer ID</th>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Email</th>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Variant ID</th>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Status</th>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Error</th>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Removed At</th>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row) => (
                      <tr key={row.id} style={{ borderBottom: "1px solid #ddd" }}>
                        <td style={{ padding: "10px 8px", fontFamily: "monospace", fontSize: "12px" }}>
                          {row.contractId}
                        </td>
                        <td style={{ padding: "10px 8px", fontFamily: "monospace", fontSize: "12px" }}>
                          {row.customerId}
                        </td>
                        <td style={{ padding: "10px 8px" }}>{row.email || "-"}</td>
                        <td style={{ padding: "10px 8px", fontFamily: "monospace", fontSize: "12px" }}>
                          {row.lineVariantId || "-"}
                        </td>
                        <td style={{ padding: "10px 8px" }}>{getStatusBadge(row.removalStatus)}</td>
                        <td style={{ padding: "10px 8px", color: "#721c24", fontSize: "12px", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.removalError || "-"}
                        </td>
                        <td style={{ padding: "10px 8px" }}>{formatDate(row.removedAt)}</td>
                        <td style={{ padding: "10px 8px" }}>
                          <button
                            className="btn"
                            style={{ padding: "4px 8px", fontSize: "12px" }}
                            onClick={() => handleViewLogs(row)}
                          >
                            Logs
                          </button>
                        </td>
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

        {selectedRow && (
          <div className="panel" style={{ marginTop: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2 className="panel-title" style={{ marginBottom: 0 }}>
                Logs for Contract {selectedRow.contractId}
              </h2>
              <button className="btn" onClick={handleCloseLogs} style={{ padding: "4px 12px" }}>
                Close
              </button>
            </div>

            {logsLoading ? (
              <p style={{ textAlign: "center", padding: "20px 0", color: "var(--muted-text)" }}>
                Loading logs...
              </p>
            ) : logs.length === 0 ? (
              <p style={{ textAlign: "center", padding: "20px 0", color: "var(--muted-text)" }}>
                No logs found for this entry.
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid var(--black)" }}>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Calendar</th>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Email</th>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Subscriber ID</th>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Status</th>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Error</th>
                      <th style={{ textAlign: "left", padding: "10px 8px" }}>Created At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} style={{ borderBottom: "1px solid #ddd" }}>
                        <td style={{ padding: "10px 8px" }}>{log.calendarKey || "-"}</td>
                        <td style={{ padding: "10px 8px" }}>{log.email || "-"}</td>
                        <td style={{ padding: "10px 8px", fontFamily: "monospace", fontSize: "12px" }}>
                          {log.subscriberId || "-"}
                        </td>
                        <td style={{ padding: "10px 8px" }}>{getStatusBadge(log.status)}</td>
                        <td style={{ padding: "10px 8px", color: "#721c24", fontSize: "12px" }}>
                          {log.error || "-"}
                        </td>
                        <td style={{ padding: "10px 8px" }}>{formatDate(log.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default RemovalResults;
