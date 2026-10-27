/**
 * V3 前端启动冒烟测试：用 jsdom 真实执行 public/app.js，检查布局、路由和各原生视图。
 * 用法：node tools/check-shell-dom.ts
 * 需要 jsdom（仅开发依赖，未写进 package.json）：npm install --no-save jsdom
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'public/index.html'), 'utf8')
  .replace(/<script type="module" src="\.\/app\.js"><\/script>/, '');
const dom = new JSDOM(html, { url: 'http://127.0.0.1:4174/', pretendToBeVisual: true });
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
globalThis.location = window.location;
globalThis.localStorage = window.localStorage;
globalThis.matchMedia = window.matchMedia = () => ({
  matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}
});
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
window.navigator.clipboard = { writeText: async () => {} };
window.navigator.sendBeacon = () => true;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.scrollTo = window.scrollTo = () => {};
const jsonResponse = (value) => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => value, text: async () => JSON.stringify(value) });
let createdTasks = 0;
globalThis.fetch = async (url, init = {}) => {
  const path = String(url);
  if (path.includes('/api/chatgpt/tasks') && init.method === 'POST' && !path.includes('/complete') && !path.includes('/cancel')) {
    const payload = JSON.parse(init.body || '{}');
    createdTasks += 1;
    return jsonResponse({
      id: `task-${createdTasks}`.padEnd(36, '0'), prompt: payload.prompt, size: payload.size,
      status: 'waiting', createdAt: new Date().toISOString(), references: [], source: payload.source
    });
  }
  const payload = path.includes('/api/health') ? { ok: true, methods: 179, video: { ok: true, message: 'ffmpeg 可用' } }
    : path.includes('tasks/root') ? { path: 'data/chatgpt-images' }
      : path.includes('/api/chatgpt/tasks') ? [{
        id: 'c'.repeat(36), prompt: '拆件总览图验收', size: '1536x1024', status: 'completed',
        createdAt: new Date().toISOString(), result: 'result.png', references: [], source: 'flow:split'
      }]
        : [];
  return jsonResponse(payload);
};

const failures = [];
function check(name, condition, detail = '') {
  if (condition) console.log('ok   ' + name);
  else { console.log('FAIL ' + name + (detail ? ' :: ' + detail : '')); failures.push(name); }
}
function navigate(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  return document.querySelector('#view');
}
const settle = () => new Promise((r) => setTimeout(r, 30));

const { TOOLS, PRESETS, toolsOf } = await import(pathToFileURL(resolve(root, 'public/registry.js')).href);
await import(pathToFileURL(resolve(root, 'public/app.js')).href);
await settle();

check('侧边栏五个创作空间', document.querySelectorAll('.nav-space').length === 5);
check('首页标题', /把想法/.test(document.querySelector('.hero h1')?.textContent || ''));
check('全部功能矩阵数量', document.querySelectorAll('.matrix-item').length === TOOLS.length);
check('生产链数量', document.querySelectorAll('.pipeline-card').length === 4);
check('任务角标存在', !!document.querySelector('#task-pill'));

navigate('#/space/assets');
check('素材工坊工具卡', document.querySelectorAll('.tool-card').length === toolsOf('assets').length, String(document.querySelectorAll('.tool-card').length));
check('空间页标题', document.querySelector('.page-head h1')?.textContent === '素材工坊');

navigate('#/tool/matte');
check('抠图页标题', document.querySelector('.tool-head h1')?.textContent === '抠图去背');
check('抠图页空状态', !!document.querySelector('.stage-empty'));
check('抠图页参数', /容差/.test(document.querySelector('#view')?.textContent || ''));

navigate('#/tool/adjust');
check('调整页滑块', document.querySelectorAll('input[type=range]').length >= 6, String(document.querySelectorAll('input[type=range]').length));

navigate('#/tool/upscale');
check('放大页倍数按钮', /8×/.test(document.querySelector('#view')?.textContent || ''));

navigate('#/tool/gdd');
const doc = document.querySelector('.doc-preview')?.textContent || '';
check('策划文档章节', doc.includes('## 1. 项目概述') && doc.includes('## 7. 里程碑'));
check('策划表单字段', document.querySelectorAll('.doc-preview,select,textarea,input').length > 8);

navigate('#/tool/library');
check('预设卡数量', document.querySelectorAll('.preset-card').length === PRESETS.length, String(document.querySelectorAll('.preset-card').length));

navigate('#/tool/inpaint');
const prompt = document.querySelector('.prompt-preview')?.textContent || '';
check('局部重绘提示词', /局部重绘任务/.test(prompt) && /蒙版/.test(prompt));
check('流程输入区', /原图/.test(document.querySelector('#view')?.textContent || ''));
check('批量队列面板', !!document.querySelector('.batch-panel') && /创建批量任务/.test(document.querySelector('.batch-panel')?.textContent || ''));

navigate('#/tool/video');
check('视频工具三个页签', document.querySelectorAll('.video-tab').length === 3, String(document.querySelectorAll('.video-tab').length));
check('视频页读取服务状态', /ffmpeg/.test(document.querySelector('.video-shell')?.textContent || ''));

for (const id of ['view', 'render', 'split', 'ui']) {
  navigate('#/tool/' + id);
  const flowPrompt = document.querySelector('.prompt-preview')?.textContent || '';
  check(`流程 ${id} 生成提示词`, flowPrompt.length > 30, String(flowPrompt.length));
}

// 批量队列：界面创建 2 条任务，队列写进 localStorage
navigate('#/tool/ui');
const batchPanel = document.querySelector('.batch-panel');
batchPanel.querySelector('input[type=number]').value = '2';
batchPanel.querySelector('.btn-primary').click();
await new Promise((resolve) => setTimeout(resolve, 120));
const batchIds = JSON.parse(window.localStorage.getItem('wb3.batch.ui') || '[]');
check('批量队列创建两条任务', batchIds.length === 2 && createdTasks >= 2, JSON.stringify(batchIds));

navigate('#/tasks');
check('任务中心标题', document.querySelector('.page-head h1')?.textContent === '任务中心');
check('任务筛选', document.querySelectorAll('#view .chip').length === 4);
check('拆件任务有送入骨骼按钮', [...document.querySelectorAll('.task-card')].some((card) => /送入骨骼装配/.test(card.textContent)));

navigate('#/tool/image');
check('iframe 工具生成 iframe', !!document.querySelector('iframe') && /material\.html/.test(document.querySelector('iframe').getAttribute('src') || ''));
check('iframe 工具使用全高布局', document.querySelector('#view').classList.contains('view-frame'));
navigate('#/home');
check('离开 iframe 工具后恢复普通布局', !document.querySelector('#view').classList.contains('view-frame'));

navigate('#/settings');
check('设置页是原生页面', !!document.querySelector('.settings-page') && !document.querySelector('#view iframe'));
check('设置页包含工作区', /工作区/.test(document.querySelector('#view').textContent || ''));

// 命令面板：点击打开 → 输入 → 选中跳转
document.querySelector('#open-search').click();
await settle();
check('命令面板可打开', !document.querySelector('.palette').hidden);
const paletteInput = document.querySelector('.palette-input');
paletteInput.value = '抠图';
paletteInput.dispatchEvent(new window.Event('input'));
await settle();
check('命令面板能搜到工具', [...document.querySelectorAll('.palette-row')].some((row) => /抠图去背/.test(row.textContent)), String(document.querySelectorAll('.palette-row').length));
document.querySelector('.palette-row').click();
await settle();
check('命令面板跳转', window.location.hash === '#/tool/matte', window.location.hash);

// 主题切换
document.querySelector('#theme').click();
check('主题切换为浅色', document.documentElement.dataset.theme === 'light');
document.querySelector('#theme').click();
check('主题切回深色', document.documentElement.dataset.theme === 'dark');

const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));
check('没有未捕获错误', errors.length === 0, errors.join(' | '));

console.log(`\n${failures.length ? failures.length + ' 项失败' : '全部通过'}`);
if (failures.length) process.exitCode = 1;
process.exit(failures.length ? 1 : 0);

