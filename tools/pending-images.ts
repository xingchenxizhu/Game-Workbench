import { ImageBridge } from '../lib/bridge.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../data/chatgpt-images/',import.meta.url));
const bridge=new ImageBridge(root);
for(const task of await bridge.list())if(task.status==='waiting'){
  console.log(JSON.stringify({...task,directory:join(root,task.id),handoff:join(root,task.id,'交给ChatGPT生图.md')},null,2));
}
