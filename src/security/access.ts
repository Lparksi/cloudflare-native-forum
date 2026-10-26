import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { accountAccess } from '../db/schema';
export type Role = 'member' | 'moderator' | 'admin';
export async function accessFor(db: D1Database, userId: string) {
  return (
    await drizzle(db)
      .select()
      .from(accountAccess)
      .where(eq(accountAccess.userId, userId))
      .limit(1)
  )[0];
}
export function activeProfile(profileId: string) {
  return sql`EXISTS(SELECT 1 FROM account_access a INNER JOIN profiles p ON p.user_id = a.user_id WHERE p.id = ${profileId} AND a.banned = 0)`;
}
