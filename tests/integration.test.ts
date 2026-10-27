import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ImageBridge } from '../lib/bridge.js';
const port=14173, base=`http://127.0.0.1:${port}`;let child,dir;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function api(path,payload){const r=await fetch(base+path,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});return {status:r.status,body:await r.json()};}
const rpc=(method,payload)=>api('/api/rpc',{method,payload});
before(async()=>{
  dir=await mkdtemp(join(tmpdir(),'game-workbench-test-'));
  child=spawn(process.execPath,['lib/standalone.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,WORKBENCH_PORT:String(port),WORKBENCH_DATA:dir,WORKBENCH_HEARTBEAT_MS:'50'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
  for(let i=0;i<100;i++){try{if((await api('/api/health')).body.ok)return;}catch{}await pause(100);}
  throw Error('服务未启动 '+output);
});
after(async()=>{if(child){const closed=once(child,'exit');child.kill();await closed;}if(dir)await rm(dir,{recursive:true,force:true});});
test('完整宿主、静态依赖和边界检查',async()=>{
  assert.ok((await api('/api/health')).body.methods>=176);
  for(const path of ['/','/material.html','/vendor/react.js','/vendor/react-dom.js','/vendor/jszip.js','/material-client.js','/mapstitch'])assert.equal((await fetch(base+path)).status,200,path);
  assert.equal((await fetch(base+'/data/dsh/game-material-master/config.json')).status,404);
  assert.equal((await fetch(base+'/api/chatgpt/tasks',{method:'POST',headers:{origin:'https://example.com','Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await rpc('constructor',{})).status,404);
  assert.equal((await rpc('getMapProject',{projectId:'../../secrets'})).status,400);
});
test('素材项目 CRUD 与地图绘制、撤销、导出',async()=>{
  const created=await rpc('createProject',{name:'回归角色'});assert.equal(created.body.ok,true,JSON.stringify(created.body));
  const id=created.body.value.projectId;assert.ok(id);
  const loaded=await rpc('getProject',{projectId:id});assert.equal(loaded.body.value.name,'回归角色');
  await rpc('renameProject',{projectId:id,name:'改名角色'});assert.equal((await rpc('getProject',{projectId:id})).body.value.name,'改名角色');
  assert.equal((await rpc('deleteProject',{projectId:id})).body.ok,true);
  const map=await rpc('createMapProject',{name:'回归地图',cols:12,rows:12,grid:{tileWidth:32,tileHeight:32}});assert.equal(map.body.ok,true,JSON.stringify(map.body));
  assert.ok(map.body.value.id);
  const result=await rpc('getMapProject',{projectId:map.body.value.id});assert.equal(result.body.ok,true);
  const projectId=map.body.value.id;
  await rpc('reportClientOrigin',{origin:base,path:'/material.html'});
  assert.ok((await rpc('getMapProject',{projectId})).body.value.assetBase.startsWith('/dsh-game-material-master/'));
  assert.equal((await rpc('importSampleTileset',{projectId})).body.ok,true);
  const view=(await rpc('getMapProject',{projectId})).body.value;
  const layerId=view.layers[0].id;
  const paint=(await rpc('applyMapOps',{projectId,ops:[{kind:'paint',layerId,cells:[{r:2,c:2,tile:1}]}]})).body;
  assert.equal(paint.value.changed,1);assert.equal(paint.value.canUndo,true);
  assert.equal((await rpc('mapUndo',{projectId})).body.value.canRedo,true);
  assert.equal((await rpc('mapRedo',{projectId})).body.value.canUndo,true);
  assert.equal((await rpc('runMapExport',{projectId,formats:{png:true,json:true,tilesets:true,zip:true}})).body.value.started,true);
  let exported;
  for(let i=0;i<200;i++){exported=(await rpc('getMapProject',{projectId})).body.value;if(exported.exportFiles?.some(x=>(typeof x==='string'?x:x.file || x.name || '').endsWith('.zip')))break;await pause(50);}
  const zipFile=exported.exportFiles?.find(x=>(typeof x==='string'?x:x.file || x.name || '').endsWith('.zip'));
  assert.ok(zipFile,JSON.stringify(exported).slice(-600));
  const filename=typeof zipFile==='string'?zipFile:zipFile.file || zipFile.name;
  const archive=await fetch(new URL(exported.assetBase+exported.exportBase+filename,base));assert.equal(archive.status,200);
  const zip=Buffer.from(await archive.arrayBuffer());assert.equal(zip.toString('ascii',0,2),'PK');
});
test('ChatGPT 参考图任务、等待调用、回填以及结果持久化',async()=>{
  const {encodePng}=await import('../modules/material/lib/png.js');
  const image=encodePng(Buffer.from([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]),2,2);
  const pending=api('/api/chatgpt/v1/images/generations',{prompt:'测试专用素材，不调用生图服务',size:'1024x1024',image:'data:image/png;base64,'+image.toString('base64')});
  let task;for(let i=0;i<50;i++){task=(await api('/api/chatgpt/tasks')).body.find(x=>x.status==='waiting');if(task)break;await pause(50);}
  assert.ok(task);assert.equal(task.references.length,1);
  assert.equal((await fetch(base+`/api/chatgpt/tasks/${task.id}/reference-1.png`)).status,200);
  assert.equal((await api(`/api/chatgpt/tasks/${task.id}/complete`,{data:Buffer.from('<html>error</html>').toString('base64')})).status,400);
  const completed=await api(`/api/chatgpt/tasks/${task.id}/complete`,{data:image.toString('base64')});assert.equal(completed.body.status,'completed');
  assert.equal((await pending).body.data[0].b64_json,image.toString('base64'));
  assert.equal((await fetch(base+`/api/chatgpt/tasks/${task.id}/result.png`)).status,200);
  assert.equal((await api(`/api/chatgpt/tasks/${task.id}/complete`,{data:image.toString('base64')})).status,400);
});
test('生图等待连接立即返回响应头并持续保活，延迟回填仍可解析',async()=>{
  const controller=new AbortController();
  const request=fetch(base+'/api/chatgpt/v1/images/generations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'等待连接回归测试'}),signal:controller.signal});
  let timer;
  try{
    const response=await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('等待生图时没有及时发送响应头，会触发客户端 headersTimeout')),700);})]);
    clearTimeout(timer);
    const reader=response.body.getReader();
    const first=await reader.read();assert.equal(Buffer.from(first.value).toString().trim(),'');
    let heartbeatTimer;
    const heartbeat=await Promise.race([reader.read(),new Promise((_,reject)=>{heartbeatTimer=setTimeout(()=>reject(Error('等待生图时没有保活数据')),300);})]);
    clearTimeout(heartbeatTimer);assert.equal(Buffer.from(heartbeat.value).toString().trim(),'');
    const task=(await api('/api/chatgpt/tasks')).body.find(x=>x.prompt==='等待连接回归测试');
    const image=await readFile(new URL('../assets/samples/chatgpt-grass.png',import.meta.url));
    await api(`/api/chatgpt/tasks/${task.id}/complete`,{data:image.toString('base64')});
    let content=Buffer.concat([Buffer.from(first.value),Buffer.from(heartbeat.value)]).toString();
    for(;;){const part=await reader.read();if(part.done)break;content+=Buffer.from(part.value).toString();}
    assert.equal(JSON.parse(content).data[0].b64_json,image.toString('base64'));
  }finally{clearTimeout(timer);controller.abort();await request.catch(()=>{});}
});
test('取消、恢复与非法参考图校验',async()=>{
  assert.equal((await api('/api/chatgpt/tasks',{prompt:'bad',images:['file:///c:/secret']})).status,400);
  const task=(await api('/api/chatgpt/tasks',{prompt:'取消测试'})).body;
  assert.equal((await api(`/api/chatgpt/tasks/${task.id}/cancel`,{})).body.status,'cancelled');
  const bridge=new ImageBridge(join(dir,'recovery'));const created=await bridge.create({prompt:'恢复测试'});
  await bridge.recover();assert.equal((await bridge.get(created.id)).status,'interrupted');
});
test('等待任务取消后，真实生图客户端显示ChatGPT任务原因',async()=>{
  const {generateCustomImage}=await import('../modules/material/lib/customimage.js');
  const result=generateCustomImage({protocol:'openai',baseUrl:base+'/api/chatgpt/v1',apiKey:'',model:'chatgpt-imagegen-skill',prompt:'客户端取消原因回归',images:[],size:'1024x1024',timeoutMs:10000,negativePrompt:'',steps:20,cfgScale:7,sampler:'',denoising:0.5,seed:-1,workflow:''});
  const rejected=assert.rejects(result,/ChatGPT 生图任务：用户取消了 ChatGPT 生图任务/);
  let task;for(let i=0;i<50;i++){task=(await api('/api/chatgpt/tasks')).body.find(x=>x.prompt==='客户端取消原因回归');if(task)break;await pause(50);}
  assert.ok(task);await api(`/api/chatgpt/tasks/${task.id}/cancel`,{});await rejected;
});
