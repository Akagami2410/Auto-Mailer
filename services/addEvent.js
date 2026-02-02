import { getPool } from "../utils/db.js";

const API_KEY = process.env.ADDEVENT_API_KEY || "";
const NORTHERN_CALENDAR_ID = process.env.ADDEVENT_NORTHERN_CALENDAR_ID || "";
const SOUTHERN_CALENDAR_ID = process.env.ADDEVENT_SOUTHERN_CALENDAR_ID || "";
const SNAPSHOT_TTL_MINUTES = parseInt(process.env.ADDEVENT_SNAPSHOT_TTL_MINUTES || "15", 10);

const NORTHERN_VARIANT_IDS = (process.env.NORTHERN_VARIANT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const SOUTHERN_VARIANT_IDS = (process.env.SOUTHERN_VARIANT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// console.log(`[addEvent] config: TTL=${SNAPSHOT_TTL_MINUTES}min, northern_variants=${NORTHERN_VARIANT_IDS.length}, southern_variants=${SOUTHERN_VARIANT_IDS.length}`);

class AddEventRateLimitError extends Error {
  constructor(message, retryAfter) {
    super(message);
    this.name = "AddEventRateLimitError";
    this.status = 429;
    this.statusCode = 429;
    this.retryAfter = retryAfter;
  }
}

export const getCalendarKeyForVariant = (lineVariantId) => {
  const variantId = String(lineVariantId || "").trim();
  // console.log(`[addEvent] getCalendarKeyForVariant variantId=${variantId}`);

  if (NORTHERN_VARIANT_IDS.includes(variantId)) {
    // console.log(`[addEvent] matched NORTHERN variant`);
    return "northern";
  }

  if (SOUTHERN_VARIANT_IDS.includes(variantId)) {
    // console.log(`[addEvent] matched SOUTHERN variant`);
    return "southern";
  }

  // console.log(`[addEvent] no calendar match for variant ${variantId}`);
  return null;
};

export const getCalendarId = (calendarKey) => {
  if (calendarKey === "northern") return NORTHERN_CALENDAR_ID;
  if (calendarKey === "southern") return SOUTHERN_CALENDAR_ID;
  return null;
};

const addEventRequest = async (method, endpoint, body = null) => {
  const url = `https://www.addevent.com/api/v1${endpoint}`;
  // console.log(`[addEvent] ${method} ${url}`);

  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
    // console.log(`[addEvent] request body: ${JSON.stringify(body).slice(0, 500)}`);
  }

  const response = await fetch(url, options);
  // console.log(`[addEvent] response status=${response.status}`);

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get("Retry-After") || "30", 10);
    console.error(`[addEvent] 429 RATE LIMITED, Retry-After=${retryAfter}s`);
    throw new AddEventRateLimitError(`Rate limited by AddEvent`, retryAfter);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[addEvent] API error: ${response.status} ${errorText.slice(0, 500)}`);
    throw new Error(`AddEvent API error: ${response.status} - ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  // console.log(`[addEvent] response received`);
  return data;
};

export const fetchCalendarSubscribers = async (calendarId) => {
  // console.log(`[addEvent] fetchCalendarSubscribers calendarId=${calendarId}`);

  if (!API_KEY) {
    throw new Error("ADDEVENT_API_KEY not configured");
  }

  const allSubscribers = [];
  let page = 1;
  const perPage = 100;
  let hasMore = true;

  while (hasMore) {
    // console.log(`[addEvent] fetching page ${page}`);

    const data = await addEventRequest(
      "GET",
      `/calendar/subscribers/list?token=${API_KEY}&calendar_id=${calendarId}&page=${page}&per_page=${perPage}`
    );

    const subscribers = data.subscribers || data.data || [];
    // console.log(`[addEvent] page ${page} returned ${subscribers.length} subscribers`);

    for (const sub of subscribers) {
      allSubscribers.push({
        subscriber_id: String(sub.id || sub.subscriber_id || ""),
        email: String(sub.email || "").toLowerCase().trim(),
      });
    }

    if (subscribers.length < perPage) {
      hasMore = false;
    } else {
      page++;
    }

    if (page > 100) {
      // console.log(`[addEvent] safety limit reached at page 100`);
      break;
    }
  }

  // console.log(`[addEvent] total subscribers fetched: ${allSubscribers.length}`);
  return allSubscribers;
};

