import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { initialiseProviderApp } from '../src/provider/provider-app.js';
import { createMockProviderAppRepository } from '../src/provider/provider-repository.js';
import { createSupabaseOffersRepository } from '../src/supabase/repositories/offers.js';
import { PROVIDER_SERVICE_AREA_RADII, readProviderServiceArea, renderProviderServiceArea } from '../src/provider/provider-service-area.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));

describe('Provider service area',()=>{
  it('renders the 20 km default and only the five allowed choices',()=>{
    const dom=new JSDOM(renderProviderServiceArea(null));
    const document=dom.window.document;
    assert.match(document.body.textContent,/Zone d’intervention/);
    assert.match(document.body.textContent,/Rayon maximum : 20 km/);
    assert.deepEqual([...document.querySelectorAll('[data-service-area-radius]')].map(input=>Number(input.value)),PROVIDER_SERVICE_AREA_RADII);
    assert.equal(document.querySelector('[data-service-area-radius][value="20"]').checked,true);
    dom.window.close();
  });

  it('accepts and reads every allowed radius',()=>{
    for(const radius of PROVIDER_SERVICE_AREA_RADII){
      const dom=new JSDOM(renderProviderServiceArea({serviceRadiusKm:radius}));
      assert.deepEqual(readProviderServiceArea(dom.window.document),{valid:true,serviceRadiusKm:radius});
      dom.window.close();
    }
  });

  it('saves the chosen radius from the Provider profile',async()=>{
    const dom=new JSDOM('<div id="provider-root"></div>',{pretendToBeVisual:true});
    const root=dom.window.document.querySelector('#provider-root');
    const repository=createMockProviderAppRepository({provider:{id:'p1',name:'Provider Test',serviceRadiusKm:20},status:{online:true,available:true},offers:[],assignment:null,services:[]});
    const app=await initialiseProviderApp(root,async()=>repository,async()=>null,{enabled:false,getSession:async()=>null},()=>({sync(){},stop(){}}));
    try{
      root.querySelector('[data-provider-view="profile"]').click();await tick();await tick();
      assert.match(root.textContent,/Xác minh danh tính/);
      assert.match(root.textContent,/Đã xác minh/);
      root.querySelector('[data-service-area-radius][value="50"]').click();
      root.querySelector('[data-save-service-area]').click();await tick();await tick();await tick();
      assert.match(root.textContent,/Rayon maximum : 50 km/);
      assert.match(root.textContent,/Đã lưu khu vực hoạt động/);
    }finally{app.stop();dom.window.close();}
  });

  it('uses authenticated self-scoped RPCs without a provider id from the browser',async()=>{
    const calls=[];
    const client={from(){return{};},rpc:async(name,args)=>{calls.push([name,args]);return {data:{service_radius_km:name.startsWith('set_')?30:20},error:null};}};
    const repository=createSupabaseOffersRepository(client);
    assert.deepEqual(await repository.getCurrentProviderServiceArea(),{serviceRadiusKm:20});
    assert.deepEqual(await repository.setCurrentProviderServiceArea(30),{serviceRadiusKm:30});
    assert.deepEqual(calls,[['get_current_provider_service_area',undefined],['set_current_provider_service_area',{new_service_radius_km:30}]]);
    assert.equal(calls.some(([,args])=>args&&('provider_id' in args||'user_id' in args)),false);
  });

  it('keeps matching GPS-centred, recent and radius constrained on both server paths',async()=>{
    const [migration,matching,dispatch]=await Promise.all([
      readFile(new URL('../supabase/migrations/20260911002715_provider_service_area.sql',import.meta.url),'utf8'),
      readFile(new URL('../supabase/migrations/20260901000500_provider_matching_and_offers.sql',import.meta.url),'utf8'),
      readFile(new URL('../supabase/migrations/20260903001000_realtime_provider_dispatch.sql',import.meta.url),'utf8'),
    ]);
    assert.match(migration,/alter column service_radius_km set default 20/);
    assert.match(migration,/array\[5,10,20,30,50\]/);
    assert.match(migration,/where provider_id = uid/);
    assert.doesNotMatch(migration,/address|reference_(latitude|longitude)|update public\.missions/);
    for(const sql of [matching,dispatch]){
      assert.match(sql,/pst\.last_latitude/);
      assert.match(sql,/pst\.last_longitude/);
      assert.match(sql,/pst\.last_location_at/);
      assert.match(sql,/distance_km <=/);
      assert.match(sql,/service_radius_km/);
    }
  });
});
