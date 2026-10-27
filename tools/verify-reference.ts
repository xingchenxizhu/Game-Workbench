import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const allChecks=['host','client','tools','pipeline','feedback','i18n','comfy','custom-image','music','music-score','music-gateway','music-client','sfx','sfx-gateway','sfx-client','rig-runtime','tile','tile-gateway','tile-client','map','map-pipeline','map-gateway','map-client'];
const checks=process.argv.length>2 ? process.argv.slice(2) : allChecks;
for(const name of checks)if(!allChecks.includes(name))throw Error('未知检查 '+name);
await mkdir('test-results/reference',{recursive:true});const results=[];
for(const name of checks){
  const result=await new Promise(resolve=>{
    const child=spawn(process.execPath,['--import',new URL('block-remote.ts',import.meta.url).href,`scripts/verify-${name}.mjs`],{cwd:new URL('../modules/material/',import.meta.url),stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
    const timer=setTimeout(()=>child.kill(),120000);
    child.on('exit',code=>{clearTimeout(timer);resolve({name,code,output});});
  });
  await writeFile(`test-results/reference/${name}.log`,result.output);
  console.log(`${name}: ${result.code===0?'PASS':'FAIL'} ${result.output.trim().split('\n').slice(-1)[0]}`);
  results.push({name,code:result.code});
}
let previous=[];try{previous=JSON.parse(await readFile('test-results/reference-summary.json','utf8'));}catch{}
const merged=allChecks.map(name=>results.find(x=>x.name===name)||previous.find(x=>x.name===name)).filter(Boolean);
await writeFile('test-results/reference-summary.json',JSON.stringify(merged,null,2));
if(results.some(x=>x.code!==0))process.exitCode=1;
