import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migration = new URL('../supabase/migrations/20260902000900_mission_completion_history_reviews.sql', import.meta.url);
const sql = await readFile(migration, 'utf8');

describe('mission completion migration', () => {
  it('separates quote acceptance from provider start and locks both transitions', () => {
    assert.match(sql, /quote_row\.type='initial' then 'quote_pending'/);
    assert.doesNotMatch(sql, /started_at=case when new_decision='accepted'/);
    assert.match(sql, /status<>'quote_pending'.*accepted_quote\.id is null/s);
    assert.match(sql, /where id=mission_row\.id and provider_id=uid and version=expected_version/);
  });

  it('requires the assigned active verified provider to start and finish', () => {
    assert.equal((sql.match(/pp\.provider_id=uid and pp\.active and pp\.kyc_status='verified'/g) ?? []).length, 3);
    assert.equal((sql.match(/mission_row\.provider_id is distinct from uid/g) ?? []).length, 2);
    assert.match(sql, /mission_row\.status<>'in_progress'/);
    assert.match(sql, /status='completed_pending_payment'/);
  });

  it('prevents stale concurrent starts, finishes and payment confirmations', () => {
    assert.equal((sql.match(/from public\.missions where id=target_mission_id for update/g) ?? []).length, 4);
    assert.equal((sql.match(/mission_row\.version is distinct from expected_version/g) ?? []).length, 3);
    assert.match(sql, /payment_status<>'unpaid'/);
    assert.match(sql, /status='completed',payment_status='paid_external'/);
  });

  it('creates one immutable review for the completed mission customer only', () => {
    assert.match(sql, /mission_row\.client_id is distinct from uid/);
    assert.match(sql, /mission_row\.status<>'completed'/);
    assert.match(sql, /exists\(select 1 from public\.reviews r where r\.mission_id=mission_row\.id\)/);
    assert.match(sql, /drop policy if exists reviews_client_insert/);
    assert.match(sql, /revoke insert,update,delete on public\.reviews from authenticated/);
  });

  it('returns participant history and denies anonymous execution', () => {
    assert.match(sql, /user_role='customer' and m\.client_id=uid/);
    assert.match(sql, /user_role='provider' and m\.provider_id=uid/);
    assert.equal((sql.match(/security definer set search_path = ''/g) ?? []).length, 7);
    assert.match(sql, /'assignment'.*'version',m\.version/s);
    assert.equal((sql.match(/from public,anon/g) ?? []).length, 5);
    assert.equal((sql.match(/to authenticated/g) ?? []).length, 5);
  });
});
