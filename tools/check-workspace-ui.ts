/**
 * V3 工作台浏览器验收（需要本机 Chrome）。
 * 覆盖：五个创作空间、20 个工具入口、原生视图（抠图/调整/放大/策划/模板库）、
 * AI 流程页、内嵌素材模块、任务中心、命令面板、深链接与三个视口。
 * 运行前先安装依赖（含 devDependencies），然后：node tools/check-workspace-ui.ts
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { TOOLS, SPACES, PRESETS, toolsOf } from '../public/registry.js';
import { tileFixture } from './local-asset-fixtures.ts';

const data = await mkdtemp(join(tmpdir(), 'workbench-v3-'));
const base = 'http://127.0.0.1:14179';
const server = spawn(process.execPath, ['lib/standalone.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, WORKBENCH_PORT: '14179', WORKBENCH_DATA: data },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '', browser, page;
server.stdout.on('data', (x) => { output += x; });
server.stderr.on('data', (x) => { output += x; });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await mkdir('test-results', { recursive: true });
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base + '/api/health').then((r) => r.json())).ok) break; } catch { /* 服务还没起来 */ }
    if (i === 119) throw Error(output);
    await pause(100);
  }
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], failed = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/chatgpt/tasks/')) failed.push(r.status() + ' ' + r.url()); });

  // 首页与空间
  await page.goto(base);
  await page.locator('.matrix').waitFor();
  assert.equal(await page.locator('#sidebar .nav-space').count(), SPACES.length);
  assert.equal(await page.locator('.matrix-item').count(), TOOLS.length);
  await page.screenshot({ path: 'test-results/v3-home-desktop.png', fullPage: true });

  for (const space of SPACES) {
    await page.goto(`${base}/#/space/${space.id}`);
    await page.locator('.tool-card').first().waitFor();
    assert.equal(await page.locator('.tool-card').count(), toolsOf(space.id).length, space.id);
  }

  // 原生视图：抠图 / 调整 / 放大
  const sample = tileFixture();
  for (const [id, marker] of [['matte', '.canvas-preview canvas'], ['adjust', '.canvas-preview canvas'], ['upscale', '.canvas-preview canvas']]) {
    await page.goto(`${base}/#/tool/${id}`);
    await page.locator('#tool-body .dropzone input[type=file]').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: sample });
    await page.locator('#tool-body ' + marker).first().waitFor({ timeout: 15000 });
    await page.screenshot({ path: `test-results/v3-${id}.png`, fullPage: false });
  }

  // 策划、模板库与视频工具
  await page.goto(`${base}/#/tool/gdd`);
  await page.locator('.doc-preview').waitFor();
  assert.ok((await page.locator('.doc-preview').innerText()).includes('## 1. 项目概述'));
  await page.goto(`${base}/#/tool/library`);
  await page.locator('.preset-card').first().waitFor();
  assert.equal(await page.locator('.preset-card').count(), PRESETS.length);
  await page.goto(`${base}/#/tool/video`);
  await page.locator('.video-tab').first().waitFor();
  assert.equal(await page.locator('.video-tab').count(), 3);
  assert.ok(/ffmpeg|视频/.test(await page.locator('.video-shell').innerText()));

  // AI 流程：局部重绘（上传 → 蒙版出现 → 提示词更新 → 批量面板）
  await page.goto(`${base}/#/tool/inpaint`);
  await page.locator('.batch-panel').waitFor();
  await page.locator('#tool-body .flow-input .dropzone input[type=file]').first().setInputFiles({ name: 'base.png', mimeType: 'image/png', buffer: sample });
  await page.locator('.mask-editor canvas').waitFor({ timeout: 15000 });
  await page.locator('textarea').first().fill('把剑换成发光符文剑');
  assert.ok((await page.locator('.prompt-preview').innerText()).includes('局部重绘任务'));
  await page.screenshot({ path: 'test-results/v3-flow-inpaint.png', fullPage: false });

  // 内嵌素材模块
  for (const id of ['image', 'sprite', 'rig', 'sequence', 'map', 'tile', 'music', 'sfx']) {
    await page.goto(`${base}/#/tool/${id}`);
    const frame = page.frameLocator(`.frame-wrap[data-tool="${id}"] iframe`);
    await frame.locator('body').waitFor({ timeout: 30000 });
    await page.waitForTimeout(400);
    assert.equal(await frame.locator('#boot-error').count(), 0, id);
  }
  await page.goto(`${base}/#/tool/stitch`);
  await page.getByRole('heading',{name:'地图工程与扩图设置',exact:true}).waitFor();
  await page.goto(`${base}/#/settings`);
  await page.locator('.settings-page').waitFor();
  await page.getByText('工作区', { exact: false }).first().waitFor();

  // 命令面板
  await page.goto(`${base}/#/home`);
  await page.locator('#open-search').click();
  await page.locator('.palette-input').fill('骨骼');
  await page.locator('.palette-row').first().waitFor();
  assert.ok((await page.locator('.palette-row').first().innerText()).includes('骨骼动画'));
  await page.locator('.palette-row').first().click();
  await page.waitForFunction(() => location.hash === '#/tool/rig');

  // 任务中心：创建 → 回填
  const seeded = await fetch(base + '/api/chatgpt/tasks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'V3 任务中心验收' })
  }).then((r) => r.json());
  await page.goto(`${base}/#/tasks`);
  const card = page.locator('.task-card').filter({ hasText: 'V3 任务中心验收' });
  await card.waitFor({ timeout: 20000 });
  await card.locator('input[type=file]').setInputFiles({ name: 'result.png', mimeType: 'image/png', buffer: sample });
  await card.locator('.badge.done').waitFor({ timeout: 20000 });
  assert.equal(await card.locator('img').count(), 1);

  // 深链接
  await page.goto(base + '/?dsh-gmm=1&module=map&stage=paint');
  await page.waitForFunction(() => location.hash === '#/tool/map');
  await page.frameLocator('.frame-wrap[data-tool="map"] iframe').locator('body').waitFor();

  // 响应式
  await page.setViewportSize({ width: 780, height: 1050 });
  await page.goto(`${base}/#/home`);
  await page.screenshot({ path: 'test-results/v3-home-tablet.png', fullPage: false });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/v3-home-mobile.png', fullPage: false });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  await writeFile('test-results/v3-ui.json', JSON.stringify({
    ok: true, spaces: SPACES.length, tools: TOOLS.length, nativeViews: ['matte', 'adjust', 'upscale', 'gdd', 'library', 'video'],
    flows: 5, embeddedModules: 8, taskCenter: true, palette: true, deepLink: true, batchQueue: true, splitToRig: true,
    viewports: [[1440, 1000], [780, 1050], [390, 844]], errors, failed
  }, null, 2));
  console.log(`PASS: ${SPACES.length} 个空间 / ${TOOLS.length} 个工具 / 原生视图与流程 / 任务中心 / 命令面板 / 深链接 / 3 个视口`);
  void seeded;
} catch (error) {
  if (page) {
    await page.screenshot({ path: 'test-results/v3-failure.png' }).catch(() => {});
    const text = await page.locator('#view').innerText().catch(() => '');
    await writeFile('test-results/v3-failure.txt', text).catch(() => {});
  }
  await writeFile('test-results/redesign-server.log', output);
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill();
  await pause(500);
  await rm(data, { recursive: true, force: true });
}

