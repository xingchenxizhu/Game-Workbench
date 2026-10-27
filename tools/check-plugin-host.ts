/**
 * DSH 插件假宿主验收：验证 lib/index.js 的 apply 注册了前缀路由，
 * 页面/接口在 /game-workbench 下可用，以及浏览器半区注册了三个槽位。
 * 用法：node tools/check-plugin-host.ts
 */
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { tileFixture } from './local-asset-fixtures.ts';
const home = await mkdtemp(join(tmpdir(), 'gw-dsh-home-'));
process.env.DSH_HOME = home;
process.env.GW_DATA = join(home, 'game-workbench');
const { apply, MOUNT_PATH } = await import('../lib/index.js');
assert.equal(MOUNT_PATH, '/game-workbench');
const routes = [];
const effects = [];
const nativeTools: any[] = [];
const ctx = {
    get(name) {
        if (name === 'webServer')
            return { register(route) { routes.push(route); return () => { }; } };
        if (name === 'tools')
            return { register(definition: any) { nativeTools.push(definition); return () => { }; } };
        if (name === 'systemPrompt')
            return { section() { return () => { }; } };
        return undefined;
    },
    effect(fn, label) { effects.push({ label, dispose: fn() }); }
};
apply(ctx);
assert.equal(routes.length, 1);
assert.equal(routes[0].kind, 'prefix');
assert.equal(routes[0].path, MOUNT_PATH);
const server = createServer((req, res) => { void routes[0].handler(req, res); });
await new Promise((resolve) => server.listen(14178, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:14178';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let health = null;
for (let i = 0; i < 150; i++) {
    try {
        const response = await fetch(base + '/game-workbench/api/health');
        if (response.ok) {
            health = await response.json();
            break;
        }
    }
    catch { /* 服务还没就绪 */ }
    await pause(100);
}
assert.ok(health, '插件路由未就绪');
assert.equal(health.ok, true);
assert.equal(health.mountPath, '/game-workbench');
const page = await fetch(base + '/game-workbench/');
assert.equal(page.status, 200);
assert.match(await page.text(), /游戏工作台/);
assert.equal((await fetch(base + '/game-workbench/app.js')).status, 200);
assert.equal((await fetch(base + '/game-workbench/app.css')).status, 200);
assert.equal((await fetch(base + '/game-workbench/material.html')).status, 200);
assert.equal((await fetch(base + '/game-workbench/vendor/react.js')).status, 200);
assert.equal((await fetch(base + '/game-workbench/vendor/ag-psd.js')).status, 200);
assert.deepEqual(await fetch(base + '/game-workbench/api/asset-recipes').then(r=>r.json()),[]);
assert.deepEqual(await fetch(base + '/game-workbench/api/map-projects').then(r=>r.json()),[]);
assert.equal((await fetch(base + '/game-workbench/views/stitch.js')).status,200);
assert.equal((await fetch(base + '/game-workbench/lib/stitch.js')).status,200);
assert.equal((await fetch(base + '/game-workbench/mapstitch')).status, 200);
for (const file of ['views/sprites.js', 'views/layers.js', 'views/asset-pack.js', 'lib/export.js', 'lib/sprites.js']) {
    assert.equal((await fetch(base + '/game-workbench/' + file)).status, 200, file);
}
const saved = await fetch(base + '/game-workbench/api/assets/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '插件素材保存.png', data: 'data:image/png;base64,' + tileFixture().toString('base64') }) });
assert.equal(saved.status, 200);
const savedInfo = await saved.json();
assert.deepEqual(await readFile(savedInfo.path), tileFixture());
const imageTask = await fetch(base + '/game-workbench/api/chatgpt/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: '插件前缀回填地址测试' }) }).then(r => r.json());
const instruction = await fetch(base + '/game-workbench/api/chatgpt/tasks/' + imageTask.id + '/交给ChatGPT生图.md').then(r => r.text());
assert.ok(instruction.includes('"' + base + '/game-workbench"'), '交接指令必须使用当前 DSH 前缀地址');
const redirect = await fetch(base + '/game-workbench', { redirect: 'manual' });
assert.equal(redirect.status, 302);
assert.equal(redirect.headers.get('location'), '/game-workbench/');
const rpc = async (method, payload) => {
    const response = await fetch(base + '/game-workbench/api/rpc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, payload })
    });
    return response.json();
};
const created = await rpc('createRigJob', { name: '插件假宿主验收' });
assert.ok(created.ok, JSON.stringify(created));
assert.ok(created.value.jobId);
assert.equal((await rpc('deleteRigJob', { jobId: created.value.jobId })).ok, true);
for (let i = 0; i < 50 && !nativeTools.length; i++)
    await pause(50);
assert.equal(nativeTools.length, 1);
assert.equal(nativeTools[0].name, 'game_workbench');
const activeWorkspace = await nativeTools[0].execute({ action: 'workspace' }, {});
assert.equal(activeWorkspace.active, 'default');
const guide = await nativeTools[0].execute({ action: 'guide', topic: 'methods', workspaceId: 'default' }, {});
assert.ok(guide.text.includes('createProject'));
const nativeProject = await rpc('createProject', { name: 'DSH 原生工具测试项目' });
assert.ok(nativeProject.ok);
const toolList = await nativeTools[0].execute({ action: 'call', method: 'listProjects', workspaceId: 'default' }, {});
await assert.rejects(nativeTools[0].execute({ action: 'call', method: 'listProjects', workspaceId: 'other' }, {}), /工作区/);
assert.ok(JSON.stringify(toolList).includes('DSH 原生工具测试项目'));
await rpc('deleteProject', { projectId: nativeProject.value.projectId });
// 浏览器半区：经典脚本 + 三个槽位
const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
assert.ok(!/^\s*(import|export)\s/m.test(code), '客户端必须是经典脚本');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: base + '/', runScripts: 'outside-only' });
let registration = null;
dom.window.__ModuleLoader__ = { load(value) { registration = value; } };
dom.window.eval(code);
assert.ok(registration && typeof registration.factory === 'function');
const bundle = registration.factory((name) => {
    if (name === 'react')
        return { createElement: (type, props, ...children) => ({ type, props, children }) };
    throw new Error('未知依赖 ' + name);
});
assert.equal(typeof bundle.apply, 'function');
const slots = [];
bundle.apply({
    slots: {
        inject(_name, fn) { fn(); },
        register(spec) { slots.push(spec); return () => { }; }
    }
});
assert.deepEqual(slots.map((slot) => slot.name).sort(), ['main', 'settings.section', 'sidebar.panellist']);
assert.equal(slots.find((slot) => slot.name === 'sidebar.panellist').id, 'gameWorkbench');
assert.equal(slots.find((slot) => slot.name === 'main').key, 'gameWorkbench');
let released = false, opened = false, submitted = false;
const fakeSessions = { create: async (payload) => { assert.deepEqual(Object.keys(payload), []); return 'test-session'; },
    retain: () => ({ ready: Promise.resolve(), release() { released = true; }, binding: { session: {
                beginSubmission: (input) => { assert.equal(input.mode, 'queue'); return { requestId: 'test-request', abandon() { } }; },
                prompt: async (parts, mode, _unused, id) => { assert.equal(mode, 'queue'); assert.equal(id, 'test-request'); assert.ok(parts[0].text.includes('game_workbench(')); submitted = true; return { ok: true }; }
            } } }) };
assert.equal(await bundle.openNativeSession({ get: name => name === 'sessions' ? fakeSessions : name === 'uiWorkspace' ? { openSession: () => opened = true } : undefined }, "请使用 game_material({action:'guide'})"), 'test-session');
assert.ok(opened && released && submitted, '原生会话应打开、提交并释放引用');
console.log('PASS: 插件前缀路由 / SPA / 素材模块静态资源 / RPC / 浏览器半区三槽位');
server.close();
for (const effect of effects)
    if (typeof effect.dispose === 'function')
        effect.dispose();
await pause(200);
await rm(home, { recursive: true, force: true }).catch(() => { });
