import { storage } from "./storage";
import { notifyJobCrew } from "./notificationService";
import { db } from "./db";
import { sql } from "drizzle-orm";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const NOTIFY_WINDOW_MS = 30 * 60 * 1000;

const notifiedJobIds = new Set<number>();

export async function checkUpcomingJobs(): Promise<{ scanned: number; eligible: number; notified: number; skipped: number }> {
  const stats = { scanned: 0, eligible: 0, notified: 0, skipped: 0 };

  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() + 30 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 35 * 60 * 1000);

    const wsDate = windowStart.toISOString().slice(0, 10);
    const weDate = windowEnd.toISOString().slice(0, 10);
    const wsTime = windowStart.toTimeString().slice(0, 5);
    const weTime = windowEnd.toTimeString().slice(0, 5);

    let query: string;
    if (wsDate === weDate) {
      query = `
        SELECT id, title, start_date, scheduled_time, company_id
        FROM jobs
        WHERE status IN ('active', 'pending')
          AND start_date = '${wsDate}'
          AND scheduled_time IS NOT NULL
          AND scheduled_time >= '${wsTime}'
          AND scheduled_time <= '${weTime}'
      `;
    } else {
      query = `
        SELECT id, title, start_date, scheduled_time, company_id
        FROM jobs
        WHERE status IN ('active', 'pending')
          AND scheduled_time IS NOT NULL
          AND (
            (start_date = '${wsDate}' AND scheduled_time >= '${wsTime}')
            OR
            (start_date = '${weDate}' AND scheduled_time <= '${weTime}')
          )
      `;
    }

    const result = await db.execute(sql.raw(query));
    stats.scanned = (result.rows as any[]).length;

    for (const row of result.rows as any[]) {
      if (notifiedJobIds.has(row.id)) {
        stats.skipped++;
        continue;
      }

      stats.eligible++;
      notifiedJobIds.add(row.id);

      const jobLabel = row.title || `Job #${row.id}`;

      try {
        await notifyJobCrew(row.id, row.company_id, {
          type: "job_starting_soon",
          title: "EcoLogic",
          body: "Job starting in 30 minutes",
          entityType: "job",
          entityId: row.id,
          linkUrl: `/jobs/${row.id}`,
          meta: { jobTitle: jobLabel, scheduledTime: row.scheduled_time },
        });
        stats.notified++;
        if (process.env.NODE_ENV === "development") {
          console.log(`[job_starting_soon] job=${row.id} "${jobLabel}" startAt=${row.start_date}T${row.scheduled_time}`);
        }
      } catch (err) {
        console.error(`[job_starting_soon] Failed for job ${row.id}:`, err);
      }
    }

    if (notifiedJobIds.size > 500) {
      const idsArray = Array.from(notifiedJobIds);
      for (let i = 0; i < idsArray.length - 200; i++) {
        notifiedJobIds.delete(idsArray[i]);
      }
    }
  } catch (err) {
    console.error("[job_starting_soon] Error:", err);
  }

  console.log(`[job_starting_soon] scanned=${stats.scanned} eligible=${stats.eligible} notified=${stats.notified} skipped=${stats.skipped}`);
  return stats;
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startJobScheduler(): void {
  if (intervalId) return;
  console.log("[JobScheduler] Starting job_starting_soon scheduler (every 5 min)");
  checkUpcomingJobs();
  intervalId = setInterval(checkUpcomingJobs, CHECK_INTERVAL_MS);
}

export function stopJobScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
