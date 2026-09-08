import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { it } from 'node:test';

const migrationUrl = new URL('../supabase/migrations/20260908001200_atomic_customer_search_cancellation.sql', import.meta.url);

it('cancels search and pending offers atomically with the shared mission-first lock order', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /from public\.missions[\s\S]*where id = target_mission_id[\s\S]*for update/i);
  assert.match(sql, /provider_id is not null[\s\S]*status not in \('requested', 'searching', 'offered'\)/i);
  assert.match(sql, /update public\.mission_offers[\s\S]*status = 'expired'[\s\S]*status = 'pending'/i);
  assert.match(sql, /update public\.missions[\s\S]*status = 'cancelled'/i);
  assert.ok(sql.indexOf('update public.mission_offers') < sql.indexOf('update public.missions'));
  assert.match(sql, /grant execute on function public\.cancel_current_customer_mission\(uuid, integer\) to authenticated/i);
});
