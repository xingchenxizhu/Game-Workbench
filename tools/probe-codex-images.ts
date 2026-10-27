import {CodexRpc} from '../lib/codex-rpc.js';
import {spawnSync} from 'node:child_process';
const found=spawnSync('where.exe',['codex.exe'],{encoding:'utf8',windowsHide:true}).stdout.trim().split(/\r?\n/)[0];
if(!found)throw Error('没有找到 Codex');
const rpc=new CodexRpc(found,process.cwd());
try{await rpc.initialize();const capability=await rpc.request('modelProvider/capabilities/read'),account=await rpc.request('account/read',{refreshToken:false});console.log(JSON.stringify({connected:true,imageGeneration:capability.imageGeneration,chatgptLogin:account.account?.type==='chatgpt'}));}finally{rpc.close();}
