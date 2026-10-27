import { chromium } from 'playwright';
import JSZip from 'jszip';
import { readFile,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1000},acceptDownloads:true});const errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
try{
 await page.goto('http://127.0.0.1:4173/mapstitch');
 await page.locator('#upload-img').setInputFiles('assets/samples/test-grid.png');
 await page.waitForFunction(()=>!document.querySelector('#btn-replace').disabled);
 await page.locator('[data-mode="col"]').click();await page.locator('#shape-select').selectOption('rect');
 await page.mouse.move(720,420);await page.mouse.down();await page.mouse.move(860,550,{steps:12});await page.mouse.up();
 await page.locator('#project-name').fill('ChatGPT 草地示例');await page.getByRole('button',{name:/保存 \/ 另存/}).click();
 await page.waitForTimeout(500);await page.screenshot({path:'test-results/mapstitch-functional.png',fullPage:true});
 const downloadEvent=page.waitForEvent('download');await page.locator('#btn-export').click();const download=await downloadEvent;
 await download.saveAs('test-results/mapstitch-export.zip');
 const zip=await JSZip.loadAsync(await readFile('test-results/mapstitch-export.zip'));
 const map=JSON.parse(await zip.file('map_data.json').async('string'));
 assert.equal(map.chunks.length,1);assert.equal(map.global_polygons.col.length,1);
 assert.ok(zip.file(map.chunks[0].background_path));assert.equal(errors.length,0);
 await writeFile('test-results/mapstitch-evidence.json',JSON.stringify({chunks:map.chunks.length,collisionPolygons:map.global_polygons.col.length,files:Object.keys(zip.files),browserErrors:errors},null,2));
 console.log('MapStitch 上传、碰撞掩码、保存、ZIP 导出及真实解包检查通过');
}finally{await browser.close();}
