import { getPool } from "../utils/db.js";
import { sendTemplateEmail } from "./email.js";

const TEMPLATE_KEY = "workshop_notification";
const SEND_WINDOW_MINUTES = 2;

export const getShopsWithWorkshopSettings = async () => {
  const pool = getPool();
  // console.log(`[workshopNotify] fetching all shops with workshop_settings`);

  const [rows] = await pool.execute(
    `SELECT shop, workshop_at, notify_offsets_json
     FROM workshop_settings
     WHERE workshop_at IS NOT NULL`
  );

  // console.log(`[workshopNotify] found ${rows.length} shop(s) with workshop settings`);

  return rows.map((r) => {
    let offsets = [];
    try {
      offsets = JSON.parse(r.notify_offsets_json || "[]");
    } catch {
      offsets = [];
    }
    return {
      shop: r.shop,
      workshopAt: r.workshop_at,
      offsets: Array.isArray(offsets) ? offsets : [],
    };
  });
};

export const getRegistrationsDueForNotification = async (shop, workshopAt, offsetMinutes) => {
  const pool = getPool();

  // console.log(`[workshopNotify] checking registrations for shop=${shop} offset=${offsetMinutes}min`);

  const targetTime = new Date(workshopAt);
  targetTime.setMinutes(targetTime.getMinutes() - offsetMinutes);

  const windowStart = new Date(targetTime);
  windowStart.setMinutes(windowStart.getMinutes() - SEND_WINDOW_MINUTES);

  const windowEnd = new Date(targetTime);
  windowEnd.setMinutes(windowEnd.getMinutes() + SEND_WINDOW_MINUTES);

  const now = new Date();

  // console.log(`[workshopNotify] target time: ${targetTime.toISOString()}`);
  // console.log(`[workshopNotify] window: ${windowStart.toISOString()} to ${windowEnd.toISOString()}`);
  // console.log(`[workshopNotify] now: ${now.toISOString()}`);

  if (now < windowStart || now > windowEnd) {
    // console.log(`[workshopNotify] NOT within send window, skipping`);
    return [];
  }

  // console.log(`[workshopNotify] WITHIN send window, fetching eligible registrations`);

  const [rows] = await pool.execute(
    `SELECT wr.id, wr.shop, wr.order_id, wr.email, wr.first_name, wr.last_name, wr.workshop_at
     FROM workshop_registrations wr
     WHERE wr.shop = ?
       AND wr.workshop_at IS NOT NULL
       AND wr.email IS NOT NULL
       AND wr.email != ''
       AND NOT EXISTS (
         SELECT 1 FROM workshop_notification_logs wnl
         WHERE wnl.shop = wr.shop
           AND wnl.registration_id = wr.id
           AND wnl.offset_minutes = ?
       )`,
    [shop, offsetMinutes]
  );

  // console.log(`[workshopNotify] found ${rows.length} registration(s) not yet notified for offset=${offsetMinutes}`);

  return rows;
};

