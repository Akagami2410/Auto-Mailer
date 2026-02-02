import { claimJob, completeJob, failJob, getQueueStats, workerId } from "./queue.js";
import { processOrderPaid } from "./orderProcessor.js";
import { ShopifyRateLimitError } from "./shopify.js";

let isRunning = false;
let activeWorkers = 0;
let processedCount = 0;
let errorCount = 0;

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "3", 10);
const POLL_MS = parseInt(process.env.WORKER_POLL_MS || "2000", 10);
const MAX_ATTEMPTS = parseInt(process.env.WORKER_MAX_ATTEMPTS || "5", 10);

// console.log(`[worker] config: CONCURRENCY=${CONCURRENCY} POLL_MS=${POLL_MS} MAX_ATTEMPTS=${MAX_ATTEMPTS}`);
// console.log(`[worker] workerId=${workerId}`);

const processJob = async (job) => {
  // console.log(`\n----------------------------------------`);
  // console.log(`[worker] ${workerId} PROCESSING job id=${job.id} type=${job.jobType} orderId=${job.orderId} attempt=${job.attempts}`);
  // console.log(`----------------------------------------`);

  const startTime = Date.now();

  try {
    if (job.jobType === "order_paid") {
      const order = job.payload;
      await processOrderPaid(job.shop, order);
    } else {
      // console.log(`[worker] unknown job type: ${job.jobType}, completing anyway`);
    }

    await completeJob(job.id);

    const duration = Date.now() - startTime;
    processedCount++;

    // console.log(`[worker] job ${job.id} COMPLETED in ${duration}ms (total processed: ${processedCount})`);
    return { success: true, duration };

  } catch (err) {
    const duration = Date.now() - startTime;
    errorCount++;

    console.error(`[worker] job ${job.id} FAILED after ${duration}ms:`, err.message);

    let retryAfter = null;
    if (err instanceof ShopifyRateLimitError) {
      retryAfter = err.retryAfter || 10;
      // console.log(`[worker] Shopify 429 detected, will retry after ${retryAfter}s`);
    }

    const failResult = await failJob(job.id, err.message, retryAfter);

    // console.log(`[worker] job ${job.id} fail result: ${JSON.stringify(failResult)}`);

    return { success: false, error: err.message, duration, failResult };
  }
};

const workerLoop = async (workerIndex) => {
  // console.log(`[worker] worker ${workerIndex} starting loop`);

  while (isRunning) {
    try {
      const jobs = await claimJob(1);

      if (jobs.length === 0) {
        await sleep(POLL_MS);
        continue;
      }

      activeWorkers++;
      // console.log(`[worker] active workers: ${activeWorkers}/${CONCURRENCY}`);

      for (const job of jobs) {
        await processJob(job);
      }

      activeWorkers--;
      // console.log(`[worker] worker ${workerIndex} finished, active: ${activeWorkers}/${CONCURRENCY}`);

    } catch (err) {
      console.error(`[worker] worker ${workerIndex} loop error:`, err.message);
      await sleep(POLL_MS * 2);
    }
  }

  // console.log(`[worker] worker ${workerIndex} stopped`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const startWorker = async () => {
  if (isRunning) {
    // console.log(`[worker] already running`);
    return;
  }

  // console.log(`\n========================================`);
  // console.log(`[worker] STARTING WORKER POOL`);
  // console.log(`[worker] workerId=${workerId}`);
  // console.log(`[worker] concurrency=${CONCURRENCY}`);
  // console.log(`[worker] pollMs=${POLL_MS}`);
  // console.log(`========================================\n`);

  isRunning = true;

  const stats = await getQueueStats();
  // console.log(`[worker] initial queue stats:`, stats);

  for (let i = 0; i < CONCURRENCY; i++) {
    // console.log(`[worker] spawning worker ${i}`);
    workerLoop(i).catch((err) => {
      console.error(`[worker] worker ${i} crashed:`, err.message);
    });
  }

  // console.log(`[worker] all ${CONCURRENCY} workers spawned`);
};

export const stopWorker = () => {
  // console.log(`[worker] stopping worker pool...`);
  isRunning = false;
};

export const getWorkerStats = () => {
  return {
    isRunning,
    workerId,
    activeWorkers,
    processedCount,
    errorCount,
    concurrency: CONCURRENCY,
  };
};

export const logStats = async () => {
  const queueStats = await getQueueStats();
  const workerStats = getWorkerStats();

  // console.log(`\n[worker] === STATS ===`);
  // console.log(`[worker] running=${workerStats.isRunning} active=${workerStats.activeWorkers}/${workerStats.concurrency}`);
  // console.log(`[worker] processed=${workerStats.processedCount} errors=${workerStats.errorCount}`);
  // console.log(`[worker] queue: queued=${queueStats.queued} processing=${queueStats.processing} completed=${queueStats.completed} failed=${queueStats.failed}`);
  // console.log(`[worker] ============\n`);

  return { workerStats, queueStats };
};

setInterval(async () => {
  if (isRunning) {
    try {
      await logStats();
    } catch (err) {
      console.error(`[worker] stats error:`, err.message);
    }
  }
}, 60000);
