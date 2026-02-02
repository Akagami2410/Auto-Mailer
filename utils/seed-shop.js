import { getPool } from "./db.js";

export const seedShop = async (shop) => {
  // console.log(`[seed] start shop=${shop}`);

  const pool = getPool();

  const defaults = [
    {
      template_key: "northern_subscription",
      title: "Northern Hemisphere",
      subject: "Welcome to The Witch’s Wheel (Northern Hemisphere)",
      html: "<p>Hi {{first_name}},</p><p>Welcome...</p>",
      calendar_id: "",
    },
    {
      template_key: "southern_subscription",
      title: "Southern Hemisphere",
      subject: "Welcome to The Witch’s Wheel (Southern Hemisphere)",
      html: "<p>Hi {{first_name}},</p><p>Welcome...</p>",
      calendar_id: "",
    },
    {
      template_key: "workshop_email",
      title: "Workshop Email Template",
      subject: "Your Workshop Details",
      html: "<p>Hi {{first_name}},</p><p>Workshop details...</p>",
      calendar_id: null,
    },
    {
      template_key: "workshop_notification",
      title: "Workshop Notification Template",
      subject: "Workshop Reminder",
      html: "<p>Reminder: your workshop starts soon.</p>",
      calendar_id: null,
    },
  ];

  for (const t of defaults) {
    // console.log(`[seed] upsert template ${t.template_key}`);

    await pool.execute(
      `INSERT INTO email_templates (shop, template_key, title, subject, html, calendar_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         subject = VALUES(subject),
         html = VALUES(html),
         calendar_id = VALUES(calendar_id)`,
      [shop, t.template_key, t.title, t.subject, t.html, t.calendar_id]
    );
  }

  // console.log("[seed] ensure workshop_settings");

  await pool.execute(
    `INSERT INTO workshop_settings (shop, workshop_at, notify_offsets_json)
     VALUES (?, NULL, JSON_ARRAY(1440, 60))
     ON DUPLICATE KEY UPDATE
       shop = VALUES(shop)`,
    [shop]
  );

  // console.log(`[seed] done shop=${shop}`);
};
