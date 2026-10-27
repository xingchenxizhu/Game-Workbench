import { readdir,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url));
async function walk(dir,prefix=''){const out=[];for(const entry of await readdir(join(dir,prefix),{withFileTypes:true})){const relative=join(prefix,entry.name);if(entry.isDirectory())out.push(...await walk(dir,relative));else if(entry.isFile())out.push(relative);}return out;}
const records=[];
for(const [reference,target]of [['MapStitch-main','mapstitch'],['dsh-game-material-master-main','material']]){
  const source=join(root,'..','游戏插件参考文件',reference),destination=join(root,'modules',target);const files=await walk(source);const changed=[],missing=[];
  for(const file of files){const original=await readFile(join(source,file));let copy;try{copy=await readFile(join(destination,file));}catch(e){if(e.code==='ENOENT'){missing.push(file);continue;}throw e;}
    if(!original.equals(copy))changed.push({file,originalSha256:createHash('sha256').update(original).digest('hex'),replicaSha256:createHash('sha256').update(copy).digest('hex')});
  }
  records.push({reference:'../游戏插件参考文件/'+reference,destination:'modules/'+target,fileCount:files.length,missing,changed});
}
await writeFile(join(root,'docs','复刻来源清单.json'),JSON.stringify({modules:records},null,2));
for(const record of records)console.log(`${record.destination}: ${record.fileCount}个源文件，缺失${record.missing.length}，修改${record.changed.length}`);
if(records.some(x=>x.missing.length))process.exitCode=1;
