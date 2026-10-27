import { readFile } from 'node:fs/promises';
const [id,path,providedBase]=process.argv.slice(2);
if(!id || !path){console.error('用法：node tools/complete-image.ts <任务编号> <生成图片路径>');process.exit(1);}
const data=await readFile(path);
const base=(providedBase||process.env.WORKBENCH_URL||`http://127.0.0.1:${process.env.WORKBENCH_PORT||4173}`).replace(/\/$/,'');
const result=await fetch(`${base}/api/chatgpt/tasks/${encodeURIComponent(id)}/complete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:data.toString('base64')})});
const value=await result.json();if(!result.ok)throw Error(value.error?.message||'回填失败');console.log(JSON.stringify(value,null,2));
