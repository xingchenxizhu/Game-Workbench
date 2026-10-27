import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceStore } from '../lib/settings.js';
test('制作配方跨重启持久化、工作区隔离，非法输入不污染已有配方', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gw-recipes-'));
    try {
        let store = await WorkspaceStore.load(root);
        const recipe = { action: 'save', name: '森林装备', template: 'weapons', style: 'pixel', pixel: '64', theme: '森林', palette: '紫绿', items: '弓\n剑' };
        const saved = await store.recipeAction(recipe);
        assert.equal(saved.length, 1);
        store = await WorkspaceStore.load(root);
        assert.equal(store.recipes()[0].items, '弓\n剑');
        const child = await store.create('其他项目');
        await store.activate(child.id);
        assert.deepEqual(store.recipes(), []);
        await store.recipeAction({ ...recipe, name: '其他工作区配方' });
        await store.activate('default');
        assert.equal(store.recipes()[0].name, '森林装备');
        await assert.rejects(store.recipeAction({ ...recipe, items: 'a\n'.repeat(33) }), /清单/);
        assert.equal(store.recipes().length, 1);
        await store.recipeAction({ action: 'delete', id: saved[0].id });
        assert.deepEqual((await WorkspaceStore.load(root)).recipes(), []);
        await store.activate(child.id);
        assert.equal(store.recipes().length, 1);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
