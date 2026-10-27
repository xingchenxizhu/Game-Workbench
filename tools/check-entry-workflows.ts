import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { rigFixtures,tileFixture } from './local-asset-fixtures.ts';
const base='http://127.0.0.1:14178',dir=await mkdtemp(join(tmpdir(),'entry-workflow-'));
const child=spawn(process.execPath,['lib/standalone.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,WORKBENCH_DATA:dir,WORKBENCH_PORT:'14178'},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
child.on('exit',(code,signal)=>{output+=`\nserver-exit: ${code} ${signal}\n`;});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let browser,page;
// RPC is read-only in this browser acceptance. All creation and processing use UI controls.
async function read(method,payload){assert.ok(['getRigJob','listRigJobs','getTileProject','listTileProjects'].includes(method));const v=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,payload})}).then(r=>r.json());if(!v.ok)throw Error(JSON.stringify(v));return v.value;}
async function until(fn){for(let i=0;i<400;i++){const result=await fn();if(result)return result;await pause(100);}throw Error('等待界面操作结果超时');}
try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health').then(r=>r.json())).ok)break;}catch{}await pause(100);if(i===99)throw Error(output);}
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  page=await browser.newPage({viewport:{width:780,height:1050},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/#/tool/rig');let frame=page.frameLocator('.frame-wrap[data-tool=rig] iframe');
  const rigForm=frame.getByTestId('rig-start-form');await rigForm.waitFor();
  assert.equal(await frame.getByRole('dialog').count(),0);assert.ok(!(await frame.locator('body').innerText()).includes('仍在开发中'));
  await page.screenshot({path:'test-results/entry-rig-empty-narrow.png'});
  const fixture=rigFixtures();await rigForm.locator('[name=name]').fill('窄窗口角色流程');
  await rigForm.locator('[name=reference]').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:fixture.source});
  await rigForm.locator('[name=parts]').setInputFiles(fixture.parts.map(p=>({name:p.name+'.png',mimeType:'image/png',buffer:p.png})));
  await rigForm.getByRole('button',{name:'创建并导入角色',exact:true}).click();
  const rig=await until(async()=>{const {jobs}=await read('listRigJobs');const found=jobs.find(j=>j.name==='窄窗口角色流程');if(!found)return false;const state=await read('getRigJob',{jobId:found.id});return state.parts.length===6&&!state.busy?state:false;});
  const jobId=rig.id;await frame.getByRole('button').filter({hasText:'② 装配定位'}).first().click();
  await frame.getByRole('button',{name:'重新装配全部部件',exact:true}).click();
  let healthDuringLayoutMs;
  await until(async()=>{const state=await read('getRigJob',{jobId});if(state.layout.status==='error')throw Error(state.layout.error);
    if(state.layout.status==='running'&&healthDuringLayoutMs===undefined){const start=Date.now();const health=await fetch(base+'/api/health',{signal:AbortSignal.timeout(1500)}).then(r=>r.json());assert.equal(health.ok,true);healthDuringLayoutMs=Date.now()-start;}
    return state.layout.status==='ready'&&!state.busy;});
  assert.ok(healthDuringLayoutMs!==undefined,'必须在实际装配计算期间验证HTTP响应');
  await frame.getByRole('button').filter({hasText:'③ 骨骼与动画'}).first().click();
  await frame.getByRole('button',{name:'生成骨骼与动画',exact:true}).click();
  await until(async()=>{const state=await read('getRigJob',{jobId});if(state.rig.status==='error')throw Error(state.rig.error);return state.rig.status==='ready'&&!state.busy;});
  const preview=frame.frameLocator('iframe[title="骨骼动画预览"]');await preview.locator('canvas').waitFor({timeout:15000});
  await page.screenshot({path:'test-results/entry-rig-preview-narrow.png'});
  await frame.getByRole('button').filter({hasText:'④ 图集'}).first().click();await frame.getByRole('button',{name:'打包纹理图集',exact:true}).click();
  await until(async()=>{const state=await read('getRigJob',{jobId});if(state.atlas.status==='error')throw Error(state.atlas.error);return state.atlas.status==='ready'&&!state.busy;});
  let download=page.waitForEvent('download');await frame.getByRole('button',{name:'下载完整骨骼 ZIP',exact:true}).click();await (await download).saveAs('test-results/entry-rig-ui.zip');
  await page.goto(base+'/#/tool/tile');frame=page.frameLocator('.frame-wrap[data-tool=tile] iframe');const tileForm=frame.getByTestId('tile-start-form');await tileForm.waitFor();
  assert.equal(await frame.getByRole('dialog').count(),0);assert.ok(!(await frame.locator('body').innerText()).includes('仍在开发中'));
  await page.screenshot({path:'test-results/entry-tile-empty-narrow.png'});
  await tileForm.locator('[name=name]').fill('窄窗口地图流程');await tileForm.locator('[name=terrain]').setInputFiles({name:'terrain.png',mimeType:'image/png',buffer:tileFixture()});
  await tileForm.getByRole('button',{name:'创建并导入地形',exact:true}).click();
  const tile=await until(async()=>{const {projects}=await read('listTileProjects');const found=projects.find(p=>p.name==='窄窗口地图流程');if(!found)return false;const state=await read('getTileProject',{projectId:found.id});return state.items.length===1&&state.items[0].variants[0]?.cell?state:false;});
  const projectId=tile.id;await frame.locator('.SPR_steps button').nth(2).click();await frame.getByRole('button',{name:'铺成地图（免费）',exact:true}).click();
  await until(async()=>{const state=await read('getTileProject',{projectId});if(state.stages.map.status==='error')throw Error(state.job?.error);return state.stages.map.status==='done'&&!state.job?.running;});
  await frame.locator('.SPR_steps button').nth(3).click();await frame.getByRole('button',{name:'导出到 export/',exact:true}).click();
  await until(async()=>!!(await read('getTileProject',{projectId})).bundleUrl);await frame.getByTestId('tile-bundle-download').waitFor({timeout:15000});
  download=page.waitForEvent('download');await frame.getByTestId('tile-bundle-download').click();await (await download).saveAs('test-results/entry-tile-ui.zip');
  await page.screenshot({path:'test-results/entry-tile-download-narrow.png'});assert.equal(errors.length,0,errors.join('\n'));
  await writeFile('test-results/entry-workflows.json',JSON.stringify({ok:true,viewport:[780,1050],emptyDataStart:true,allMutationsFromUI:true,noBlockingDialogs:true,healthDuringLayoutMs,rigCreatedImportedAssembledAnimatedDownloaded:true,tileCreatedImportedAssembledDownloaded:true,errors},null,2));
  console.log('从空数据开始，780px窗口内通过界面完成角色导入/装配/动画/ZIP和地形导入/铺图/ZIP。');
}catch(error){if(page){await page.screenshot({path:'test-results/entry-workflows-failure.png'});await writeFile('test-results/entry-workflows-failure.txt',await page.frameLocator('.view-frame .frame-wrap iframe').locator('body').innerText());}await writeFile('test-results/entry-workflows-server.log',output);throw error;}
finally{if(browser)await browser.close();const closed=once(child,'exit');child.kill();await closed;await rm(dir,{recursive:true,force:true});}

