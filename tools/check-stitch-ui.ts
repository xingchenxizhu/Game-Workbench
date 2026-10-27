/** Real browser + actual exports. Deterministic fixtures, never paid generation. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { readPsd, initializeCanvas } from 'ag-psd';
import { encodePng } from '../modules/material/lib/png.js';
initializeCanvas(() => { throw Error('unexpected canvas'); }, (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) } as any));
const root = await mkdtemp(join(tmpdir(), 'gw-stitch-')), base = 'http://127.0.0.1:14183';
const child = spawn(process.execPath, ['lib/standalone.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, WORKBENCH_DATA: root, WORKBENCH_PORT: '14183' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', browser, page;
child.stdout.on('data', c => output += c);
child.stderr.on('data', c => output += c);
const pause = ms => new Promise(r => setTimeout(r, ms));
const png = (color: number[]) => encodePng(Buffer.from(Array(80 * 48).fill(color).flat()), 80, 48), red = png([180, 60, 40, 255]), blue = png([30, 90, 200, 255]);
const post = async (path: string, body: any) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const value = await r.json(); assert.equal(r.ok, true, JSON.stringify(value)); return value; };
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
    page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto(base + '/#/tool/stitch');
    await page.getByRole('heading', { name: '地图工程与扩图设置', exact: true }).waitFor();
    await page.getByLabel('地图名称', { exact: true }).fill('地图拼接验收');
    await page.locator('#tool-body .dropzone input[type=file]').setInputFiles({ name: 'seed.png', mimeType: 'image/png', buffer: red });
    await page.waitForFunction(() => document.querySelector('.stage-info')?.textContent?.includes('1 个地图层块'));
    await page.getByLabel('左右重叠百分比').fill('10');
    await page.getByLabel('上下重叠百分比').fill('25');
    await page.getByRole('button', { name: '应用重叠设置', exact: true }).click();
    await page.getByRole('button', { name: '向右选格', exact: true }).click();
    await page.getByRole('button', { name: '手动创建扩图任务', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.stitch-task-list')?.children.length === 1);
    let tasks = await fetch(base + '/api/chatgpt/tasks').then(r => r.json());
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].references.length, 3);
    assert.ok(tasks[0].source.startsWith('stitch:'));
    const context = await fetch(base + `/api/chatgpt/tasks/${tasks[0].id}/${tasks[0].references[0]}`).then(r => r.arrayBuffer());
    const mask = await fetch(base + `/api/chatgpt/tasks/${tasks[0].id}/${tasks[0].references[1]}`).then(r => r.arrayBuffer());
    async function pixels(bytes: Buffer) { return page.evaluate(async (data) => { const bitmap = await createImageBitmap(await fetch('data:image/png;base64,' + data).then(r => r.blob())), c = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = c.getContext('2d'); ctx.drawImage(bitmap, 0, 0); return { width: bitmap.width, height: bitmap.height, pixels: [...ctx.getImageData(0, 0, bitmap.width, bitmap.height).data] }; }, bytes.toString('base64')); }
    const ref = await pixels(Buffer.from(context)), m = await pixels(Buffer.from(mask));
    assert.equal(ref.pixels[3], 255);
    assert.equal(ref.pixels[(8 * 4) + 3], 0);
    assert.equal(m.pixels[0], 0);
    assert.equal(m.pixels[8 * 4], 255);
    await post(`/api/chatgpt/tasks/${tasks[0].id}/complete`, { data: blue.toString('base64') });
    await page.waitForFunction(() => document.querySelector('.stage-info')?.textContent?.includes('2 个地图层块'), { timeout: 16000 });
    async function download(name: string, file: string) { const waiting = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); const result = await waiting; await result.saveAs('test-results/' + file); return readFile('test-results/' + file); }
    const joined = await pixels(await download('导出当前层 PNG', 'stitch-composite.png'));
    assert.equal(joined.width, 152);
    assert.equal(joined.height, 48);
    assert.deepEqual(joined.pixels.slice((40 * 4), (40 * 4) + 4), [180, 60, 40, 255]);
    assert.deepEqual(joined.pixels.slice((100 * 4), (100 * 4) + 4), [30, 90, 200, 255]);
    await page.getByLabel('自动扩图块数').fill('2');
    await page.getByLabel('同时等待生成数量').selectOption('2');
    await page.getByRole('button', { name: '启动自动扩图队列', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.stitch-task-list')?.children.length === 2, { timeout: 16000 });
    tasks = await fetch(base + '/api/chatgpt/tasks').then(r => r.json());
    for (const task of tasks.filter(t => t.status === 'waiting'))
        await post(`/api/chatgpt/tasks/${task.id}/complete`, { data: red.toString('base64') });
    await page.waitForFunction(() => document.querySelector('.stage-info')?.textContent?.includes('4 个地图层块'), { timeout: 16000 });
    await page.getByLabel('当前地图图层').selectOption('objects');
    await page.locator('#tool-body .dropzone input[type=file]').setInputFiles({ name: 'object.png', mimeType: 'image/png', buffer: blue });
    await page.waitForFunction(() => document.querySelector('.stage-info')?.textContent?.includes('5 个地图层块'));
    await page.getByLabel('当前地图图层').selectOption('mask');
    const maskPng = await pixels(await download('导出当前层 PNG', 'stitch-object-mask.png'));
    assert.ok(maskPng.pixels.includes(255));
    assert.ok(maskPng.pixels.some((v, i) => i % 4 === 0 && v === 0));
    await page.getByLabel('当前地图图层').selectOption('composite');
    await page.getByLabel('导出细分数').selectOption('3');
    const godot = await JSZip.loadAsync(await download('导出 Godot 地图包', 'stitch-godot.zip'));
    assert.ok(godot.file('project.godot'));
    assert.ok(godot.file('Map.tscn'));
    const manifest = JSON.parse(await godot.file('manifest.json').async('string'));
    assert.equal(manifest.chunks.length, 5);
    assert.equal(Object.keys(godot.files).filter(n => /^split\/.*\.png$/.test(n)).length, 45);
    const unity = await JSZip.loadAsync(await download('导出 Unity 地图包', 'stitch-unity.zip'));
    assert.ok(unity.file('Assets/WorkbenchMapLoader.cs'));
    assert.equal(Object.keys(unity.files).filter(n => /^Assets\/Resources\/.*\.png$/.test(n)).length, 5);
    const psd = readPsd(await download('导出地图 PSD', 'stitch-map.psd'), { useImageData: true, skipThumbnail: true });
    assert.equal(psd.children.length, 5);
    assert.equal(psd.width, manifest.bounds.width);
    assert.equal(psd.height, manifest.bounds.height);
    const zip = await JSZip.loadAsync(await download('保存完整状态 ZIP', 'stitch-state.zip'));
    const state = JSON.parse(await zip.file('map-state.json').async('string'));
    assert.equal(state.chunks.length, 5);
    assert.equal(state.pending.length, 0);
    assert.equal(state.settings.overlapY, .25);
    await page.reload();
    await page.getByLabel('已保存地图').selectOption({ label: '地图拼接验收 · 5 块' });
    await page.getByRole('button', { name: '读取地图工程', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.stage-info')?.textContent?.includes('5 个地图层块'));
    await page.getByLabel('导入地图状态或工作台引擎包').setInputFiles({ name: 'map-state.zip', mimeType: 'application/zip', buffer: await readFile('test-results/stitch-godot.zip') });
    await page.waitForFunction(() => document.querySelector('[aria-label="已保存地图"]')?.children.length === 3);
    const ws = await post('/api/workspaces', { action: 'create', name: '其他工作区' }), other = ws.workspaces.find(w => w.id !== 'default').id;
    await post('/api/workspaces', { action: 'activate', id: other });
    assert.deepEqual(await fetch(base + '/api/map-projects').then(r => r.json()), []);
    assert.equal((await fetch(base + '/api/map-projects?workspaceId=default')).status, 409);
    await post('/api/workspaces', { action: 'activate', id: 'default' });
    const before = (await fetch(base + '/api/map-projects').then(r => r.json())).length;
    const bad = await fetch(base + '/api/map-projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: '../../escape', state }) });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(base + '/api/map-projects').then(r => r.json())).length, before);
    await page.locator('.stitch-stage').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/stitch-workspace.png', fullPage: true });
    assert.deepEqual(errors, []);
    await writeFile('test-results/stitch-ui.json', JSON.stringify({ ok: true, edgeReferencePixels: true, maskPixels: true, independentOverlap: true, automaticQueue: 2, completedChunks: 5, workspacePersistence: true, stateRoundTrip: true, godotZip: true, unityZip: true, psdLayers: 5, splitPngs: 45, paidGeneration: false, engineRuntimeTested: false, errors }, null, 2));
    console.log('PASS: stitch geometry/references/masks/manual+auto queue/layers/persistence/45 PNGs/PSD/Godot+Unity packages');
}
catch (error) {
    if (page)
        await page.screenshot({ path: 'test-results/stitch-failure.png', fullPage: true });
    await writeFile('test-results/stitch-server.log', output);
    throw error;
}
finally {
    if (browser)
        await browser.close();
    child.kill();
    await pause(500);
    await rm(root, { recursive: true, force: true });
}
