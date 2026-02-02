import { Router } from "express";
import { processWorkshopNotifications } from "../services/workshopNotifications.js";

const router = Router();

const verifyCronToken = (req, res, next) => {
  const token = req.get("X-Cron-Token");
  const expectedToken = process.env.CRON_TOKEN;

  // console.log(`[cron] verifying cron token, header present=${!!token}`);

  if (!expectedToken) {
    console.error(`[cron] CRON_TOKEN env not configured`);
    return res.status(500).json({ ok: false, error: "cron_token_not_configured" });
  }

  if (!token) {
    console.error(`[cron] missing X-Cron-Token header`);
    return res.status(401).json({ ok: false, error: "missing_cron_token" });
  }

  if (token !== expectedToken) {
    console.error(`[cron] invalid cron token`);
    return res.status(401).json({ ok: false, error: "invalid_cron_token" });
  }

  // console.log(`[cron] cron token verified`);
  next();
};

router.post("/workshop-notifications", verifyCronToken, async (req, res) => {
  const startTime = Date.now();

  // console.log(`\n========================================`);
  // console.log(`[cron] POST /workshop-notifications received`);
  // console.log(`========================================`);

  try {
    const stats = await processWorkshopNotifications();

    const duration = Date.now() - startTime;
    // console.log(`[cron] workshop-notifications complete in ${duration}ms`);

    res.json({
      ok: true,
      sent: stats.sent,
      skipped: stats.skipped,
      failed: stats.failed,
      shops: stats.shops,
      durationMs: duration,
    });

  } catch (err) {
    console.error(`[cron] workshop-notifications FAILED:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/health", (req, res) => {
  // console.log(`[cron] health check`);
  res.json({ ok: true, cron: "ready" });
});

export default router;
