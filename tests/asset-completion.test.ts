import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import JSZip from 'jszip';
import { TextureAtlas,FakeTexture,AtlasAttachmentLoader,SkeletonJson,Skeleton,Physics } from '@esotericsoftware/spine-core';
import { rigFixtures,tileFixture } from '../tools/local-asset-fixtures.ts';
const base='http://127.0.0.1:14176';let dir,child;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function rpc(method,payload){const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,payload})});const v=await r.json();if(!v.ok)throw Error(v.error?.message||JSON.stringify(v));return v.value;}
async function settle(method,payload,check){for(let i=0;i<400;i++){const state=await rpc(method,payload);if(check(state))return state;await pause(50);}throw Error('任务等待超时');}
before(async()=>{
  dir=await mkdtemp(join(tmpdir(),'asset-completion-'));
  child=spawn(process.execPath,['lib/standalone.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,WORKBENCH_DATA:dir,WORKBENCH_PORT:'14176'},stdio:['ignore','pipe','pipe']});
  let out='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>out+=x);
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health').then(x=>x.json())).ok)return;}catch{}await pause(100);}throw Error(out);
});
after(async()=>{if(child){const closed=once(child,'exit');child.kill();await closed;}if(dir)await rm(dir,{recursive:true,force:true});});
test('本地拆件图可以导入、分割，错误输入不覆盖当前拆件图',async()=>{
  const {jobId}=await rpc('createRigJob',{name:'拆件导入回归'});
  const fixture=rigFixtures();await rpc('uploadRigSource',{jobId,name:'source.png',data:fixture.source.toString('base64')});
  await rpc('saveRigJob',{jobId,settings:{gridColumns:2,gridRows:2,minArea:120}});
  const result=await rpc('uploadRigSheet',{jobId,name:'sheet.png',data:fixture.sheet.toString('base64')});assert.ok(result.parts>=4,JSON.stringify(result));
  const before=await rpc('getRigJob',{jobId});assert.equal(before.sheet.status,'ready');
  await assert.rejects(rpc('uploadRigSheet',{jobId,data:Buffer.from('not image').toString('base64')}),/无法识别/);
  assert.equal((await rpc('getRigJob',{jobId})).sheet.file,before.sheet.file);
});
test('骨架与全部图集打包，官方Spine运行时可以读取ZIP中的实际文件',async()=>{
  const {jobId}=await rpc('createRigJob',{name:'骨骼完整包回归'});const fixture=rigFixtures();
  await assert.rejects(rpc('exportRigBundle',{jobId}),/先完成/);
  await rpc('uploadRigSource',{jobId,name:'source.png',data:fixture.source.toString('base64')});
  for(const part of fixture.parts)await rpc('uploadRigPart',{jobId,name:part.name+'.png',data:part.png.toString('base64')});
  await rpc('saveRigLayoutItems',{jobId,items:fixture.parts.map(({png,...part})=>({...part,placed:true}))});
  await rpc('runRigBones',{jobId});let state=await settle('getRigJob',{jobId},s=>!s.busy);assert.equal(state.rig.status,'ready',JSON.stringify(state.rig));
  await rpc('runRigAtlas',{jobId});state=await settle('getRigJob',{jobId},s=>!s.busy);assert.equal(state.atlas.status,'ready',JSON.stringify(state.atlas));
  const output=await rpc('exportRigBundle',{jobId});const response=await fetch(base+output.url);assert.equal(response.status,200);
  const bytes=Buffer.from(await response.arrayBuffer());const zip=await JSZip.loadAsync(bytes);
  const spine=JSON.parse(await zip.file('spine/skeleton.json').async('string'));
  const atlas=new TextureAtlas(await zip.file('spine/skeleton.atlas').async('string'));
  for(const page of atlas.pages){assert.ok(zip.file('spine/'+page.name),page.name);page.setTexture(new FakeTexture({width:page.width,height:page.height}));}
  const data=new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(spine);
  const skeleton=new Skeleton(data);skeleton.updateWorldTransform(Physics.none);assert.ok(data.animations.length>=1);
  assert.ok(zip.file('preview.html'));assert.ok(zip.file('dragonbones/skeleton_ske.json'));assert.ok(zip.file('dragonbones/skeleton_tex.json'));
  const again=await rpc('exportRigBundle',{jobId});assert.deepEqual(Buffer.from(await fetch(base+again.url).then(r=>r.arrayBuffer())),bytes);
  await rpc('saveRigLayoutItems',{jobId,items:[{name:'head',x:130}]});await assert.rejects(rpc('exportRigBundle',{jobId}),/先完成/);
});
test('本地地块导入复用规整、铺图和ZIP导出，替换时作废地图且保留旧文件',async()=>{
  const project=await rpc('createTileProject',{name:'地块完整包回归'}),projectId=project.id;
  await rpc('saveTileProject',{projectId,items:[{key:'grass',label:'草地',kind:'terrain',family:'grass',footprint:[1,1],content:'草地',mode:'template',variantCount:2}]});
  const raw=tileFixture().toString('base64');
  await assert.rejects(rpc('importTileVariant',{projectId,key:'grass',variant:2,data:raw}),/超出范围/);
  const first=await rpc('importTileVariant',{projectId,key:'grass',variant:1,data:raw,name:'grass.png'});assert.ok(first.variant.cell);
  let view=await rpc('getTileProject',{projectId});assert.equal(view.stages.generate.status,'idle');
  await rpc('importTileVariant',{projectId,key:'grass',variant:0,data:raw,name:'grass.png'});
  await rpc('runTileMap',{projectId,rows:4,cols:4,fill:'grass',seed:123,decorDensity:0});
  view=await settle('getTileProject',{projectId},s=>!s.job?.running);assert.equal(view.stages.map.status,'done',JSON.stringify(view.job));
  await rpc('runTileExport',{projectId});view=await settle('getTileProject',{projectId},s=>!s.job?.running);assert.ok(view.bundleUrl,JSON.stringify(view.job));
  const zip=await JSZip.loadAsync(await fetch(base+view.bundleUrl).then(r=>r.arrayBuffer()));
  const map=JSON.parse(await zip.file('map.json').async('string'));assert.equal(map.assets.length,2);
  for(const entry of map.assets)assert.ok(zip.file(entry.path));assert.ok(zip.file('map.png'));assert.ok(zip.file('manifest.json'));
  await assert.rejects(rpc('importTileVariant',{projectId,key:'grass',variant:1,data:Buffer.from('bad').toString('base64')}),/有效图片/);
  assert.equal((await rpc('getTileProject',{projectId})).bundleUrl,view.bundleUrl);
  const replacement=await rpc('importTileVariant',{projectId,key:'grass',variant:1,data:raw});assert.notEqual(replacement.variant.cell,first.variant.cell);
  view=await rpc('getTileProject',{projectId});assert.equal(view.bundleUrl,undefined);assert.equal(view.stages.map.status,'idle');
  assert.equal((await fetch(base+view.assetBase+first.variant.cell)).status,200);
});
