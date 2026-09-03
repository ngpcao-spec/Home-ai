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
  it('empêche le même provider de gagner simultanément deux missions',()=>{
    assert.match(migration,/select \* into status_row from public\.provider_status[\s\S]*for update/i);
    assert.match(migration,/not status_row\.online or not status_row\.available[\s\S]*status_row\.current_mission_id is not null/i);
    assert.match(migration,/mission -> profile -> provider profile -> provider status ->[\s\S]*service -> offer/i);
  });
  it('refuse un provider devenu indisponible avant acceptation',()=>{
    assert.match(migration,/not status_row\.online or not status_row\.available/i);
    assert.match(migration,/status_row\.current_mission_id is not null/i);
  });
  it('refuse KYC révoqué, profil ou provider désactivé et service désactivé',()=>{
    assert.match(migration,/profile_row\.status<>'active'/i);
    assert.match(migration,/not provider_row\.active or provider_row\.kyc_status<>'verified'/i);
    assert.match(migration,/service_row\.id is null or not service_row\.enabled/i);
  });
  it('refuse une offre expirée ou une mission devenue non attribuable',()=>{
    assert.match(migration,/offer_row\.status<>'pending' or offer_row\.expires_at<=statement_timestamp\(\)/i);
    assert.match(migration,/mission_row\.provider_id is not null or mission_row\.status not in \('searching','offered'\)/i);
  });
  it('programme une expiration autonome Supabase Cron',()=>{
    assert.match(migration,/create extension if not exists pg_cron/i);
    assert.match(migration,/cron\.schedule\([\s\S]*home_ai_expire_mission_offers[\s\S]*10 seconds/i);
    assert.match(migration,/expire_due_mission_offers[\s\S]*for update skip locked[\s\S]*status='expired'[\s\S]*dispatch_next_mission_offer/i);
  });
});
