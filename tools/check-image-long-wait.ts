import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateCustomImage } from '../modules/material/lib/customimage.js';
const dir=await mkdtemp(join(tmpdir(),'workbench-long-wait-'));
const base='http://127.0.0.1:14174',delayMs=310000;
const child=spawn(process.execPath,['lib/standalone.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,WORKBENCH_PORT:'14174',WORKBENCH_DATA:dir,WORKBENCH_HEARTBEAT_MS:'15000'},stdio:['ignore','pipe','pipe']});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let serverOutput='',completionTimer,poller;
child.stdout.on('data',x=>serverOutput+=x);child.stderr.on('data',x=>serverOutput+=x);
try{
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(base+'/api/health').then(x=>x.json())).ok;if(ready)break;}catch{}await pause(100);}
  if(!ready)throw Error('测试服务未启动 '+serverOutput);
  const image=await readFile(new URL('../assets/samples/test-grid.png',import.meta.url));
  const start=Date.now();console.log('开始真实客户端长等待回归：生产保活间隔15秒，延迟回填310秒，不调用任何生图平台。');
  let taskId;
  const completion=new Promise((resolve,reject)=>{
    poller=setInterval(async()=>{try{
      if(taskId)return;
      const tasks=await fetch(base+'/api/chatgpt/tasks').then(x=>x.json());const task=tasks.find(x=>x.status==='waiting');
      if(!task)return;taskId=task.id;clearInterval(poller);
      console.log('任务已入队，保持原生图客户端连接，等待超过默认5分钟。');
      completionTimer=setTimeout(async()=>{try{
        const response=await fetch(`${base}/api/chatgpt/tasks/${taskId}/complete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:image.toString('base64')})});
        if(!response.ok)throw Error('回填失败 '+response.status);resolve();
      }catch(e){reject(e);}},Math.max(0,delayMs-(Date.now()-start)));
    }catch(e){reject(e);}},100);
  });
  const generated=generateCustomImage({protocol:'openai',baseUrl:base+'/api/chatgpt/v1',apiKey:'',model:'chatgpt-imagegen-skill',prompt:'等待超过5分钟的回归测试，不生成新图片',images:[],size:'1024x1024',timeoutMs:360000,negativePrompt:'',steps:20,cfgScale:7,sampler:'',denoising:0.5,seed:-1,workflow:''});
  const [result]=await Promise.all([generated,completion]);
  if(!result.bytes.equals(image))throw Error('回填图片字节不一致');
  const evidence={ok:true,elapsedMs:Date.now()-start,delayMs,heartbeatMs:15000,bytes:result.bytes.length,ext:result.ext,client:'原 generateCustomImage → Node fetch → 本地生图桥',externalGeneration:false};
  await writeFile(new URL('../test-results/image-long-wait.json',import.meta.url),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{clearInterval(poller);clearTimeout(completionTimer);const closed=once(child,'exit');child.kill();await closed;await rm(dir,{recursive:true,force:true});}
