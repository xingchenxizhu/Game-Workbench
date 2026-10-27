import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto('http://127.0.0.1:14174');
  let frame=page.frameLocator('#workspace');
  await frame.locator('#skill-notice').waitFor({state:'visible',timeout:10000});
  assert.match(await frame.locator('#skill-notice').innerText(),/等待 ChatGPT 技能执行/);
  await page.screenshot({path:'test-results/image-wait-notice.png'});
  await frame.getByRole('button',{name:'查看生图任务'}).click();
  await frame.getByRole('heading',{name:'ChatGPT 生图',exact:true}).waitFor();
  assert.ok((await frame.locator('#tasks').innerText()).includes('等待超过5分钟的回归测试'));
  await page.goto('http://127.0.0.1:4173');frame=page.frameLocator('#workspace');
  await frame.getByRole('button',{name:/图片生成/}).first().click();
  await frame.getByRole('button').filter({hasText:'ChatGPT 技能验收 · 草地地块'}).first().click();
  const image=frame.locator('img').first();await image.waitFor({state:'visible'});
  await image.evaluate(img=>img.decode());await image.scrollIntoViewIfNeeded();
  assert.deepEqual(await image.evaluate(img=>[img.naturalWidth,img.naturalHeight]),[1024,1536]);
  assert.equal(await frame.locator('.SPR_error:visible').count(),0);
  await page.screenshot({path:'test-results/recovered-character.png'});
  const rpc=await fetch('http://127.0.0.1:4173/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'getImageJob',payload:{jobId:'imvmiimxhc300ec'}})}).then(x=>x.json());
  assert.equal(rpc.value.items[0].status,'ready');assert.equal(rpc.value.items[0].error,undefined);
  assert.equal(errors.length,0);
  await writeFile('test-results/image-fix-browser.json',JSON.stringify({ok:true,waitingNotice:true,queueNavigation:true,imageDecoded:[1024,1536],item:rpc.value.items[0],errors},null,2));
  console.log('等待提示、任务页跳转、原任务恢复和角色图浏览器解码检查通过');
}finally{await browser.close();}
