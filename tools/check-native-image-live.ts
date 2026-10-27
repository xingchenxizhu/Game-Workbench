/** One real native ChatGPT image. Explicit live test, never part of npm test. */
import {join} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {ImageBridge} from '../lib/bridge.js';
import {autoGenerateTask,detectCodex} from '../lib/native-image.js';
const root=join(process.cwd(),'test-results','native-image-live'),bridge=new ImageBridge(join(root,'tasks'));
await mkdir(root,{recursive:true});
const task=await bridge.create({prompt:'一枚可用于奇幻游戏背包的魔力药水图标：圆形小玻璃瓶，蓝紫色发光液体，软木瓶塞，小金属星形挂饰。干净的手绘游戏图标风格，完整居中，轮廓清楚，柔和高光。单件物品，透明背景，无文字、无水印、无边框。',size:'1024x1024',transparent:true,source:'native-image-live-acceptance'});
const result=await autoGenerateTask({bridge,assetsDir:()=>join(root,'assets'),timeoutSec:1200,onStage:s=>console.log(JSON.stringify({taskId:s.taskId,stage:s.stage}))},task,detectCodex());
await writeFile(join(root,'report.json'),JSON.stringify({ok:true,nativeChatGPT:true,automaticBackfill:(await bridge.get(task.id)).status==='completed',...result},null,2));console.log(JSON.stringify(result));
