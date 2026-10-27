import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkbenchHost } from '../lib/host.js';
import { tileFixture } from '../tools/local-asset-fixtures.ts';
import { WorkspaceStore } from '../lib/settings.js';
test('工作区隔离素材项目、密钥、素材目录，且回到原工作区仍可读取原项目', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gw-workspaces-'));
    let host: any;
    const server = createServer((req, res) => { void host.handler(req, res); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port, base = 'http://127.0.0.1:' + port;
    const post = async (path: string, value: any) => { const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }); const data = await response.json(); assert.equal(response.ok, true, JSON.stringify(data)); return data; };
    const rpc = async (method: string, payload: any = {}) => (await post('/api/rpc', { method, payload })).value;
    try {
        host = await createWorkbenchHost({ dataRoot: root, presetBaseUrl: base });
        const first = await rpc('createProject', { name: '工作区 A 项目' });
        const key = 'workspace-test-key-never-print-secret';
        await rpc('saveConfig', { customApiKey: key, customModel: 'model-in-A' });
        const aConfig = await rpc('getConfig');
        assert.ok(!JSON.stringify(aConfig).includes(key));
        const library = join(root, 'A-library');
        await post('/api/settings', { assetsDir: library });
        await post('/api/chatgpt/tasks', { prompt: 'A 的待生图任务' });
        const created = await post('/api/workspaces', { action: 'create', name: '工作区 B' });
        const id = created.workspaces.find((w: any) => w.name === '工作区 B').id;
        await post('/api/workspaces', { action: 'activate', id });
        assert.equal((await rpc('listProjects')).projects.length, 0);
        assert.equal((await rpc('getConfig')).customModel, 'chatgpt-imagegen-skill');
        const B = await rpc('createProject', { name: '工作区 B 项目' });
        const health = await fetch(base + '/api/health').then(r => r.json());
        assert.notEqual(health.workspace.assetsDir, library);
        assert.equal((await fetch(base + '/api/chatgpt/tasks').then(r => r.json())).length, 0);
        const png = 'data:image/png;base64,' + tileFixture().toString('base64');
        const asset = await post('/api/assets/save', { name: '测试地块.png', data: png });
        assert.ok(asset.path.startsWith(join(root, 'workspaces', id, 'assets')));
        assert.deepEqual(await readFile(asset.path), tileFixture());
        const gif = await fetch(base + '/api/images/gif', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frames: [png, png], fps: 8 }) });
        assert.equal(gif.status, 200, await gif.clone().text().then(s => s.slice(0, 160)));
        assert.equal(Buffer.from(await gif.arrayBuffer()).toString('ascii', 0, 3), 'GIF');
        await post('/api/workspaces', { action: 'activate', id: 'default' });
        assert.equal((await rpc('getProject', { projectId: first.projectId })).name, '工作区 A 项目');
        assert.equal((await rpc('getConfig')).customModel, 'model-in-A');
        assert.equal((await fetch(base + '/api/health').then(r => r.json())).workspace.assetsDir, library);
        const response = await fetch(base + '/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'getProject', payload: { projectId: B.projectId } }) });
        assert.equal(response.status, 400);
        assert.equal((await fetch(base + '/api/chatgpt/tasks').then(r => r.json())).length, 1);
    }
    finally {
        if (host)
            await host.dispose();
        await new Promise<void>(resolve => server.close(() => resolve()));
        await rm(root, { recursive: true, force: true });
    }
});
test('工作区配置损坏不覆盖原件，目录统计不把子工作区重复算入默认工作区', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gw-settings-'));
    try {
        const ws = await WorkspaceStore.load(root), child = await ws.create('子工作区');
        await writeFile(join(child.dir, 'large.bin'), Buffer.alloc(1024));
        const rows = await ws.list();
        assert.equal(rows.find(w => w.id === child.id).size, 1024);
        assert.ok(rows.find(w => w.id === 'default').size < 1024);
        await writeFile(join(root, 'workbench.json'), '{broken');
        await assert.rejects(WorkspaceStore.load(root), /损坏/);
        assert.equal(await readFile(join(root, 'workbench.json'), 'utf8'), '{broken');
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
