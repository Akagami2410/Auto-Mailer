import { useEffect, useRef, useState } from "react";
import makeShopifyFetch from "../lib/apiFetch";
import toast from "react-hot-toast";

const SubsCancellations = () => {
  const [rows, setRows] = useState([]);
  const [months, setMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 0 });
  const [summary, setSummary] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedLogs, setExpandedLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const didRun = useRef(false);

  const getCurrentMonth = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  };

  const fetchMonths = async () => {
    console.log("[subsCancellations] fetching months");
    try {
      const shopifyFetch = makeShopifyFetch();
      const r = await shopifyFetch("/api/subs/cancellations/months", { method: "GET" });
      const json = await r.json().catch(() => null);

      if (r.ok && json?.ok) {
        const monthList = json.months || [];
        console.log("[subsCancellations] months:", monthList);
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
      console.log("[subsCancellations] fetch months error", e);
      setLoading(false);
    }
  };

  const fetchData = async (month, page = 1, searchQuery = search) => {
    console.log("[subsCancellations] fetching month=", month, "page=", page, "q=", searchQuery);
    setLoading(true);

    try {
      const shopifyFetch = makeShopifyFetch();
      let url = `/api/subs/cancellations?month=${month}&page=${page}&pageSize=50`;
      if (searchQuery) url += `&q=${encodeURIComponent(searchQuery)}`;

      const r = await shopifyFetch(url, { method: "GET" });
      const json = await r.json().catch(() => null);

      if (!r.ok || !json?.ok) {
        toast.error("Failed to load cancellations");
        console.log("[subsCancellations] load failed", r.status, json);
        return;
      }

      console.log("[subsCancellations] loaded", json.rows?.length, "rows");
      setRows(json.rows || []);
      setPagination({
        page: json.page,
        pageSize: json.pageSize,
        total: json.total,
        totalPages: json.totalPages,
      });
      setSummary(json.summary || null);
    } catch (e) {
      toast.error("Load error");
      console.log("[subsCancellations] load error", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async (prevCancelledId) => {
    console.log("[subsCancellations] fetching logs for", prevCancelledId);
    setLogsLoading(true);

    try {
      const shopifyFetch = makeShopifyFetch();
      const r = await shopifyFetch(`/api/subs/cancellations/logs/${prevCancelledId}`, { method: "GET" });
      const json = await r.json().catch(() => null);

      if (r.ok && json?.ok) {
        console.log("[subsCancellations] logs loaded", json.logs?.length);
        setExpandedLogs(json.logs || []);
      } else {
        setExpandedLogs([]);
      }
    } catch (e) {
      console.log("[subsCancellations] logs error", e);
      setExpandedLogs([]);
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
      setExpandedId(null);
      setExpandedLogs([]);
      fetchData(selectedMonth, 1, "");
      setSearch("");
    }
  }, [selectedMonth]);

  const handleMonthChange = (e) => {
    const month = e.target.value;
    console.log("[subsCancellations] month changed to", month);
    setSelectedMonth(month);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setExpandedId(null);
    setExpandedLogs([]);
    fetchData(selectedMonth, 1, search);
  };

  const handlePageChange = (newPage) => {
    setExpandedId(null);
    setExpandedLogs([]);
    fetchData(selectedMonth, newPage, search);
  };

  const toggleExpand = async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedLogs([]);
    } else {
      setExpandedId(id);
      await fetchLogs(id);
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

  const getStatusStyle = (status) => {
    const base = {
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: "12px",
      fontSize: "12px",
      fontWeight: "500",
    };

    if (status === "done") return { ...base, background: "#d4edda", color: "#155724" };
    if (status === "pending") return { ...base, background: "#fff3cd", color: "#856404" };
    if (status === "failed") return { ...base, background: "#f8d7da", color: "#721c24" };
    if (status === "not_found") return { ...base, background: "#e2e3e5", color: "#383d41" };
    if (status === "skipped") return { ...base, background: "#cce5ff", color: "#004085" };
    return { ...base, background: "#f5f5f5", color: "#616161" };
  };

  const styles = {
    pageTitle: { textAlign: "center", width: "100%" },
    filterRow: { display: "flex", gap: "16px", alignItems: "flex-end", flexWrap: "wrap" },
    field: { marginBottom: 0 },
    summaryContainer: { display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "16px" },
    summaryItem: {
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      padding: "6px 12px",
      borderRadius: "8px",
      fontSize: "13px",
    },
    table: { width: "100%", borderCollapse: "collapse", fontSize: "14px" },
    th: { textAlign: "left", padding: "10px 8px", borderBottom: "2px solid var(--black)" },
    td: { padding: "10px 8px", borderBottom: "1px solid #ddd", verticalAlign: "top" },
    expandBtn: {
      background: "none",
      border: "none",
      cursor: "pointer",
      padding: "4px 8px",
      fontSize: "12px",
      color: "#1565c0",
    },
    expandedRow: { background: "#f8f9fa", padding: "16px", borderBottom: "1px solid #ddd" },
    logEntry: {
      display: "flex",
      gap: "12px",
      padding: "8px 12px",
      background: "#fff",
      borderRadius: "4px",
      marginBottom: "6px",
      fontSize: "13px",
      border: "1px solid #eee",
      alignItems: "center",
    },
  };

  return (
    <div className="page">
      <div className="page-bar">
        <div className="flex flex-center">
          <h1 className="page-title page-title--bar" style={styles.pageTitle}>
            Cancelled Subscription Outcomes
          </h1>
        </div>
      </div>

      <div className="container">
        <div className="panel" style={{ marginBottom: "24px" }}>
          <h2 className="panel-title">Filters</h2>
          <form onSubmit={handleSearch}>
            <div style={styles.filterRow}>
              <div className="field" style={styles.field}>
                <label className="label">Month</label>
                <select
                  className="input"
                  value={selectedMonth}
                  onChange={handleMonthChange}
                  disabled={loading}
                  style={{ minWidth: "150px" }}
                >
                  {months.length === 0 && <option value="">No data yet</option>}
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ ...styles.field, flex: 1, minWidth: "200px" }}>
                <label className="label">Search (email, customer ID, contract ID, handle)</label>
                <input
                  type="text"
                  className="input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search..."
                />
              </div>
              <button type="submit" className="btn" style={{ width: "auto", padding: "8px 20px" }}>
                Search
              </button>
            </div>
          </form>

          {summary && (
            <div style={styles.summaryContainer}>
              <div style={{ ...styles.summaryItem, background: "#f8f9fa" }}>
                <strong>Total:</strong> {summary.total}
              </div>
              <div style={{ ...styles.summaryItem, background: "#d4edda" }}>
                <strong>Done:</strong> {summary.done || 0}
              </div>
              <div style={{ ...styles.summaryItem, background: "#fff3cd" }}>
                <strong>Pending:</strong> {summary.pending || 0}
              </div>
              <div style={{ ...styles.summaryItem, background: "#f8d7da" }}>
                <strong>Failed:</strong> {summary.failed || 0}
              </div>
              <div style={{ ...styles.summaryItem, background: "#e2e3e5" }}>
                <strong>Not Found:</strong> {summary.not_found || 0}
              </div>
              <div style={{ ...styles.summaryItem, background: "#cce5ff" }}>
                <strong>Skipped:</strong> {summary.skipped || 0}
              </div>
            </div>
          )}
        </div>

        <div className="panel">
          <h2 className="panel-title">Cancellations for {selectedMonth || "..."}</h2>

          {loading ? (
            <p style={{ textAlign: "center", padding: "40px 0", color: "var(--muted-text)" }}>
              Loading...
            </p>
          ) : rows.length === 0 ? (
            <p style={{ textAlign: "center", padding: "40px 0", color: "var(--muted-text)" }}>
              No cancellations found for this month.
            </p>
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}></th>
                      <th style={styles.th}>Contract</th>
                      <th style={styles.th}>Customer</th>
                      <th style={styles.th}>Email</th>
                      <th style={styles.th}>Variant</th>
                      <th style={styles.th}>Status</th>
                      <th style={styles.th}>Removed At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <>
                        <tr key={row.id}>
                          <td style={styles.td}>
                            <button style={styles.expandBtn} onClick={() => toggleExpand(row.id)}>
                              {expandedId === row.id ? "[-]" : "[+]"}
                            </button>
                          </td>
                          <td style={styles.td}>
                            <div style={{ fontWeight: 500 }}>{row.contractId}</div>
                            {row.handle && (
                              <div style={{ fontSize: "11px", color: "#888" }}>{row.handle}</div>
                            )}
                          </td>
                          <td style={styles.td}>{row.customerId || "-"}</td>
                          <td style={styles.td}>{row.email || "-"}</td>
                          <td style={styles.td}>
                            <span style={{ fontSize: "12px", color: "#666" }}>
                              {row.lineVariantId || "-"}
                            </span>
                          </td>
                          <td style={styles.td}>
                            <span style={getStatusStyle(row.removalStatus)}>
                              {row.removalStatus}
                            </span>
                            {row.removalError && (
                              <div
                                style={{ fontSize: "11px", color: "#dc3545", marginTop: "4px" }}
                                title={row.removalError}
                              >
                                {row.removalError.slice(0, 40)}
                                {row.removalError.length > 40 ? "..." : ""}
                              </div>
                            )}
                          </td>
                          <td style={styles.td}>{formatDate(row.removedAt)}</td>
                        </tr>
                        {expandedId === row.id && (
                          <tr key={`${row.id}-expanded`}>
                            <td colSpan={7} style={styles.expandedRow}>
                              <div style={{ fontWeight: 500, marginBottom: "12px" }}>
                                Removal Logs for Contract {row.contractId}
                              </div>
                              {logsLoading ? (
                                <p style={{ color: "#888" }}>Loading logs...</p>
                              ) : expandedLogs.length === 0 ? (
                                <p style={{ color: "#888" }}>No removal logs recorded.</p>
                              ) : (
                                expandedLogs.map((log) => (
                                  <div key={log.id} style={styles.logEntry}>
                                    <div style={{ minWidth: "80px" }}>
                                      <span
                                        style={{
                                          background: "#e8f5e9",
                                          color: "#2e7d32",
                                          padding: "2px 8px",
                                          borderRadius: "8px",
                                          fontSize: "11px",
                                        }}
                                      >
                                        {log.calendarKey || "lookup"}
                                      </span>
                                    </div>
                                    <div style={{ minWidth: "180px", color: "#666" }}>
                                      {log.email || "-"}
                                    </div>
                                    <div style={{ minWidth: "100px" }}>
                                      <span style={getStatusStyle(log.status)}>{log.status}</span>
                                    </div>
                                    <div style={{ minWidth: "140px", color: "#666" }}>
                                      {formatDate(log.createdAt)}
                                    </div>
                                    <div style={{ flex: 1, color: "#888", fontSize: "12px" }}>
                                      {log.subscriberId && (
                                        <span>Sub ID: {log.subscriberId}</span>
                                      )}
                                      {log.error && (
                                        <span style={{ color: "#dc3545" }}> {log.error}</span>
                                      )}
                                    </div>
                                  </div>
                                ))
                              )}
                            </td>
                          </tr>
                        )}
                      </>
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

export default SubsCancellations;
