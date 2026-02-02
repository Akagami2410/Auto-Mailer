import { useEffect, useRef, useState } from "react";
import makeShopifyFetch from "../lib/apiFetch";
import toast from "react-hot-toast";

const SubsRemover = () => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [importStats, setImportStats] = useState(null);
  const [filterStats, setFilterStats] = useState(null);
  const [removalStatus, setRemovalStatus] = useState(null);
  const [tableStats, setTableStats] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [polling, setPolling] = useState(false);
  const pollInterval = useRef(null);
  const didRun = useRef(false);

  const getCurrentMonth = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  };

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;
    setSelectedMonth(getCurrentMonth());
    fetchTableStats();
  }, []);

  useEffect(() => {
    return () => {
      if (pollInterval.current) {
        clearInterval(pollInterval.current);
      }
    };
  }, []);

  const fetchTableStats = async () => {
    console.log("[subsRemover] fetching table stats");
    try {
      const shopifyFetch = makeShopifyFetch();
      const r = await shopifyFetch("/api/subs/stats", { method: "GET" });
      const json = await r.json().catch(() => null);

      if (r.ok && json?.ok) {
        console.log("[subsRemover] table stats:", json.stats);
        setTableStats(json.stats);
      }
    } catch (e) {
      console.log("[subsRemover] fetch table stats error", e);
    }
  };

  const fetchRemovalStatus = async (month) => {
    console.log("[subsRemover] fetching removal status month=", month);
    try {
      const shopifyFetch = makeShopifyFetch();
      const r = await shopifyFetch(`/api/subs/remove/status?month=${month}`, { method: "GET" });
      const json = await r.json().catch(() => null);

      if (r.ok && json?.ok) {
        console.log("[subsRemover] removal status:", json);
        setRemovalStatus(json);

        if (json.job?.status === "completed" || json.job?.status === "failed") {
          stopPolling();
        }
      }
    } catch (e) {
      console.log("[subsRemover] fetch removal status error", e);
    }
  };

  const startPolling = (month) => {
    console.log("[subsRemover] starting polling for month", month);
    setPolling(true);

    if (pollInterval.current) {
      clearInterval(pollInterval.current);
    }

    pollInterval.current = setInterval(() => {
      fetchRemovalStatus(month);
    }, 3000);
  };

  const stopPolling = () => {
    console.log("[subsRemover] stopping polling");
    setPolling(false);

    if (pollInterval.current) {
      clearInterval(pollInterval.current);
      pollInterval.current = null;
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files?.[0] || null;
    console.log("[subsRemover] file selected:", selectedFile?.name);
    setFile(selectedFile);
    setImportStats(null);
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error("Please select a CSV file");
      return;
    }

    console.log("[subsRemover] uploading file:", file.name);
    setUploading(true);
    const t = toast.loading("Uploading and importing CSV...");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const shopifyFetch = makeShopifyFetch();
      const r = await shopifyFetch("/api/subs/import", {
        method: "POST",
        body: formData,
      });

      const json = await r.json().catch(() => null);
      toast.dismiss(t);

      if (!r.ok || !json?.ok) {
        toast.error(json?.error || "Import failed");
        console.log("[subsRemover] import failed", r.status, json);
        return;
      }

      console.log("[subsRemover] import success:", json.stats);
      setImportStats(json.stats);
      toast.success(`Imported ${json.stats?.validRows || 0} subscriptions`);

      await fetchTableStats();
      setFile(null);

      const fileInput = document.getElementById("csv-file-input");
      if (fileInput) fileInput.value = "";
    } catch (e) {
      toast.dismiss(t);
      toast.error("Upload error");
      console.log("[subsRemover] upload error", e);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (!selectedMonth) {
      toast.error("Please select a month");
      return;
    }

    const confirmed = window.confirm(
      `Start removal process for ${selectedMonth}?\n\nThis will:\n1. Filter cancelled subscriptions (skip if customer still active)\n2. Remove them from AddEvent calendars`
    );

    if (!confirmed) return;

    console.log("[subsRemover] starting removal for month", selectedMonth);
    setRemoving(true);
    setFilterStats(null);
    const t = toast.loading("Starting removal process...");

    try {
      const shopifyFetch = makeShopifyFetch();
      const r = await shopifyFetch("/api/subs/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: selectedMonth }),
      });

      const json = await r.json().catch(() => null);
      toast.dismiss(t);

      if (!r.ok || !json?.ok) {
        toast.error(json?.error || "Remove failed");
        console.log("[subsRemover] remove failed", r.status, json);
        setRemoving(false);
        return;
      }

      console.log("[subsRemover] remove started:", json);
      setFilterStats(json.filterStats);
      toast.success("Removal job started");

      startPolling(selectedMonth);
      await fetchRemovalStatus(selectedMonth);
    } catch (e) {
      toast.dismiss(t);
      toast.error("Remove error");
      console.log("[subsRemover] remove error", e);
      setRemoving(false);
    }
  };

  const handleClearTable = async (table) => {
    const tableName = table === "active_subs" ? "Active Subs" : "Currently Cancelled Subs";

    const confirmed = window.confirm(`Clear all records from ${tableName}?`);
    if (!confirmed) return;

    console.log("[subsRemover] clearing table", table);
    const t = toast.loading(`Clearing ${tableName}...`);

    try {
      const shopifyFetch = makeShopifyFetch();
      const r = await shopifyFetch("/api/subs/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table }),
      });

      const json = await r.json().catch(() => null);
      toast.dismiss(t);

      if (!r.ok || !json?.ok) {
        toast.error(json?.error || "Clear failed");
        return;
      }

      toast.success(`Cleared ${json.deleted} records`);
      await fetchTableStats();
    } catch (e) {
      toast.dismiss(t);
      toast.error("Clear error");
      console.log("[subsRemover] clear error", e);
    }
  };

  const handleRefreshStatus = () => {
    if (selectedMonth) {
      fetchRemovalStatus(selectedMonth);
    }
  };

  const styles = {
    pageTitle: {
      textAlign: "center",
      width: "100%",
    },
    statsContainer: {
      display: "flex",
      flexWrap: "wrap",
      gap: "12px",
    },
    statRow: {
      display: "inline-flex",
      alignItems: "center",
      gap: "12px",
      padding: "10px 16px",
      background: "#f8f9fa",
      borderRadius: "8px",
      fontSize: "14px",
    },
    statLabel: {
      whiteSpace: "nowrap",
    },
    statValue: {
      fontWeight: "600",
      fontSize: "16px",
    },
    clearBtn: {
      flex: "0 0 auto",
      width: "auto",
      padding: "4px 10px",
      fontSize: "12px",
    },
  };

  return (
    <div className="page">
      <div className="page-bar">
        <div className="flex flex-center">
          <h1 className="page-title page-title--bar" style={styles.pageTitle}>
            Subscription Remover
          </h1>
        </div>
      </div>

      <div className="container">
        <div className="panel" style={{ marginBottom: "24px" }}>
          <h2 className="panel-title">Current Stats</h2>
          <div style={styles.statsContainer}>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>Active Subs:</span>
              <span style={styles.statValue}>{tableStats?.activeSubs || 0}</span>
              <button
                className="btn"
                style={styles.clearBtn}
                onClick={() => handleClearTable("active_subs")}
              >
                Clear
              </button>
            </div>

            <div style={styles.statRow}>
              <span style={styles.statLabel}>Currently Cancelled:</span>
              <span style={styles.statValue}>{tableStats?.currentlyCancelled || 0}</span>
              <button
                className="btn"
                style={styles.clearBtn}
                onClick={() => handleClearTable("currently_cancelled_subs")}
              >
                Clear
              </button>
            </div>

            <div style={{ ...styles.statRow, background: "#e9ecef" }}>
              <span style={styles.statLabel}>Previous Cancelled:</span>
              <span style={styles.statValue}>{tableStats?.previousCancelled || 0}</span>
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: "24px" }}>
          <h2 className="panel-title">Step 1: Upload Subscription CSV</h2>
          <p style={{ fontSize: "14px", color: "var(--muted-text)", marginBottom: "16px" }}>
            Upload a CSV with columns: <code>handle</code>, <code>line_variant_id</code>, <code>customer_id</code>, <code>status</code>
          </p>

          <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
            <input
              id="csv-file-input"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              disabled={uploading}
              style={{ fontSize: "14px" }}
            />
            <button
              className="btn-save"
              onClick={handleUpload}
              disabled={uploading || !file}
            >
              {uploading ? "Uploading..." : "Upload CSV"}
            </button>
          </div>

          {importStats && (
            <div style={{ marginTop: "20px", padding: "16px", background: "#f5f5f5", borderRadius: "8px" }}>
              <h3 style={{ fontSize: "14px", marginBottom: "12px" }}>Import Results</h3>
              <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", fontSize: "14px" }}>
                <div><strong>Parsed:</strong> {importStats.totalParsed}</div>
                <div><strong>Valid:</strong> {importStats.validRows}</div>
                <div><strong>Skipped:</strong> {importStats.skippedRows}</div>
                <div><strong>Active Inserted:</strong> {importStats.activeInserted}</div>
                <div><strong>Cancelled Inserted:</strong> {importStats.cancelledInserted}</div>
              </div>
            </div>
          )}
        </div>

        <div className="panel" style={{ marginBottom: "24px" }}>
          <h2 className="panel-title">Step 2: Remove Cancelled Subscriptions</h2>
          <p style={{ fontSize: "14px", color: "var(--muted-text)", marginBottom: "16px" }}>
            Filter cancelled subs (skip if customer is active) and remove from AddEvent calendars.
          </p>

          <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
            <div className="field" style={{ marginBottom: 0, minWidth: "150px" }}>
              <label className="label">Month</label>
              <input
                type="month"
                className="input"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                disabled={removing || polling}
              />
            </div>

            <button
              className="btn-save"
              onClick={handleRemove}
              disabled={removing || polling || !selectedMonth}
              style={{ marginTop: "20px" }}
            >
              {removing || polling ? "Processing..." : "Remove Subs"}
            </button>

            {polling && (
              <button
                className="btn"
                onClick={stopPolling}
                style={{ marginTop: "20px" }}
              >
                Stop Polling
              </button>
            )}

            <button
              className="btn"
              onClick={handleRefreshStatus}
              style={{ marginTop: "20px" }}
            >
              Refresh Status
            </button>
          </div>

          {filterStats && (
            <div style={{ marginTop: "20px", padding: "16px", background: "#f5f5f5", borderRadius: "8px" }}>
              <h3 style={{ fontSize: "14px", marginBottom: "12px" }}>Filter Results</h3>
              <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", fontSize: "14px" }}>
                <div><strong>Total Cancelled:</strong> {filterStats.total}</div>
                <div><strong>Queued for Removal:</strong> {filterStats.inserted}</div>
                <div><strong>Skipped (Active):</strong> {filterStats.skippedActive}</div>
                <div><strong>Skipped (Duplicate):</strong> {filterStats.skippedDuplicate}</div>
              </div>
            </div>
          )}
        </div>

        {removalStatus && (
          <div className="panel">
            <h2 className="panel-title">Removal Progress {polling && <span style={{ fontSize: "12px", color: "var(--muted-text)" }}>(polling...)</span>}</h2>

            {removalStatus.job && (
              <div style={{ marginBottom: "16px", fontSize: "14px" }}>
                <strong>Job Status:</strong>{" "}
                <span style={{
                  padding: "4px 8px",
                  borderRadius: "4px",
                  background: removalStatus.job.status === "completed" ? "#d4edda" :
                             removalStatus.job.status === "failed" ? "#f8d7da" :
                             removalStatus.job.status === "processing" ? "#fff3cd" : "#e2e3e5",
                }}>
                  {removalStatus.job.status}
                </span>
                {removalStatus.job.lastError && (
                  <span style={{ color: "#dc3545", marginLeft: "12px" }}>
                    Error: {removalStatus.job.lastError}
                  </span>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", fontSize: "14px" }}>
              <div style={{ padding: "16px 24px", background: "#f5f5f5", borderRadius: "8px", textAlign: "center", minWidth: "100px" }}>
                <div style={{ fontSize: "28px", fontWeight: "bold" }}>{removalStatus.counts?.pending || 0}</div>
                <div style={{ color: "var(--muted-text)", marginTop: "4px" }}>Pending</div>
              </div>
              <div style={{ padding: "16px 24px", background: "#d4edda", borderRadius: "8px", textAlign: "center", minWidth: "100px" }}>
                <div style={{ fontSize: "28px", fontWeight: "bold", color: "#155724" }}>{removalStatus.counts?.done || 0}</div>
                <div style={{ color: "#155724", marginTop: "4px" }}>Done</div>
              </div>
              <div style={{ padding: "16px 24px", background: "#fff3cd", borderRadius: "8px", textAlign: "center", minWidth: "100px" }}>
                <div style={{ fontSize: "28px", fontWeight: "bold", color: "#856404" }}>{removalStatus.counts?.not_found || 0}</div>
                <div style={{ color: "#856404", marginTop: "4px" }}>Not Found</div>
              </div>
              <div style={{ padding: "16px 24px", background: "#f8d7da", borderRadius: "8px", textAlign: "center", minWidth: "100px" }}>
                <div style={{ fontSize: "28px", fontWeight: "bold", color: "#721c24" }}>{removalStatus.counts?.failed || 0}</div>
                <div style={{ color: "#721c24", marginTop: "4px" }}>Failed</div>
              </div>
              <div style={{ padding: "16px 24px", background: "#e2e3e5", borderRadius: "8px", textAlign: "center", minWidth: "100px" }}>
                <div style={{ fontSize: "28px", fontWeight: "bold", color: "#383d41" }}>{removalStatus.counts?.skipped || 0}</div>
                <div style={{ color: "#383d41", marginTop: "4px" }}>Skipped</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SubsRemover;
