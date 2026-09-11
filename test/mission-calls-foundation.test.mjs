import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { createSupabaseMissionsRepository } from '../src/supabase/repositories/missions.js';
import { createSupabaseOffersRepository } from '../src/supabase/repositories/offers.js';
import { createSupabaseProfilesRepository } from '../src/supabase/repositories/profiles.js';

const migrationUrl = new URL('../supabase/migrations/20260911120000_mission_calls_foundation.sql', import.meta.url);
const sqlTestUrl = new URL('../supabase/tests/019_mission_calls_foundation.sql', import.meta.url);

const realtimeClient = () => {
  const subscriptions = [];
  const channel = {
    on(_kind, config) { subscriptions.push(config); return channel; },
    subscribe() { return channel; },
  };
  return {
    subscriptions,
    client: {
      channel: () => channel,
      removeChannel: () => {},
      from: () => ({ select: () => ({}) }),
      rpc: async () => ({ data: null, error: null }),
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      storage: { from: () => ({ getPublicUrl: () => ({ data: {} }) }) },
    },
  };
};

describe('mission call server foundation', () => {
  it('defines server-derived participants, callable states, lifecycle and hard concurrency guard', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    assert.match(sql, /create table public\.mission_calls/i);
    assert.match(sql, /caller_user_id uuid not null references public\.profiles/i);
    assert.match(sql, /callee_user_id uuid not null references public\.profiles/i);
    assert.match(sql, /'call_' \|\| replace\(gen_random_uuid\(\)::text, '-', ''\)/i);
    assert.match(sql, /mission_calls_one_open_per_mission_idx[\s\S]*where status in \('ringing', 'active'\)/i);
    assert.match(sql, /select \* into mission_row[\s\S]*for update/i);
    for (const status of ['accepted','travelling','arrived','quote_pending','in_progress','supplement_pending','completed_pending_payment']) {
      assert.match(sql, new RegExp(`'${status}'`));
    }
    assert.match(sql, /new\.status in \('completed','cancelled','expired'\)/i);
    assert.match(sql, /set status='ended'/i);
    assert.match(sql, /set status = 'missed'/i);
    assert.match(sql, /home_ai_expire_mission_calls/i);
  });

  it('allows participant reads only and revokes every direct mutation', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    assert.match(sql, /alter table public\.mission_calls enable row level security/i);
    assert.match(sql, /revoke all on table public\.mission_calls from public, anon, authenticated/i);
    assert.match(sql, /grant select on table public\.mission_calls to authenticated/i);
    assert.match(sql, /caller_user_id = \(select auth\.uid\(\)\)[\s\S]*callee_user_id = \(select auth\.uid\(\)\)/i);
    for (const name of ['start_mission_call','answer_mission_call','decline_mission_call','end_mission_call','get_current_mission_call']) {
      assert.match(sql, new RegExp(`create or replace function public\\.${name}`,'i'));
      assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\(uuid\\) to authenticated`,'i'));
    }
  });

  it('neutralizes cross-user phone access while preserving an own-profile getter', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    assert.match(sql, /create or replace function public\.get_profile_phone[\s\S]*Phone access is disabled/i);
    assert.match(sql, /revoke all on function public\.get_profile_phone\(uuid\) from public, anon, authenticated/i);
    assert.match(sql, /revoke select\(phone\) on public\.profiles from anon, authenticated/i);
    const publicProfile = sql.match(/create or replace function public\.get_provider_professional_profile[\s\S]*?end;\n\$\$;/i)?.[0] ?? '';
    assert.doesNotMatch(publicProfile, /'phone'|p\.phone/i);
    assert.match(sql, /create or replace function public\.get_current_profile_phone\(\)/i);
  });

  it('publishes call state and extends the existing channels without another poller', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    assert.match(sql, /alter publication supabase_realtime add table public\.mission_calls/i);
    const customer = realtimeClient();
    createSupabaseMissionsRepository(customer.client).subscribeMission('m1', () => {});
    assert.ok(customer.subscriptions.some(item => item.table === 'mission_calls' && item.filter === 'mission_id=eq.m1'));
    const provider = realtimeClient();
    createSupabaseOffersRepository(provider.client).subscribeProviderDispatch('p1', () => {});
    assert.ok(provider.subscriptions.some(item => item.table === 'mission_calls'));
    const sources = await Promise.all([
      readFile(new URL('../src/supabase/repositories/missions.js', import.meta.url), 'utf8'),
      readFile(new URL('../src/supabase/repositories/offers.js', import.meta.url), 'utf8'),
    ]);
    assert.doesNotMatch(sources.join('\n'), /setInterval[\s\S]*mission_calls/);
  });

  it('contains rollback SQL coverage for access, missed calls, callbacks and terminal missions', async () => {
    const sql = await readFile(sqlTestUrl, 'utf8');
    assert.match(sql, /(?:^|\n)begin;/i);
    assert.match(sql, /rollback;\s*$/i);
    for (const phrase of [
      'Other client accessed mission call', 'Other provider started mission call',
      'Provider callback participants were not derived', 'Missed expiration did not run',
      'Terminal mission left an open call', 'Unique index allowed two open calls',
      'Legacy phone RPC remained executable', 'Public provider profile still contains phone',
    ]) assert.match(sql, new RegExp(phrase));
  });

  it('uses the own-profile phone RPC instead of the retired targeted endpoint', async () => {
    const calls = [];
    const repository = createSupabaseProfilesRepository({
      rpc: async (name, args) => { calls.push([name, args]); return { data: '+84900000000', error: null }; },
      from: () => ({}), auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    assert.equal(await repository.getPhone('ignored-target'), '+84900000000');
    assert.deepEqual(calls, [['get_current_profile_phone', undefined]]);
  });
});
