import { db } from '@/db/schema';

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await db.settings.get(key))?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

export const BACKUP_REMIND_DAYS = 14;

export function needsBackupReminder(lastBackupAt: number | undefined, txCount: number, now = Date.now()): boolean {
  if (txCount === 0) return false;
  if (!lastBackupAt) return true;
  return now - lastBackupAt >= BACKUP_REMIND_DAYS * 86_400_000;
}
