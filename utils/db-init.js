import { getPool } from "./db.js";

const run = async (name, sql) => {
  // console.log(`[db] ensuring ${name}...`);
  const pool = getPool();
  await pool.execute(sql);
  // console.log(`[db] ok ${name}`);
};

export const ensureTables = async () => {
  // console.log("[db] ensureTables start");

  await run(
    "shopify_sessions",
    `CREATE TABLE IF NOT EXISTS shopify_sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop VARCHAR(255) NOT NULL,
      access_token TEXT NOT NULL,
      scope TEXT NULL,
      is_uninstalled TINYINT(1) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_shopify_sessions_shop (shop)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );

  await run(
    "email_templates",
    `CREATE TABLE IF NOT EXISTS email_templates (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop VARCHAR(255) NOT NULL,
      template_key VARCHAR(64) NOT NULL,
      title VARCHAR(128) NOT NULL,
      subject VARCHAR(255) NOT NULL,
      html MEDIUMTEXT NOT NULL,
      calendar_id VARCHAR(128) NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_templates_shop_key (shop, template_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );

  await run(
    "workshop_settings",
    `CREATE TABLE IF NOT EXISTS workshop_settings (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop VARCHAR(255) NOT NULL,
      workshop_at DATETIME NULL,
      notify_offsets_json TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_workshop_settings_shop (shop)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );

  await run(
    "workshop_registrations",
    `CREATE TABLE IF NOT EXISTS workshop_registrations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop VARCHAR(255) NOT NULL,
      order_id VARCHAR(64) NOT NULL,
      customer_id VARCHAR(64) NULL,
      email VARCHAR(255) NOT NULL,
      first_name VARCHAR(128) NULL,
      last_name VARCHAR(128) NULL,
      workshop_at DATETIME NULL,
      notified_offsets_json TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_workshop_shop_order (shop, order_id),
      KEY idx_workshop_due (shop, workshop_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );

  await run(
    "workshop_notification_logs",
    `CREATE TABLE IF NOT EXISTS workshop_notification_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop VARCHAR(255) NOT NULL,
      registration_id BIGINT UNSIGNED NOT NULL,
      offset_minutes INT NOT NULL,
      sent_to VARCHAR(255) NOT NULL,
      status VARCHAR(16) NOT NULL,
      error TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_workshop_log_dedupe (shop, registration_id, offset_minutes),
      KEY idx_workshop_log_reg (registration_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );

  await run(
    "orders_seen",
    `CREATE TABLE IF NOT EXISTS orders_seen (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop VARCHAR(255) NOT NULL,
      order_id VARCHAR(64) NOT NULL,
      order_name VARCHAR(64) NULL,
      customer_id VARCHAR(64) NULL,
      email VARCHAR(255) NULL,
      raw_payload_json TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_orders_seen_shop_order (shop, order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );

  await run(
    "webhook_jobs",
    `CREATE TABLE IF NOT EXISTS webhook_jobs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop VARCHAR(255) NOT NULL,
      webhook_id VARCHAR(128) NULL,
      job_type VARCHAR(64) NOT NULL,
      order_id VARCHAR(64) NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'queued',
      attempts INT NOT NULL DEFAULT 0,
      run_after DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      locked_at DATETIME NULL,
      locked_by VARCHAR(64) NULL,
      last_error TEXT NULL,
      payload_json TEXT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_jobs_pick (status, run_after),
      KEY idx_jobs_shop_type (shop, job_type),
      UNIQUE KEY uq_jobs_dedupe (shop, job_type, order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );

  await run(
    "order_action_logs",
    `CREATE TABLE IF NOT EXISTS order_action_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop VARCHAR(255) NOT NULL,
      order_id VARCHAR(64) NOT NULL,
      action VARCHAR(64) NOT NULL,
      details_json TEXT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'completed',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_action_dedupe (shop, order_id, action),
      KEY idx_order_logs (shop, order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );

  await run(
    "order_action_logs_add_unique",
    `ALTER TABLE order_action_logs
     ADD UNIQUE KEY uq_action_dedupe (shop, order_id, action)`
  ).catch(() => {});

  await run(
    "order_action_logs_add_status",
    `ALTER TABLE order_action_logs
     ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'completed' AFTER details_json,
     ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at`
  ).catch(() => {});

  await run(
    "active_subs",
    `CREATE TABLE IF NOT EXISTS active_subs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop VARCHAR(255) NOT NULL,
      contract_id VARCHAR(64) NOT NULL,
      customer_id VARCHAR(64) NOT NULL,
      email VARCHAR(255) NULL,
      line_variant_id VARCHAR(64) NULL,
      handle VARCHAR(255) NULL,
      imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_active_shop_contract (shop, contract_id),
      KEY idx_active_shop_customer (shop, customer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );

  await run(
    "currently_cancelled_subs",
    `CREATE TABLE IF NOT EXISTS currently_cancelled_subs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop VARCHAR(255) NOT NULL,
      contract_id VARCHAR(64) NOT NULL,
      customer_id VARCHAR(64) NOT NULL,
      email VARCHAR(255) NULL,
      line_variant_id VARCHAR(64) NULL,
      handle VARCHAR(255) NULL,
      status VARCHAR(32) NULL,
      imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_curr_shop_contract (shop, contract_id),
      KEY idx_curr_shop_customer (shop, customer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );

  await run(
    "previous_cancelled_subs",
    `CREATE TABLE IF NOT EXISTS previous_cancelled_subs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop VARCHAR(255) NOT NULL,
      month_stamp CHAR(7) NOT NULL,
      contract_id VARCHAR(64) NOT NULL,
      customer_id VARCHAR(64) NOT NULL,
      email VARCHAR(255) NULL,
      line_variant_id VARCHAR(64) NULL,
      handle VARCHAR(255) NULL,
      removal_status VARCHAR(16) NOT NULL DEFAULT 'pending',
      removal_error TEXT NULL,
      removed_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_prev_shop_contract_month (shop, contract_id, month_stamp),
      KEY idx_prev_shop_customer (shop, customer_id),
      KEY idx_prev_shop_status (shop, removal_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );

  await run(
    "addevent_subscriber_snapshots",
    `CREATE TABLE IF NOT EXISTS addevent_subscriber_snapshots (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop VARCHAR(255) NOT NULL,
      month_stamp CHAR(7) NOT NULL,
      calendar_key VARCHAR(32) NOT NULL,
      calendar_id VARCHAR(128) NOT NULL,
      fetched_at DATETIME NOT NULL,
      subscriber_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_snap_shop_month_cal (shop, month_stamp, calendar_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );

  await run(
    "addevent_subscribers_cache",
    `CREATE TABLE IF NOT EXISTS addevent_subscribers_cache (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      snapshot_id BIGINT UNSIGNED NOT NULL,
      email VARCHAR(255) NOT NULL,
      subscriber_id VARCHAR(128) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_cache_snapshot_email (snapshot_id, email),
      KEY idx_cache_snapshot (snapshot_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );

  await run(
    "removal_jobs",
    `CREATE TABLE IF NOT EXISTS removal_jobs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop VARCHAR(255) NOT NULL,
      month_stamp CHAR(7) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'queued',
      attempts INT NOT NULL DEFAULT 0,
      locked_at DATETIME NULL,
      locked_by VARCHAR(64) NULL,
      stats_json TEXT NULL,
      last_error TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_removal_shop_month (shop, month_stamp),
      KEY idx_removal_pick (status, month_stamp)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );

  await run(
    "removal_logs",
    `CREATE TABLE IF NOT EXISTS removal_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop VARCHAR(255) NOT NULL,
      prev_cancelled_id BIGINT UNSIGNED NOT NULL,
      calendar_key VARCHAR(32) NULL,
      email VARCHAR(255) NULL,
      subscriber_id VARCHAR(128) NULL,
      status VARCHAR(16) NOT NULL,
      error TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_removal_logs_prev (prev_cancelled_id),
      KEY idx_removal_logs_shop (shop)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );

  await run(
    "removal_logs_calendar_key_nullable",
    `ALTER TABLE removal_logs MODIFY COLUMN calendar_key VARCHAR(32) NULL`
  ).catch(() => {});

  await run(
    "workshop_broadcast_logs",
    `CREATE TABLE IF NOT EXISTS workshop_broadcast_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop VARCHAR(255) NOT NULL,
      registration_id BIGINT UNSIGNED NOT NULL,
      month_stamp CHAR(7) NOT NULL,
      broadcast_type VARCHAR(32) NOT NULL DEFAULT 'registrant',
      sent_to VARCHAR(255) NOT NULL,
      status VARCHAR(16) NOT NULL,
      error TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_broadcast_dedupe (shop, registration_id, month_stamp, broadcast_type),
      KEY idx_broadcast_shop_month (shop, month_stamp),
      KEY idx_broadcast_reg (registration_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );

  await run(
    "workshop_registrations_add_cols",
    `ALTER TABLE workshop_registrations
     ADD COLUMN order_name VARCHAR(64) NULL AFTER order_id,
     ADD COLUMN purchased_at DATETIME NULL AFTER last_name`
  ).catch(() => {});

  await run(
    "workshop_registrations_add_idx",
    `ALTER TABLE workshop_registrations
     ADD KEY idx_workshop_created (shop, created_at)`
  ).catch(() => {});

  // console.log("[db] ensureTables done");
};
