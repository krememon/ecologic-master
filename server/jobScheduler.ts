import { storage } from "./storage";
import { notifyJobCrew } from "./notificationService";
import { db } from "./db";
import { sql } from "drizzle-orm";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const NOTIFY_WINDOW_MS = 30 * 60 * 1000;

const notifiedJobIds = new Set<number>();

async function checkUpcomingJobs(): Promise<void> {
  try {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + NOTIFY_WINDOW_MS);

    const nowDate = now.toISOString().slice(0, 10);
    const windowDate = windowEnd.toISOString().slice(0, 10);
    const nowTime = now.toTimeString().slice(0, 5);
    const windowTime = windowEnd.toTimeString().slice(0, 5);

    let query: string;
    if (nowDate === windowDate) {
      query = `
        SELECT id, title, start_date, scheduled_time, company_id
        FROM jobs
        WHERE status IN ('active', 'pending')
          AND start_date = '${nowDate}'
          AND scheduled_time IS NOT NULL
          AND scheduled_time >= '${nowTime}'
          AND scheduled_time <= '${windowTime}'
      `;
    } else {
      query = `
        SELECT id, title, start_date, scheduled_time, company_id
        FROM jobs
        WHERE status IN ('active', 'pending')
          AND scheduled_time IS NOT NULL
          AND (
            (start_date = '${nowDate}' AND scheduled_time >= '${nowTime}')
            OR
            (start_date = '${windowDate}' AND scheduled_time <= '${windowTime}')
          )
      `;
    }

    const result = await db.execute(sql.raw(query));

    for (const row of result.rows as any[]) {
      if (notifiedJobIds.has(row.id)) continue;

      const jobDateTime = new Date(`${row.start_date}T${row.scheduled_time}:00`);
      const minutesUntil = Math.round((jobDateTime.getTime() - now.getTime()) / 60000);

      if (minutesUntil < 0 || minutesUntil > 35) continue;

      notifiedJobIds.add(row.id);

      const jobLabel = row.title || `Job #${row.id}`;
      const timeStr = row.scheduled_time;

      try {
        await notifyJobCrew(row.id, row.company_id, {
          type: "job_starting_soon",
          title: "Job Starting Soon",
          body: `${jobLabel} starts at ${timeStr} (in ~${minutesUntil} min)`,
          entityType: "job",
          entityId: row.id,
          linkUrl: `/jobs/${row.id}`,
        });
        console.log(`[JobScheduler] Sent job_starting_soon for job ${row.id} (${jobLabel}) in ${minutesUntil}m`);
      } catch (err) {
        console.error(`[JobScheduler] Failed to notify for job ${row.id}:`, err);
      }
    }

    if (notifiedJobIds.size > 500) {
      const idsArray = Array.from(notifiedJobIds);
      for (let i = 0; i < idsArray.length - 200; i++) {
        notifiedJobIds.delete(idsArray[i]);
      }
    }
  } catch (err) {
    console.error("[JobScheduler] Error checking upcoming jobs:", err);
  }
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