export const deleteSubscriber = async (calendarId, subscriberId) => {
  // console.log(`[addEvent] deleteSubscriber calendarId=${calendarId} subscriberId=${subscriberId}`);

  if (!API_KEY) {
    throw new Error("ADDEVENT_API_KEY not configured");
  }

  const data = await addEventRequest(
    "POST",
    `/calendar/subscribers/delete?token=${API_KEY}&calendar_id=${calendarId}&subscriber_id=${subscriberId}`
  );

  // console.log(`[addEvent] subscriber ${subscriberId} deleted`);
  return data;
};

export const ensureSnapshot = async (shop, monthStamp, calendarKey) => {
  const pool = getPool();
  const calendarId = getCalendarId(calendarKey);

  if (!calendarId) {
    // console.log(`[addEvent] no calendar ID for key=${calendarKey}`);
    return null;
  }

  // console.log(`[addEvent] ensureSnapshot shop=${shop} month=${monthStamp} calendar=${calendarKey}`);

  const [existing] = await pool.execute(
    `SELECT id, fetched_at, subscriber_count
     FROM addevent_subscriber_snapshots
     WHERE shop = ? AND month_stamp = ? AND calendar_key = ?
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [shop, monthStamp, calendarKey]
  );

  if (existing.length > 0) {
    const snapshot = existing[0];
    const fetchedAt = new Date(snapshot.fetched_at);
    const ageMinutes = (Date.now() - fetchedAt.getTime()) / 60000;

    // console.log(`[addEvent] existing snapshot id=${snapshot.id} age=${ageMinutes.toFixed(1)}min count=${snapshot.subscriber_count}`);

    if (ageMinutes < SNAPSHOT_TTL_MINUTES) {
      // console.log(`[addEvent] snapshot is fresh (TTL=${SNAPSHOT_TTL_MINUTES}min), reusing`);
      return snapshot.id;
    }

    // console.log(`[addEvent] snapshot is stale, fetching new one`);
  }

  // console.log(`[addEvent] fetching fresh subscriber list from AddEvent`);
  const subscribers = await fetchCalendarSubscribers(calendarId);

  const fetchedAtSql = new Date().toISOString().slice(0, 19).replace("T", " ");

  const [insertResult] = await pool.execute(
    `INSERT INTO addevent_subscriber_snapshots (shop, month_stamp, calendar_key, calendar_id, fetched_at, subscriber_count)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       fetched_at = VALUES(fetched_at),
       subscriber_count = VALUES(subscriber_count)`,
    [shop, monthStamp, calendarKey, calendarId, fetchedAtSql, subscribers.length]
  );

  let snapshotId;
  if (insertResult.insertId) {
    snapshotId = insertResult.insertId;
  } else {
    const [rows] = await pool.execute(
      `SELECT id FROM addevent_subscriber_snapshots WHERE shop = ? AND month_stamp = ? AND calendar_key = ?`,
      [shop, monthStamp, calendarKey]
    );
    snapshotId = rows[0]?.id;
  }

  // console.log(`[addEvent] snapshot created/updated id=${snapshotId}, populating cache...`);

  await pool.execute(
    `DELETE FROM addevent_subscribers_cache WHERE snapshot_id = ?`,
    [snapshotId]
  );

  if (subscribers.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < subscribers.length; i += batchSize) {
      const batch = subscribers.slice(i, i + batchSize);
      const placeholders = batch.map(() => "(?, ?, ?)").join(",");
      const values = batch.flatMap((s) => [snapshotId, s.email, s.subscriber_id]);

      await pool.execute(
        `INSERT INTO addevent_subscribers_cache (snapshot_id, email, subscriber_id) VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE subscriber_id = VALUES(subscriber_id)`,
        values
      );

      // console.log(`[addEvent] cached batch ${i / batchSize + 1}, ${batch.length} subscribers`);
    }
  }

  // console.log(`[addEvent] snapshot ${snapshotId} fully populated with ${subscribers.length} subscribers`);
  return snapshotId;
};

export const lookupSubscriberByEmail = async (snapshotId, email) => {
  const pool = getPool();
  const normalizedEmail = String(email || "").toLowerCase().trim();

  // console.log(`[addEvent] lookupSubscriberByEmail snapshotId=${snapshotId} email=${normalizedEmail}`);

  const [rows] = await pool.execute(
    `SELECT subscriber_id FROM addevent_subscribers_cache WHERE snapshot_id = ? AND email = ?`,
    [snapshotId, normalizedEmail]
  );

  if (rows.length > 0) {
    // console.log(`[addEvent] found subscriber_id=${rows[0].subscriber_id}`);
    return rows[0].subscriber_id;
  }

  // console.log(`[addEvent] subscriber not found in cache`);
  return null;
};

export { AddEventRateLimitError };
