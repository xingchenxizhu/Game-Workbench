import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const base='http://127.0.0.1:4173';
async function rpc(method,payload){const value=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,payload})}).then(x=>x.json());if(!value.ok)throw Error(JSON.stringify(value));return value.value;}
let {projects}=await rpc('listMapProjects');let demo=projects.find(x=>x.name==='示例地图 · 本地编辑');
if(!demo)demo=await rpc('createMapProject',{name:'示例地图 · 本地编辑',cols:16,rows:12});
const view=await rpc('getMapProject',{projectId:demo.id});
if(!view.tilesets.length)await rpc('importSampleTileset',{projectId:demo.id});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(base); const frame=page.frameLocator('#workspace');
 await frame.getByRole('button',{name:/地图编辑器/}).first().click();await page.waitForTimeout(1800);
 console.log('地图初始页面',await frame.locator('body').innerText());
 await frame.locator('canvas').first().waitFor({state:'visible',timeout:20000});
 await page.waitForTimeout(1000);
 if((await frame.locator('body').innerText()).includes('素材图加载失败'))throw Error('地图素材图加载失败');
 if(!await frame.locator('[data-tool="pen"]').count())throw Error('地图画笔未显示');
 await frame.locator('.SPR_mapEdTile').first().click();
 const canvas=frame.locator('canvas').first();const bounds=await canvas.boundingBox();
 for(let row=1;row<9;row++){
   await page.mouse.move(bounds.x+40,bounds.y+row*32+12);await page.mouse.down();
   await page.mouse.move(bounds.x+350,bounds.y+row*32+12,{steps:20});await page.mouse.up();
 }
 await page.waitForTimeout(600);
 if(!(await rpc('getMapProject',{projectId:demo.id})).filled)throw Error('浏览器落笔没有保存到地图');
 await page.screenshot({path:'test-results/map-functional.png',fullPage:true});
 console.log('地图画布',bounds,'画笔',await frame.locator('[data-tool="pen"]').count());
 await page.getByRole('button',{name:'素材工作室',exact:true}).click();
 await frame.getByRole('button',{name:/图片生成/}).first().click();await page.waitForTimeout(800);
 const image=frame.getByRole('button').filter({hasText:'ChatGPT 技能验收 · 草地地块'}).first();await image.click();
 await frame.locator('img').first().waitFor({state:'visible'});await page.waitForTimeout(600);
 const decoded=await frame.locator('img').evaluateAll(images=>images.filter(x=>x.complete && x.naturalWidth>0).length);
 if(!decoded)throw Error('真实生图未在浏览器中解码');
 await frame.locator('img').first().scrollIntoViewIfNeeded();
 await page.screenshot({path:'test-results/image-functional.png',fullPage:true});
 console.log('真实生图页面', (await frame.locator('body').innerText()).slice(-900));
 await page.getByRole('button',{name:'⚙ 设置'}).click();await frame.getByText('生图后端',{exact:true}).first().waitFor({state:'visible',timeout:30000});
 await page.screenshot({path:'test-results/settings.png',fullPage:true});
 await writeFile('test-results/functional-errors.json',JSON.stringify(errors,null,2));if(errors.length)throw Error(errors.join('\n'));
 console.log('功能浏览器验证通过');
}finally{await browser.close();}
