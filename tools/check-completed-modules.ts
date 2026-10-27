import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { rigFixtures,tileFixture } from './local-asset-fixtures.ts';
const base='http://127.0.0.1:14177',dir=await mkdtemp(join(tmpdir(),'completed-modules-browser-'));
const child=spawn(process.execPath,['lib/standalone.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,WORKBENCH_DATA:dir,WORKBENCH_PORT:'14177'},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
const pause=ms=>new Promise(r=>setTimeout(r,ms));let browser,page;const rpcEvidence=[];
async function rpc(method,payload){const v=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,payload})}).then(r=>r.json());if(!v.ok)throw Error(JSON.stringify(v));return v.value;}
async function settle(method,payload,check){for(let i=0;i<400;i++){const state=await rpc(method,payload);if(check(state))return state;await pause(50);}throw Error('等待处理超时');}
try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health').then(x=>x.json())).ok)break;}catch{}await pause(100);if(i===99)throw Error(output);}
  const fixture=rigFixtures(),{jobId}=await rpc('createRigJob',{name:'本地骨骼功能验证（代码测试素材）'});
  await rpc('uploadRigSource',{jobId,name:'source.png',data:fixture.source.toString('base64')});
  for(const part of fixture.parts)await rpc('uploadRigPart',{jobId,name:part.name+'.png',data:part.png.toString('base64')});
  await rpc('saveRigLayoutItems',{jobId,items:fixture.parts.map(({png,...part})=>({...part,placed:true}))});
  await rpc('runRigBones',{jobId});await settle('getRigJob',{jobId},s=>!s.busy);
  await rpc('runRigAtlas',{jobId});await settle('getRigJob',{jobId},s=>!s.busy);
  const uploadJob=await rpc('createRigJob',{name:'拆件图上传界面验证'});
  await rpc('uploadRigSource',{jobId:uploadJob.jobId,name:'source.png',data:fixture.source.toString('base64')});
  await rpc('saveRigJob',{jobId:uploadJob.jobId,settings:{gridColumns:2,gridRows:2,minArea:120}});
  const tile=await rpc('createTileProject',{name:'本地地块功能验证（代码测试素材）'}),projectId=tile.id;
  await rpc('saveTileProject',{projectId,items:[{key:'grass',label:'草地',kind:'terrain',family:'grass',footprint:[1,1],content:'草地',mode:'template',variantCount:1}]});
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  page=await browser.newPage({viewport:{width:1600,height:1100},acceptDownloads:true});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',async response=>{if(response.url().endsWith('/api/rpc')){try{const method=response.request().postDataJSON()?.method;const value=await response.json();if(method?.startsWith('upload')||!value.ok)rpcEvidence.push({method,ok:value.ok,error:value.error});}catch{}}});
  async function open(module,query){await page.goto(`${base}/?dsh-gmm=1&module=${module}&${query}`);const frame=page.frameLocator('#workspace');await frame.getByTestId('module-guide-'+module).waitFor({timeout:15000});assert.equal(await frame.getByRole('dialog').count(),0);return frame;}
  let frame=await open('rig',`job=${uploadJob.jobId}&stage=parts`);
  await frame.locator('input[type=file]').nth(1).setInputFiles({name:'parts-sheet.png',mimeType:'image/png',buffer:fixture.sheet});
  await frame.locator('.SPR_notice').filter({hasText:'拆件图已导入并完成本地分割'}).waitFor({timeout:20000});
  assert.ok((await rpc('getRigJob',{jobId:uploadJob.jobId})).parts.length>=4);
  await page.screenshot({path:'test-results/rig-sheet-import.png'});
  frame=await open('rig',`job=${jobId}&stage=rig`);
  const preview=frame.frameLocator('iframe[title="骨骼动画预览"]');await preview.locator('canvas').waitFor({timeout:15000});
  await frame.locator('iframe[title="骨骼动画预览"]').scrollIntoViewIfNeeded();await pause(500);
  await page.screenshot({path:'test-results/rig-animation-preview.png'});
  await frame.getByRole('button').filter({hasText:'④ 图集'}).click();
  let downloadEvent=page.waitForEvent('download');await frame.getByRole('button',{name:'下载完整骨骼 ZIP',exact:true}).click();
  const rigDownload=await downloadEvent;await rigDownload.saveAs('test-results/completed-rig.zip');
  frame=await open('tile',`project=${projectId}`);
  const form=frame.getByTestId('tile-local-import');await form.locator('input[type=file]').setInputFiles({name:'grass.png',mimeType:'image/png',buffer:tileFixture()});
  await form.getByRole('button',{name:'导入并规整',exact:true}).click();
  await frame.locator('.SPR_notice').filter({hasText:'地块已导入并规整'}).waitFor({timeout:20000});await form.scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/tile-local-import.png'});
  await frame.locator('.SPR_steps button').nth(2).click();
  await frame.getByRole('button',{name:'铺成地图（免费）',exact:true}).click();
  let state=await settle('getTileProject',{projectId},s=>s.stages.map.status==='done'&&!s.job?.running);assert.ok(state.map.png);
  await frame.locator('.SPR_steps button').nth(3).click();await frame.getByRole('button',{name:'导出到 export/',exact:true}).click();
  state=await settle('getTileProject',{projectId},s=>!!s.bundleUrl&&!s.job?.running);
  await frame.getByTestId('tile-bundle-download').waitFor({timeout:15000});
  downloadEvent=page.waitForEvent('download');await frame.getByTestId('tile-bundle-download').click();const tileDownload=await downloadEvent;
  await tileDownload.saveAs('test-results/completed-isometric-map.zip');await page.screenshot({path:'test-results/tile-export-download.png'});
  const zip=await JSZip.loadAsync(await fetch(base+state.bundleUrl).then(r=>r.arrayBuffer()));assert.ok(zip.file('map.json'));assert.ok(zip.file('map.png'));
  assert.equal(errors.length,0,errors.join('\n'));
  await writeFile('test-results/completed-modules-browser.json',JSON.stringify({ok:true,rigSheetImport:true,rigPreview:true,rigDownload:true,tileImport:true,tileMap:true,tileDownload:true,errors,fixtures:'代码验证素材，非AI生成或生产美术'},null,2));
  console.log('骨骼拆件导入、动画预览、ZIP下载、地块导入/铺图/ZIP下载均通过真实浏览器验证');
}catch(error){if(page){await page.screenshot({path:'test-results/completed-modules-failure.png'});await writeFile('test-results/completed-modules-failure.txt',await page.frameLocator('#workspace').locator('body').innerText());await writeFile('test-results/completed-modules-rpc.json',JSON.stringify(rpcEvidence,null,2));}throw error;}
finally{if(browser)await browser.close();const closed=once(child,'exit');child.kill();await closed;await rm(dir,{recursive:true,force:true});}