export const sendNotificationEmail = async (shop, registration, offsetMinutes) => {
  const pool = getPool();
  const { id: registrationId, email, first_name, last_name, workshop_at, order_id } = registration;

  // console.log(`[workshopNotify] attempting to send notification to ${email} for registration ${registrationId}`);

  try {
    const [insertResult] = await pool.execute(
      `INSERT INTO workshop_notification_logs (shop, registration_id, offset_minutes, sent_to, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [shop, registrationId, offsetMinutes, email]
    );

    // console.log(`[workshopNotify] lock acquired for registration=${registrationId} offset=${offsetMinutes}`);

    try {
      const workshopDate = new Date(workshop_at);
      const formattedDate = workshopDate.toLocaleDateString("en-GB", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const formattedTime = workshopDate.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });

      const result = await sendTemplateEmail(shop, TEMPLATE_KEY, email, {
        first_name: first_name || "",
        last_name: last_name || "",
        order_id: order_id || "",
        workshop_date: formattedDate,
        workshop_time: formattedTime,
        workshop_at: workshop_at ? new Date(workshop_at).toISOString() : "",
        minutes_before: String(offsetMinutes),
        hours_before: String(Math.round(offsetMinutes / 60)),
      });

      await pool.execute(
        `UPDATE workshop_notification_logs SET status = 'sent' WHERE id = ?`,
        [insertResult.insertId]
      );

      // console.log(`[workshopNotify] notification SENT to ${email} messageId=${result.messageId}`);
      return { sent: true, email, messageId: result.messageId };

    } catch (sendErr) {
      console.error(`[workshopNotify] send FAILED for ${email}:`, sendErr.message);

      await pool.execute(
        `UPDATE workshop_notification_logs SET status = 'failed', error = ? WHERE id = ?`,
        [String(sendErr.message).slice(0, 1000), insertResult.insertId]
      );

      return { sent: false, email, error: sendErr.message };
    }

  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      // console.log(`[workshopNotify] notification already sent/pending for registration=${registrationId} offset=${offsetMinutes}`);
      return { skipped: true, email, reason: "already_logged" };
    }
    throw err;
  }
};

export const processWorkshopNotifications = async () => {
  // console.log(`\n========================================`);
  // console.log(`[workshopNotify] STARTING notification run`);
  // console.log(`========================================`);

  const stats = { sent: 0, skipped: 0, failed: 0, shops: 0 };

  try {
    const shops = await getShopsWithWorkshopSettings();
    stats.shops = shops.length;

    for (const { shop, workshopAt, offsets } of shops) {
      // console.log(`[workshopNotify] processing shop=${shop} workshopAt=${workshopAt} offsets=${JSON.stringify(offsets)}`);

      for (const offsetMinutes of offsets) {
        const registrations = await getRegistrationsDueForNotification(shop, workshopAt, offsetMinutes);

        for (const reg of registrations) {
          const result = await sendNotificationEmail(shop, reg, offsetMinutes);

          if (result.sent) {
            stats.sent++;
          } else if (result.skipped) {
            stats.skipped++;
          } else {
            stats.failed++;
          }
        }
      }
    }

    // console.log(`[workshopNotify] run complete: sent=${stats.sent} skipped=${stats.skipped} failed=${stats.failed}`);
    // console.log(`========================================\n`);

    return stats;

  } catch (err) {
    console.error(`[workshopNotify] run FAILED:`, err.message);
    throw err;
  }
};

export const broadcastToRegistrations = async (shop, monthStamp, templateKey = "workshop_registrant") => {
  const pool = getPool();

  // console.log(`\n========================================`);
  // console.log(`[workshopBroadcast] STARTING broadcast shop=${shop} month=${monthStamp} template=${templateKey}`);
  // console.log(`========================================`);

  const stats = { sent: 0, skipped: 0, failed: 0, total: 0 };

  const [registrations] = await pool.execute(
    `SELECT id, order_id, order_name, email, first_name, last_name, workshop_at, purchased_at, created_at
     FROM workshop_registrations
     WHERE shop = ?
       AND DATE_FORMAT(created_at, '%Y-%m') = ?
       AND email IS NOT NULL
       AND email != ''`,
    [shop, monthStamp]
  );

  stats.total = registrations.length;
  // console.log(`[workshopBroadcast] found ${stats.total} registration(s) for month=${monthStamp}`);

  for (const reg of registrations) {
    // console.log(`[workshopBroadcast] processing registration id=${reg.id} email=${reg.email}`);

    try {
      const [insertResult] = await pool.execute(
        `INSERT INTO workshop_broadcast_logs (shop, registration_id, month_stamp, broadcast_type, sent_to, status)
         VALUES (?, ?, ?, 'registrant', ?, 'pending')`,
        [shop, reg.id, monthStamp, reg.email]
      );

      // console.log(`[workshopBroadcast] lock acquired for registration=${reg.id}`);

      try {
        const workshopDate = reg.workshop_at ? new Date(reg.workshop_at) : null;
        const formattedDate = workshopDate
          ? workshopDate.toLocaleDateString("en-GB", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })
          : "";
        const formattedTime = workshopDate
          ? workshopDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
          : "";

        const result = await sendTemplateEmail(shop, templateKey, reg.email, {
          first_name: reg.first_name || "",
          last_name: reg.last_name || "",
          order_id: reg.order_id || "",
          order_name: reg.order_name || "",
          workshop_date: formattedDate,
          workshop_time: formattedTime,
          workshop_at: workshopDate ? workshopDate.toISOString() : "",
          purchased_at: reg.purchased_at ? new Date(reg.purchased_at).toISOString() : "",
        });

        await pool.execute(
          `UPDATE workshop_broadcast_logs SET status = 'sent' WHERE id = ?`,
          [insertResult.insertId]
        );

        // console.log(`[workshopBroadcast] SENT to ${reg.email} messageId=${result.messageId}`);
        stats.sent++;

      } catch (sendErr) {
        console.error(`[workshopBroadcast] send FAILED for ${reg.email}:`, sendErr.message);

        await pool.execute(
          `UPDATE workshop_broadcast_logs SET status = 'failed', error = ? WHERE id = ?`,
          [String(sendErr.message).slice(0, 1000), insertResult.insertId]
        );

        stats.failed++;
      }

    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        // console.log(`[workshopBroadcast] already sent to registration=${reg.id} for month=${monthStamp}`);
        stats.skipped++;
      } else {
        console.error(`[workshopBroadcast] unexpected error for registration=${reg.id}:`, err.message);
        stats.failed++;
      }
    }
  }

  // console.log(`[workshopBroadcast] complete: sent=${stats.sent} skipped=${stats.skipped} failed=${stats.failed} total=${stats.total}`);
  // console.log(`========================================\n`);

  return stats;
};
