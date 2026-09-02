import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{describe,it}from'node:test';
const url=new URL('../supabase/migrations/20260902000600_provider_app_rpc.sql',import.meta.url);
describe('sécurité SQL Provider App',()=>{
 it('lie chaque mutation à auth.uid et refuse anon/public',async()=>{const sql=await readFile(url,'utf8');assert.doesNotMatch(sql,/service_role|assigned_provider_id/);assert.equal((sql.match(/security definer/g)??[]).length,3);assert.equal((sql.match(/from public, anon;/g)??[]).length,3);assert.match(sql,/provider_id=uid and status='pending'/);assert.match(sql,/where provider_id=uid and \(current_mission_id is null or not new_available\)/);assert.match(sql,/status='declined'/);});
 it('refuse un provider KYC non vérifié dans chacune des trois RPC',async()=>{const sql=await readFile(url,'utf8');assert.equal((sql.match(/pp\.kyc_status='verified'/g)??[]).length,3);});
 it('refuse un provider désactivé dans chacune des trois RPC',async()=>{const sql=await readFile(url,'utf8');assert.equal((sql.match(/pp\.provider_id=uid and pp\.active/g)??[]).length,3);});
 it('retourne une zone sûre même si address_text ne contient aucune virgule',async()=>{const sql=await readFile(url,'utf8');assert.match(sql,/'approximateAddress', 'Khu vực Nha Trang'/);assert.doesNotMatch(sql,/regexp_replace|split_part/);});
 it('ne révèle jamais address_text avant attribution et le réserve au provider assigné',async()=>{const sql=await readFile(url,'utf8');assert.equal((sql.match(/m\.address_text/g)??[]).length,1);assert.match(sql,/'address', m\.address_text/);assert.match(sql,/where m\.provider_id=uid and m\.status not in/);});
});
