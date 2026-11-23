import { DEFAULT_SETTINGS, type UserSettings } from "../../../shared/constants";

/** Load a user's settings, filling gaps with defaults. */
export async function getSettings(db: D1Database, userId: number): Promise<UserSettings> {
  const { results } = await db.prepare("SELECT key, value FROM settings WHERE user_id = ?").bind(userId).all<{ key: string; value: string }>();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of results) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      /* keep default */
    }
  }
  return out as unknown as UserSettings;
}

export async function saveSettings(db: D1Database, userId: number, patch: Partial<UserSettings>): Promise<void> {
  const now = new Date().toISOString();
  const stmts = Object.entries(patch)
    .filter(([k, v]) => k in DEFAULT_SETTINGS && v !== undefined)
    .map(([k, v]) =>
      db
        .prepare(
          "INSERT INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
        .bind(userId, k, JSON.stringify(v), now),
    );
  if (stmts.length) await db.batch(stmts);
}
