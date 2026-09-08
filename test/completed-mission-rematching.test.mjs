import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const completion = await readFile(new URL('../supabase/migrations/20260902000900_mission_completion_history_reviews.sql', import.meta.url), 'utf8');
const matching = await readFile(new URL('../supabase/migrations/20260903001000_realtime_provider_dispatch.sql', import.meta.url), 'utf8');

describe('mission terminee, review et nouveau matching', () => {
  it('confirme le paiement externe puis libere atomiquement le provider selon son statut online', () => {
    assert.match(completion, /status='completed',payment_status='paid_external',completed_at=statement_timestamp\(\),version=version\+1/);
    assert.match(completion, /set current_mission_id=null,available=online/);
    assert.match(completion, /where provider_id=mission_row\.provider_id and current_mission_id=mission_row\.id/);
  });

  it('enregistre une seule review 1 a 5 pour le customer de la mission', () => {
    assert.match(completion, /new_rating not between 1 and 5/);
    assert.match(completion, /mission_row\.client_id is distinct from uid/);
    assert.match(completion, /exists\(select 1 from public\.reviews r where r\.mission_id=mission_row\.id\).*23505/s);
    assert.match(completion, /revoke insert,update,delete on public\.reviews from authenticated/);
  });

  it('retourne montant, date et review dans l historique reel', () => {
    for (const field of ['finalAuthorizedAmount', 'completedAt', 'review']) assert.match(completion, new RegExp(`'${field}'`));
    assert.match(completion, /left join public\.reviews r on r\.mission_id=m\.id/);
  });

  it('rend le provider libere eligible a une nouvelle mission sans accepter un provider occupe', () => {
    assert.match(matching, /pst\.online and pst\.available and pst\.current_mission_id is null/);
    assert.match(matching, /status_row\.current_mission_id is not null/);
    assert.match(matching, /set available=false,current_mission_id=mission_row\.id/);
  });
});
