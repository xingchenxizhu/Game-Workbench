import { writeFile } from 'node:fs/promises';
const jobId=process.argv[2];if(!jobId)throw Error('需要图片任务编号');
const base=`http://127.0.0.1:${process.env.WORKBENCH_PORT||4173}`;
async function rpc(method,payload){const v=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,payload})}).then(x=>x.json());if(!v.ok)throw Error(JSON.stringify(v));return v.value;}
const job=await rpc('getImageJob',{jobId});
await writeFile(new URL('../test-results/retried-image-job-before.json',import.meta.url),JSON.stringify(job,null,2));
console.log(await rpc('runImageJob',{jobId,count:1}));
for(let i=0;i<30;i++){
  const tasks=await fetch(base+'/api/chatgpt/tasks').then(x=>x.json());
  const task=tasks.find(x=>x.status==='waiting'&&x.prompt===job.prompt);
  if(task){console.log(JSON.stringify(task,null,2));break;}
  await new Promise(r=>setTimeout(r,300));
}
