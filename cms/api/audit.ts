import type { Db } from "../db/client.ts";
import { auditLog } from "../db/schema.ts";

export function audit(db: Db, entry: { userId?: number | null; action: string; entityType?: string; entityId?: string | number; detail?: unknown; ip?: string | null }) {
  return db.insert(auditLog).values({
    userId: entry.userId ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId == null ? null : String(entry.entityId),
    detail: entry.detail ?? null,
    ip: entry.ip ?? null
  });
}
