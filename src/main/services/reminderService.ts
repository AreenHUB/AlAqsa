// ============================================================================
// AlAqsa — Reminder scheduler.
//
// Two levels of notification, as requested:
//   1. In-app  — the renderer receives 'event:reminder-due' and shows a banner.
//   2. Windows — a real desktop notification via Electron's Notification API.
//
// Also auto-generates reminders from data: warranty expiry, camera-license
// expiry, and next-visit dates, so nothing has to be entered twice.
// ============================================================================

import { Notification } from 'electron';
import type { AppContext } from '../main';
import { remindersRepo, camLicenseRepo, invoicesRepo } from '../db/repositories/miscRepo';
import { devicesRepo } from '../db/repositories/devicesRepo';
import { getDb } from '../db/database';
import { clientsRepo } from '../db/repositories/clientsRepo';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly
let timer: NodeJS.Timeout | null = null;
const notifiedToday = new Set<string>();

export function startReminderScheduler(ctx: AppContext): void {
  if (timer) clearInterval(timer);
  // First check shortly after launch, then hourly.
  setTimeout(() => runCheck(ctx), 20_000);
  timer = setInterval(() => runCheck(ctx), CHECK_INTERVAL_MS);
}

export function stopReminderScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

function runCheck(ctx: AppContext): void {
  // Only meaningful when the DB is open.
  if (!ctx.secure.isUnlocked()) return;
  try {
    syncDerivedReminders();
    const due = remindersRepo.dueNow();
    for (const r of due) {
      if (notifiedToday.has(r.id)) continue;
      notifiedToday.add(r.id);

      ctx.mainWindow?.webContents.send('event:reminder-due', r);

      if (Notification.isSupported()) {
        new Notification({
          title: 'تذكير — الأقصى',
          body: `${r.title}\nالتاريخ: ${r.dueDate}`,
          silent: false,
        }).show();
      }
    }
  } catch {
    // Scheduler must never crash the app.
  }
}

/** Reset the per-run notification guard at midnight. */
setInterval(() => notifiedToday.clear(), 24 * 60 * 60 * 1000);

/**
 * Create reminders implied by the data (idempotent — keyed by a synthetic
 * title so the same expiry never produces duplicates).
 */
function syncDerivedReminders(): void {
  const db = getDb();
  const existingTitles = new Set(
    (db.prepare('SELECT title FROM reminders').all() as { title: string }[]).map((r) => r.title),
  );

  const add = (kind: any, title: string, dueDate: string, leadDays: number, ids: Partial<{ clientId: string; branchId: string; deviceId: string }>) => {
    if (existingTitles.has(title)) return;
    remindersRepo.save({ kind, title, dueDate, leadDays, ...ids });
    existingTitles.add(title);
  };

  // Warranties expiring within 60 days.
  for (const d of devicesRepo.expiringWarranties(60)) {
    add('warranty_expiry', `انتهاء ضمان: ${d.label ?? d.model ?? d.type} (${d.serialNumber ?? '—'})`,
      d.warrantyExpiry!, 30, { branchId: d.branchId, deviceId: d.id });
  }

  // Camera licenses expiring within 90 days.
  for (const l of camLicenseRepo.expiringWithin(90)) {
    add('license_expiry', `انتهاء رخصة كاميرات رقم ${l.licenseNumber ?? '—'}`,
      l.expiryDate!, 30, { clientId: l.clientId, branchId: l.branchId });
  }

  // Next scheduled visits.
  const nextVisits = db.prepare(
    `SELECT v.id, v.client_id, v.branch_id, v.next_visit_date, b.name_ar AS branch_name
     FROM visits v JOIN branches b ON b.id = v.branch_id
     WHERE v.next_visit_date IS NOT NULL AND v.next_visit_date >= date('now')
       AND v.next_visit_date <= date('now', '+90 days')`,
  ).all() as any[];
  for (const v of nextVisits) {
    add('maintenance_due', `موعد صيانة قادم — ${v.branch_name}`,
      v.next_visit_date, 7, { clientId: v.client_id, branchId: v.branch_id });
  }

  // Auto-flag clients with overdue invoices (red warning for the team).
  for (const clientId of invoicesRepo.overdueClientIds()) {
    const c = clientsRepo.get(clientId);
    if (c && !c.isFlagged) {
      clientsRepo.update(clientId, {
        isFlagged: true,
        flagReason: (c.flagReason ? c.flagReason + ' | ' : '') + 'فاتورة متأخرة عن تاريخ الاستحقاق (تلقائي)',
      });
    }
  }
}
