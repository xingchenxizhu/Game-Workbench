import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { ImageBridge } from '../lib/bridge.js';
import { autoGenerateTask } from '../lib/native-image.js';
import { createWorkbenchHost } from '../lib/host.js';
import { tileFixture } from '../tools/local-asset-fixtures.ts';
test('只接收对应会话的结构化生图结果，参考图和透明要求传入，精确回填原任务', async () => {
    const root = await mkdtemp(join(tmpdir(), 'native-image-')), bridge = new ImageBridge(join(root, 'tasks'));
    let input: any;
    try {
        const task = await bridge.create({ prompt: '森林地块', transparent: true, images: ['data:image/png;base64,' + tileFixture().toString('base64')] });
        const correct = join(root, 'correct.png');
        await writeFile(correct, tileFixture());
        const fake: any = { listeners: new Set(), initialize: async () => { }, close() { }, request: async (method, params) => {
                if (method === 'modelProvider/capabilities/read')
                    return { imageGeneration: true };
                if (method === 'account/read')
                    return { account: { type: 'chatgpt' } };
                if (method === 'thread/start')
                    return { thread: { id: 'mine' } };
                if (method === 'turn/start') {
                    input = params.input;
                    setTimeout(() => { for (const fn of fake.listeners) {
                        fn({ method: 'item/completed', params: { threadId: 'other', turnId: 'turn', item: { type: 'imageGeneration', status: 'completed', savedPath: 'wrong-file' } } });
                        fn({ method: 'item/completed', params: { threadId: 'mine', turnId: 'turn', item: { id: 'image', type: 'imageGeneration', status: 'completed', savedPath: correct } } });
                        fn({ method: 'turn/completed', params: { threadId: 'mine', turn: { status: 'completed' } } });
                    } }, 30);
                    return { turn: { id: 'turn' } };
                }
                throw Error(method);
            } };
        const result = await autoGenerateTask({ bridge, assetsDir: () => join(root, 'assets'), rpcFactory: () => fake }, task, 'test');
        assert.equal(result.ok, true);
        assert.equal((await bridge.get(task.id)).status, 'completed');
        assert.deepEqual(await readFile(result.file), tileFixture());
        assert.ok(input[0].text.includes('真实 alpha'));
        assert.ok(input.some(i => i.type === 'localImage' && i.path.endsWith('reference-1.png')));
        const receipt = JSON.parse(await readFile(join(bridge.path(task.id), 'auto-receipt.json'), 'utf8'));
        assert.equal(receipt.threadId, 'mine');
        assert.equal(receipt.taskId, task.id);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test('创建普通任务和素材引擎生图均自动进入同一队列，回填解除原等待，防重复与工作区串用', async () => {
    const root = await mkdtemp(join(tmpdir(), 'auto-host-'));
    let host: any;
    let calls = 0, release: () => void;
    const held = new Promise<void>(r => release = r);
    const server = createServer((req, res) => void host.handler(req, res));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + (server.address() as any).port;
    const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { ok: r.ok, status: r.status, value: await r.json() }; };
    try {
        host = await createWorkbenchHost({ dataRoot: root, presetBaseUrl: base, imageRunner: async (options, tasks, progress) => { await held; const results = []; for (const task of tasks) {
                calls++;
                await options.bridge.complete(task.id, tileFixture());
                results.push({ ok: true, taskId: task.id });
                progress({ done: results.length, message: 'test fixture completed' });
            } return results; } });
        await post('/api/settings', { autoGenerateImages: true });
        const first = await post('/api/chatgpt/tasks', { prompt: '自动流程' });
        await new Promise(r => setTimeout(r, 40));
        const duplicate = await post('/api/auto/run', { taskIds: [first.value.id] });
        const workspace = await post('/api/workspaces', { action: 'create', name: '其他' });
        const other = workspace.value.workspaces.find(w => w.id !== 'default').id;
        assert.equal((await post('/api/workspaces', { action: 'activate', id: other })).status, 400);
        const material = post('/api/chatgpt/v1/images/generations', { prompt: '素材模块自动生成' });
        await new Promise(r => setTimeout(r, 40));
        release();
        const response = await material;
        assert.equal(response.value.data[0].b64_json, tileFixture().toString('base64'));
        for (let i = 0; i < 50; i++) {
            if ((await fetch(base + '/api/chatgpt/tasks').then(r => r.json())).every(t => t.status === 'completed'))
                break;
            await new Promise(r => setTimeout(r, 20));
        }
        assert.equal(calls, 2);
        assert.equal((await host.bridge.get(first.value.id)).status, 'completed');
    }
    finally {
        release?.();
        if (host)
            await host.dispose();
        await new Promise<void>(r => server.close(() => r()));
        await rm(root, { recursive: true, force: true });
    }
});
test('取消和回填并发时终态一致，取消后生成阶段更新不复活任务', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bridge-race-')), bridge = new ImageBridge(root);
    try {
        const task = await bridge.create({ prompt: 'race' });
        const result = await Promise.allSettled([bridge.cancel(task.id), bridge.complete(task.id, tileFixture())]);
        assert.equal(result[0].status, 'fulfilled');
        assert.equal(result[1].status, 'rejected');
        await bridge.updateAutomation(task.id, { stage: 'generating' });
        assert.equal((await bridge.get(task.id)).status, 'cancelled');
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
