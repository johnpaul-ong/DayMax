/**
 * Paginated RPC helper. Supabase caps every RPC (and every table
 * query) at 1000 rows -- so a call that returns a year of 15-minute
 * slots per person (~35k rows) silently truncates on a raw `.rpc()`.
 * rpcAll pages through with .range() until the last page comes back
 * short, then returns the concatenated result.
 *
 * Duplicated across friends.ts / pursuits.ts / money.ts before this
 * extraction. One canonical implementation, one place to fix if the
 * cap ever changes.
 */

import { createClient } from "./client";

const PAGE = 1000;

export async function rpcAll(fn: string, params: Record<string, unknown> = {}): Promise<any[]> {
  const supabase = createClient();
  const all: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.rpc(fn, params).range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data as any[]) ?? [];
    if (rows.length === 0) break;
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}
