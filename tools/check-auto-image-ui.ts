/** Browser queue/display acceptance with deterministic output. Native generation is tested separately. */
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createWorkbenchHost } from '../lib/host.js';
import { encodePng } from '../modules/material/lib/png.js';
const root = await mkdtemp(join(tmpdir(), 'auto-image-ui-')), image = await readFile('assets/samples/test-grid.png');
let host: any, browser, page;
const server = createServer((req, res) => void host.handler(req, res));
try {
    await new Promise<void>(r => server.listen(14184, '127.0.0.1', r));
    host = await createWorkbenchHost({ dataRoot: root, presetBaseUrl: 'http://127.0.0.1:14184', imageRunner: async (options, tasks, progress) => { const results = []; for (const task of tasks) {
            await options.bridge.updateAutomation(task.id, { stage: 'generating' });
            await new Promise(r => setTimeout(r, 500));
            await options.bridge.complete(task.id, image);
            results.push({ ok: true, taskId: task.id });
            progress({ done: results.length, message: 'fixture completed' });
        } return results; } });
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:14184/#/settings');
    await page.getByText('ChatGPT 生图：创建任务后自动生成并回填', { exact: true }).click();
    await page.getByRole('button', { name: '保存行为设置', exact: true }).click();
    await page.goto('http://127.0.0.1:14184/#/tool/asset-pack');
    await page.getByLabel('素材包主题', { exact: true }).fill('魔力药水');
    await page.getByLabel('素材清单', { exact: true }).fill('一瓶魔力药水');
    await page.getByRole('button', { name: '创建整套待生图任务', exact: true }).click();
    await page.locator('.pack-thumb').waitFor({ timeout: 18000 });
    assert.ok(await page.locator('.pack-thumb').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0));
    const tasks = await fetch('http://127.0.0.1:14184/api/chatgpt/tasks').then(r => r.json());
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, 'completed');
    await page.goto('http://127.0.0.1:14184/#/tasks');
    await page.locator('.task-result img').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.task-result img')].every((img: HTMLImageElement) => img.complete && img.naturalWidth > 0));
    const pixels = await page.locator('.task-result img').evaluate((img: HTMLImageElement) => { const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; const c = canvas.getContext('2d'); c.drawImage(img, 0, 0); const rgba = c.getImageData(0, 0, canvas.width, canvas.height).data; let transparent = 0; for (let i = 3; i < rgba.length; i += 4)
        if (rgba[i] === 0)
            transparent++; return { width: canvas.width, height: canvas.height, transparent }; });
    assert.ok(pixels.transparent > 0);
    assert.equal(await page.locator('.task-card').getAttribute('data-task-id'), tasks[0].id);
    assert.deepEqual(errors, []);
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/automatic-image-display.png', fullPage: true });
    await writeFile('test-results/automatic-image-ui.json', JSON.stringify({ ok: true, fixtureRunner: true, nativeLiveTestSeparate: true, automaticDispatch: true, automaticBackfill: true, materialPackPreview: true, taskCenterPreview: true, actualPixels: pixels, errors }, null, 2));
    console.log('PASS automatic create -> dispatch -> backfill -> pack + task image display, real alpha');
}
finally {
    if (browser)
        await browser.close();
    if (host)
        await host.dispose();
    await new Promise<void>(r => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
}
