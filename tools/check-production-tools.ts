/** Real browser acceptance of newly added production tools. No paid generation. */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { readPsd, initializeCanvas } from 'ag-psd';
initializeCanvas(() => { throw new Error('PSD 验收应使用原始像素，无需 Node Canvas'); }, (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) } as any));
import { encodePng } from '../modules/material/lib/png.js';
import { ffprobePath } from '../modules/material/lib/media.js';
const root = await mkdtemp(join(tmpdir(), 'gw-production-ui-')), base = 'http://127.0.0.1:14181';
const child = spawn(process.execPath, ['lib/standalone.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, WORKBENCH_DATA: root, WORKBENCH_PORT: '14181' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', browser, page;
child.stdout.on('data', x => output += x);
child.stderr.on('data', x => output += x);
const pause = ms => new Promise(r => setTimeout(r, ms));
const rgba = Buffer.alloc(64 * 32 * 4), colors = [[255, 32, 32], [32, 255, 32], [32, 32, 255], [255, 255, 32], [255, 32, 255], [32, 255, 255], [220, 120, 30], [180, 120, 220]];
for (let y = 0; y < 32; y++)
    for (let x = 0; x < 64; x++) {
        if (x % 16 < 2 || x % 16 > 13 || y % 16 < 2 || y % 16 > 13)
            continue;
        const i = (y * 64 + x) * 4, c = colors[Math.floor(y / 16) * 4 + Math.floor(x / 16)];
        rgba.set([...c, 255], i);
    }
const sheet = encodePng(rgba, 64, 32), small = encodePng(Buffer.from(Array(16 * 16).fill([40, 100, 240, 255]).flat()), 16, 16);
try {
    await mkdir('test-results', { recursive: true });
    for (let i = 0; i < 120; i++) {
        try {
            if ((await fetch(base + '/api/health').then(r => r.json())).ok)
                break;
        }
        catch { }
        if (i === 119)
            throw Error(output);
        await pause(100);
    }
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const route = async (id) => { await page.evaluate(id => location.hash = '/tool/' + id, id); await page.locator(['image', 'sprite', 'rig', 'sequence', 'map', 'tile', 'music', 'sfx', 'stitch'].includes(id) ? '#frame-view' : '#tool-body').waitFor(); };
    const dl = async (name, file) => { const result = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); const item = await result; await item.saveAs('test-results/' + file); return await readFile('test-results/' + file); };
    await page.goto(base + '/#/tool/sprites');
    await page.getByRole('heading', { name: '导入与拆分' }).waitFor();
    await page.locator('#tool-body .dropzone input[type=file]').first().setInputFiles({ name: 'sheet.png', mimeType: 'image/png', buffer: sheet });
    await page.getByLabel('图集列数', { exact: true }).fill('4');
    await page.getByLabel('图集行数', { exact: true }).fill('2');
    await page.getByRole('button', { name: '拆分图集', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.sprite-frame').length === 8);
    await page.getByRole('button', { name: '选择帧 2', exact: true }).click();
    await page.getByRole('button', { name: '前移', exact: true }).click();
    await page.getByRole('button', { name: '复制帧', exact: true }).click();
    assert.equal(await page.locator('.sprite-frame').count(), 9);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal(await page.locator('.sprite-frame').count(), 8);
    const archive = await dl('导出帧与图集 ZIP', 'production-sprites.zip'), zip = await JSZip.loadAsync(archive);
    assert.equal(Object.keys(zip.files).filter(f => /^frames\/\d+\.png$/.test(f)).length, 8);
    const manifest = JSON.parse(await zip.file('frames.json').async('string'));
    assert.equal(manifest.frames.length, 8);
    assert.equal(manifest.frameWidth, 16);
    assert.equal(manifest.frameHeight, 16);
    const first = (await zip.file('frames/001.png').async('nodebuffer')).toString('base64');
    const firstPixel = await page.evaluate(async (data) => { const blob = await fetch('data:image/png;base64,' + data).then(r => r.blob()), bitmap = await createImageBitmap(blob), c = new OffscreenCanvas(16, 16), ctx = c.getContext('2d'); ctx.drawImage(bitmap, 0, 0); return [...ctx.getImageData(8, 8, 1, 1).data]; }, first);
    assert.deepEqual(firstPixel, [32, 255, 32, 255]);
    await dl('导出动画 GIF', 'production-sprites.gif');
    const probe = spawnSync(ffprobePath(), ['-v', 'error', '-show_entries', 'stream=width,height,nb_frames', '-of', 'json', resolve('test-results/production-sprites.gif')], { encoding: 'utf8', windowsHide: true });
    assert.equal(probe.status, 0, probe.stderr);
    const stream = JSON.parse(probe.stdout).streams[0];
    assert.equal(stream.width, 16);
    assert.equal(Number(stream.nb_frames), 8);
    await page.getByRole('button', { name: '倒序', exact: true }).click();
    assert.ok((await page.locator('.sprite-frame').first().innerText()).includes('008'));
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await page.getByRole('button', { name: '生成往返序列', exact: true }).click();
    assert.equal(await page.locator('.sprite-frame').count(), 14);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await page.getByLabel('预览动作分组', { exact: true }).selectOption('1');
    const actionZip = await JSZip.loadAsync(await dl('逐动作 GIF 打包', 'production-actions.zip'));
    assert.equal(Object.keys(actionZip.files).filter(f => f.endsWith('.gif')).length, 2);
    for (const name of ['action-01.gif', 'action-02.gif']) {
        const path = resolve('test-results/' + name); await writeFile(path, await actionZip.file(name).async('nodebuffer'));
        const info = spawnSync(ffprobePath(), ['-v', 'error', '-show_entries', 'stream=nb_frames', '-of', 'json', path], { encoding: 'utf8', windowsHide: true });
        assert.equal(Number(JSON.parse(info.stdout).streams[0].nb_frames), 4);
    }
    const flips = await page.evaluate(async () => {
        const { flipFrames } = await import('/lib/sprites.js');
        const c = document.createElement('canvas'); c.width = 2; c.height = 1;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 1, 1); ctx.fillStyle = '#00ff00'; ctx.fillRect(1, 0, 1, 1);
        const input = [{name:'test',canvas:c}], output = flipFrames(input, true);
        return { before:[...ctx.getImageData(0,0,1,1).data], after:[...output[0].canvas.getContext('2d').getImageData(0,0,1,1).data] };
    });
    assert.deepEqual(flips.before, [255,0,0,255]); assert.deepEqual(flips.after,[0,255,0,255]);
    for (let i=0;i<4;i++) await page.getByRole('button', { name: '复制帧', exact: true }).click();
    const rpg = await dl('导出 RPG Maker 单角色 PNG', 'production-rpg-character.png');
    assert.equal(rpg.readUInt32BE(16), 144); assert.equal(rpg.readUInt32BE(20), 192);
    for (let i=0;i<4;i++) await page.getByRole('button', { name: '撤销', exact: true }).click();
    console.log('PASS action groups/real per-action GIF ZIP/reverse/ping-pong/immutable flip/RPG sheet');
    await page.screenshot({ path: 'test-results/production-sprites.png', fullPage: true });
    console.log('PASS sprite split/order/PNG ZIP pixels/real 8-frame GIF');
    await route('layers');
    await page.getByRole('heading', { name: '自由画布与图层', exact: true }).waitFor();
    await page.locator('#tool-body .dropzone input[type=file]').setInputFiles({ name: 'base.png', mimeType: 'image/png', buffer: sheet });
    await page.waitForFunction(() => document.querySelectorAll('.layer-item').length === 1);
    await page.locator('#tool-body .dropzone input[type=file]').setInputFiles({ name: 'overlay.png', mimeType: 'image/png', buffer: small });
    await page.waitForFunction(() => document.querySelectorAll('.layer-item').length === 2);
    await page.getByLabel('横向位置', { exact: true }).fill('24');
    await page.getByLabel('横向位置', { exact: true }).press('Tab');
    await page.getByLabel('透明度', { exact: true }).fill('0.5');
    await page.getByLabel('透明度', { exact: true }).press('Tab');
    await page.getByLabel('图层名称', { exact: true }).fill('可编辑图层');
    await page.getByLabel('图层名称', { exact: true }).press('Tab');
    const canvas = page.locator('[data-testid=layer-canvas]'), rect = await canvas.boundingBox();
    await page.mouse.move(rect.x + 24, rect.y + 16);
    await page.mouse.down();
    await page.mouse.move(rect.x + 32, rect.y + 20, { steps: 4 });
    await page.mouse.up();
    assert.notEqual(Number(await page.getByLabel('横向位置', { exact: true }).inputValue()), 24);
    const project = JSON.parse((await dl('保存画布工程', 'production-canvas.json')).toString('utf8'));
    assert.equal(project.layers.length, 2);
    assert.equal(project.layers[1].opacity, .5);
    const lzip = await JSZip.loadAsync(await dl('导出分层 ZIP', 'production-layers.zip'));
    assert.ok(lzip.file('project.json'));
    assert.ok(lzip.file('composition.png'));
    assert.ok(lzip.file('layers/02.png'));
    const psdBuffer = await dl('导出分层 PSD', 'production-layered-project.psd');
    assert.equal(psdBuffer.toString('ascii',0,4),'8BPS');
    const psd = readPsd(psdBuffer, { useImageData:true, skipThumbnail:true });
    assert.equal(psd.width,64); assert.equal(psd.height,32); assert.equal(psd.children.length,2);
    assert.equal(psd.children[0].name,'可编辑图层');
    assert.ok(Math.abs(psd.children[0].opacity-.5)<.01);
    assert.equal(psd.children[0].imageData.width,64);
    assert.ok(psd.imageData.data.some((v:number)=>v>0));
    const compositePixels = await page.evaluate(async (base64) => {
        const image = await createImageBitmap(await fetch('data:image/png;base64,'+base64).then(r=>r.blob()));
        const canvas = new OffscreenCanvas(image.width,image.height), ctx = canvas.getContext('2d'); ctx.drawImage(image,0,0);
        return [...ctx.getImageData(0,0,image.width,image.height).data];
    }, await lzip.file('composition.png').async('base64'));
    assert.equal(psd.imageData.data.length,compositePixels.length);
    // PSD merged previews use a white matte; fully transparent RGB is undefined.
    // Compare visible, premultiplied pixels rather than invisible RGB bytes.
    const different = compositePixels.findIndex((v:number,i:number) => {
        if(i%4===3) return Math.abs(v-psd.imageData.data[i])>1;
        const a=i-i%4+3;
        return Math.abs(Math.round(v*compositePixels[a]/255)-Math.round(psd.imageData.data[i]*psd.imageData.data[a]/255))>1;
    });
    assert.equal(different,-1,'PSD 合成预览必须与 PNG 的可见像素对齐；差异通道 '+different);
    await page.getByLabel('显示图层', {exact:true}).uncheck();
    const hiddenPsd = readPsd(await dl('导出分层 PSD','production-hidden-layer.psd'),{useImageData:true,skipThumbnail:true});
    assert.equal(hiddenPsd.children[0].hidden,true);
    await page.getByLabel('显示图层', {exact:true}).check();
    console.log('PASS actual PSD signature/layer names/order/opacity/raster pixels');
    await page.getByRole('button', { name: '删除图层', exact: true }).click();
    assert.equal(await page.locator('.layer-item').count(), 1);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal(await page.locator('.layer-item').count(), 2);
    await page.getByRole('button', { name: '删除图层', exact: true }).click();
    await page.getByLabel('导入画布工程', { exact: true }).setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(() => document.querySelectorAll('.layer-item').length === 2);
    await route('gdd');
    await route('layers');
    assert.equal(await page.locator('.layer-item').count(), 2, '原生画布跨工具应保留');
    assert.equal(await page.getByLabel('图层名称', { exact: true }).inputValue(), '可编辑图层');
    await page.screenshot({ path: 'test-results/production-layers.png', fullPage: true });
    console.log('PASS layered canvas/drag/opacity/undo/native state retention/project ZIP');
    await route('image');
    const frame = page.frameLocator('.frame-wrap[data-tool=image] iframe');
    page.once('dialog', d => d.accept('页面保留验收'));
    await frame.getByRole('button', { name: '新建任务', exact: true }).click();
    const prompt = frame.getByPlaceholder('描述你要生成的图片…');
    await prompt.waitFor();
    await prompt.fill('不能被页面切换清空的草稿');
    await frame.locator('body').evaluate(body => body.dataset.sessionProof = 'kept');
    await route('layers');
    await route('image');
    await prompt.waitFor();
    assert.equal(await frame.locator('body').getAttribute('data-session-proof'), 'kept', 'iframe 不得因 DOM 移动而重新加载');
    assert.equal(await prompt.inputValue(), '不能被页面切换清空的草稿');
    console.log('PASS iframe browsing context and unsaved text retention');
    await route('asset-pack');
    await page.getByLabel('素材包主题', { exact: true }).fill('森林道具测试包');
    await page.getByLabel('素材清单', { exact: true }).fill('魔法钥匙\n草药瓶');
    await page.getByLabel('制作配方名称', { exact: true }).fill('森林素材配方');
    await page.getByRole('button', { name: '保存当前制作配方', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="已保存制作配方"] option').length === 2);
    await page.reload();
    await page.getByRole('heading', { name: '我的制作配方', exact: true }).waitFor();
    await page.getByLabel('已保存制作配方', { exact: true }).selectOption({ label:'森林素材配方' });
    await page.getByRole('button', { name: '套用制作配方', exact: true }).click();
    assert.equal(await page.getByLabel('素材包主题', { exact: true }).inputValue(), '森林道具测试包');
    assert.equal(await page.getByLabel('素材清单', { exact: true }).inputValue(), '魔法钥匙\n草药瓶');
    await page.getByRole('button', { name: '创建整套待生图任务', exact: true }).click();
    await page.locator('.pack-group').waitFor();
    await page.getByText('0 / 2 项已有结果', { exact: true }).waitFor();
    const tasks = await fetch(base + '/api/chatgpt/tasks').then(r => r.json());
    assert.equal(tasks.length, 2);
    assert.ok(tasks.every(t => t.prompt.includes('森林道具测试包')));
    await fetch(base + `/api/chatgpt/tasks/${tasks[0].id}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: small.toString('base64') }) });
    await page.getByText('1 / 2 项已有结果', { exact: true }).waitFor({ timeout: 16000 });
    const packzip = await JSZip.loadAsync(await dl('导出素材包 ZIP', 'production-asset-pack.zip'));
    const pmanifest = JSON.parse(await packzip.file('manifest.json').async('string'));
    assert.equal(pmanifest.complete, false);
    assert.equal(pmanifest.items.length, 2);
    await page.screenshot({ path: 'test-results/production-asset-pack.png', fullPage: true });
    console.log('PASS persisted themed asset pack/real result ZIP/incomplete manifest');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => location.hash = '/home');
    await page.locator('#menu').click();
    await page.locator('#sidebar a[href="#/space/characters"]').click();
    await page.waitForFunction(() => location.hash === '#/space/characters');
    assert.equal(await page.locator('#menu').getAttribute('aria-expanded'), 'false');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.evaluate(() => location.hash = '/settings');
    await page.getByRole('button', { name: '配置模型与 API Key', exact: true }).click();
    await page.frameLocator('iframe[title="模型与 API Key 设置"]').locator('body').waitFor();
    await page.screenshot({ path: 'test-results/production-settings-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
    await writeFile('test-results/production-tools-ui.json', JSON.stringify({ ok: true, spriteFrames: 8, gifFrames: Number(stream.nb_frames), actionGifGroups:2, rpgCharacterSheet:[144,192], immutableFlip:true, persistentWorkspaceRecipes:true, layeredPsd:true, spritePixelOrderVerified: true, layerDragAndUndo: true, layerProjectRoundTrip: true, nativeStateRetained: true, iframeContextRetained: true, themedAssetPack: true, materialLibrarySaved: (await readdir(join(root, 'assets'))).length, mobileMenu: true, errors }, null, 2));
}
catch (error) {
    if (page) {
        await page.screenshot({ path: 'test-results/production-tools-failure.png', fullPage: true });
        await writeFile('test-results/production-tools-failure.txt', await page.locator('body').innerText());
    }
    await writeFile('test-results/production-tools-server.log', output);
    throw error;
}
finally {
    if (browser)
        await browser.close();
    child.kill();
    await pause(500);
    await rm(root, { recursive: true, force: true });
}
