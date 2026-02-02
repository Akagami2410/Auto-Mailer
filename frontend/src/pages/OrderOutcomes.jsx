import { useEffect, useRef, useState } from "react";
import makeShopifyFetch from "../lib/apiFetch";
import toast from "react-hot-toast";

const OrderOutcomes = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 0 });
  const [summary, setSummary] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const didRun = useRef(false);

  const getDefaultDates = () => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    };
  };

  const fetchData = async (page = 1, searchQuery = search, from = fromDate, to = toDate) => {
    console.log("[orderOutcomes] fetching page=", page, "q=", searchQuery, "from=", from, "to=", to);
    setLoading(true);

    try {
      const shopifyFetch = makeShopifyFetch();
      let url = `/api/orders/outcomes?page=${page}&pageSize=50`;
      if (from) url += `&from=${from}`;
      if (to) url += `&to=${to}`;
      if (searchQuery) url += `&q=${encodeURIComponent(searchQuery)}`;

      const r = await shopifyFetch(url, { method: "GET" });
      const json = await r.json().catch(() => null);

      if (!r.ok || !json?.ok) {
        toast.error("Failed to load order outcomes");
        console.log("[orderOutcomes] load failed", r.status, json);
        return;
      }

      console.log("[orderOutcomes] loaded", json.rows?.length, "rows");
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
      console.log("[orderOutcomes] load error", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    const defaults = getDefaultDates();
    setFromDate(defaults.from);
    setToDate(defaults.to);
    fetchData(1, "", defaults.from, defaults.to);
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    setExpandedId(null);
    fetchData(1, search, fromDate, toDate);
  };

  const handlePageChange = (newPage) => {
    setExpandedId(null);
    fetchData(newPage, search, fromDate, toDate);
  };

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
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

  const getStatusColor = (status) => {
    if (status === "completed") return "#28a745";
    if (status === "failed") return "#dc3545";
    if (status === "skipped") return "#6c757d";
    return "#17a2b8";
  };

  const getActionChipStyle = (action) => {
    const base = {
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: "12px",
      fontSize: "11px",
      fontWeight: "500",
      marginRight: "4px",
      marginBottom: "2px",
    };

    if (action.includes("email:")) {
      return { ...base, background: "#e3f2fd", color: "#1565c0" };
    }
    if (action.includes("fulfill:")) {
      return { ...base, background: "#fff3e0", color: "#ef6c00" };
    }
    if (action.includes("addevent:")) {
      return { ...base, background: "#e8f5e9", color: "#2e7d32" };
    }
    return { ...base, background: "#f5f5f5", color: "#616161" };
  };

  const styles = {
    pageTitle: { textAlign: "center", width: "100%" },
    filterRow: { display: "flex", gap: "16px", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "16px" },
    field: { marginBottom: 0 },
    summaryContainer: { display: "flex", flexWrap: "wrap", gap: "12px", marginTop: "16px" },
    summaryItem: {
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      padding: "8px 14px",
      background: "#f8f9fa",
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
      gap: "16px",
      padding: "8px 12px",
      background: "#fff",
      borderRadius: "4px",
      marginBottom: "8px",
      fontSize: "13px",
      border: "1px solid #eee",
    },
  };

  return (
    <div className="page">
      <div className="page-bar">
        <div className="flex flex-center">
          <h1 className="page-title page-title--bar" style={styles.pageTitle}>
            Order Outcomes
          </h1>
        </div>
      </div>

      <div className="container">
        <div className="panel" style={{ marginBottom: "24px" }}>
          <h2 className="panel-title">Filters</h2>
          <form onSubmit={handleSearch}>
            <div style={styles.filterRow}>
              <div className="field" style={styles.field}>
                <label className="label">From Date</label>
                <input
                  type="date"
                  className="input"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  style={{ width: "150px" }}
                />
              </div>
              <div className="field" style={styles.field}>
                <label className="label">To Date</label>
                <input
                  type="date"
                  className="input"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  style={{ width: "150px" }}
                />
              </div>
              <div className="field" style={{ ...styles.field, flex: 1, minWidth: "200px" }}>
                <label className="label">Search (email, order ID, order name)</label>
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
              <div style={styles.summaryItem}>
                <strong>Total Orders:</strong> {summary.total}
              </div>
              <div style={{ ...styles.summaryItem, background: "#e8f5e9" }}>
                <strong>Completed:</strong> {summary.completed || 0}
              </div>
              <div style={{ ...styles.summaryItem, background: "#ffebee" }}>
                <strong>Failed:</strong> {summary.failed || 0}
              </div>
              <div style={{ ...styles.summaryItem, background: "#eceff1" }}>
                <strong>Skipped:</strong> {summary.skipped || 0}
              </div>
            </div>
          )}
        </div>

        <div className="panel">
          <h2 className="panel-title">Orders</h2>

          {loading ? (
            <p style={{ textAlign: "center", padding: "40px 0", color: "var(--muted-text)" }}>
              Loading...
            </p>
          ) : rows.length === 0 ? (
            <p style={{ textAlign: "center", padding: "40px 0", color: "var(--muted-text)" }}>
              No orders found for this date range.
            </p>
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}></th>
                      <th style={styles.th}>Order</th>
                      <th style={styles.th}>Email</th>
                      <th style={styles.th}>Created At</th>
                      <th style={styles.th}>Actions</th>
                      <th style={styles.th}>Last Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <>
                        <tr key={row.id}>
                          <td style={styles.td}>
                            <button
                              style={styles.expandBtn}
                              onClick={() => toggleExpand(row.id)}
                            >
                              {expandedId === row.id ? "[-]" : "[+]"}
                            </button>
                          </td>
                          <td style={styles.td}>
                            <div style={{ fontWeight: 500 }}>{row.orderName || row.orderId}</div>
                            {row.orderName && (
                              <div style={{ fontSize: "11px", color: "#888" }}>{row.orderId}</div>
                            )}
                          </td>
                          <td style={styles.td}>{row.email || "-"}</td>
                          <td style={styles.td}>{formatDate(row.createdAt)}</td>
                          <td style={styles.td}>
                            {row.actions.length === 0 ? (
                              <span style={{ color: "#888" }}>-</span>
                            ) : (
                              row.actions.map((a, i) => (
                                <span key={i} style={getActionChipStyle(a)}>
                                  {a}
                                </span>
                              ))
                            )}
                          </td>
                          <td style={styles.td}>
                            {row.lastStatus ? (
                              <span
                                style={{
                                  color: getStatusColor(row.lastStatus),
                                  fontWeight: 500,
                                }}
                              >
                                {row.lastStatus}
                              </span>
                            ) : (
                              <span style={{ color: "#888" }}>-</span>
                            )}
                          </td>
                        </tr>
                        {expandedId === row.id && (
                          <tr key={`${row.id}-expanded`}>
                            <td colSpan={6} style={styles.expandedRow}>
                              <div style={{ fontWeight: 500, marginBottom: "12px" }}>
                                Action Log for {row.orderName || row.orderId}
                              </div>
                              {row.actionDetails.length === 0 ? (
                                <p style={{ color: "#888" }}>No actions recorded.</p>
                              ) : (
                                row.actionDetails.map((a, i) => (
                                  <div key={i} style={styles.logEntry}>
                                    <div style={{ minWidth: "180px" }}>
                                      <span style={getActionChipStyle(a.action)}>{a.action}</span>
                                    </div>
                                    <div style={{ minWidth: "80px", color: getStatusColor(a.status) }}>
                                      {a.status}
                                    </div>
                                    <div style={{ minWidth: "140px", color: "#666" }}>
                                      {formatDate(a.updatedAt || a.createdAt)}
                                    </div>
                                    <div style={{ flex: 1, color: "#666", fontSize: "12px" }}>
                                      {a.details ? JSON.stringify(a.details) : "-"}
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

export default OrderOutcomes;
