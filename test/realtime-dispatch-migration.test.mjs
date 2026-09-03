import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migration=await readFile(new URL('../supabase/migrations/20260903001000_realtime_provider_dispatch.sql',import.meta.url),'utf8');
describe('migration dispatch Realtime',()=>{
  it('exclut toute offre antérieure et choisit un seul meilleur provider',()=>{
    assert.match(migration,/not exists\s*\(select 1 from public\.mission_offers previous/i);
    assert.match(migration,/previous\.mission_id=mission_row\.id and previous\.provider_id=pp\.provider_id/i);
    assert.match(migration,/order by c\.distance_km[\s\S]*limit 1/i);
  });
  it('enchaîne refus et expiration vers un rematching serveur verrouillé',()=>{
    assert.match(migration,/decline_current_provider_offer[\s\S]*for update[\s\S]*status='declined'[\s\S]*dispatch_next_mission_offer/i);
    assert.match(migration,/expire_current_mission_offer_and_rematch[\s\S]*expires_at>statement_timestamp\(\)[\s\S]*status='expired'[\s\S]*dispatch_next_mission_offer/i);
  });
  it('préserve les permissions et publie les changements Realtime',()=>{
    assert.match(migration,/revoke all on function public\.expire_current_mission_offer_and_rematch\(uuid\) from public,anon/i);
    for(const table of ['missions','mission_offers','mission_events'])assert.match(migration,new RegExp(`alter publication supabase_realtime add table public\\.${table}`,'i'));
  });
});
