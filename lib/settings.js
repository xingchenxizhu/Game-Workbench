import { mkdir, readdir, readFile, rename, writeFile, rm, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
const DEFAULT_ID = 'default';
/** 工作区 = 一套独立的素材任务 / 视频 / 导出目录；default 复用项目 data 根，兼容老数据。 */
export class WorkspaceStore {
    root;
    file;
    shape;
    saving = Promise.resolve();
    constructor(root, shape) {
        this.root = root;
        this.file = join(root, 'workbench.json');
        this.shape = shape;
    }
    static async load(root) {
        await mkdir(root, { recursive: true });
        let shape = { active: DEFAULT_ID, workspaces: {}, settings: {} };
        try {
            const raw = JSON.parse(await readFile(join(root, 'workbench.json'), 'utf8'));
            if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
                (raw.workspaces && (typeof raw.workspaces !== 'object' || Array.isArray(raw.workspaces))) ||
                (raw.settings && (typeof raw.settings !== 'object' || Array.isArray(raw.settings))))
                throw new Error('配置结构无效');
            for (const value of Object.values(raw.workspaces || {})) {
                if (!value || typeof value.name !== 'string' || typeof value.createdAt !== 'string')
                    throw new Error('工作区记录无效');
            }
            shape = {
                active: typeof raw.active === 'string' ? raw.active : DEFAULT_ID,
                workspaces: raw.workspaces || {},
                settings: raw.settings || {}
            };
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw new Error('工作区配置损坏，已保留原文件，请检查 workbench.json。');
        }
        for (const id of Object.keys(shape.workspaces))
            if (id !== DEFAULT_ID && !/^w[a-z0-9]+$/.test(id))
                throw new Error('工作区标识无效');
        if (!Object.hasOwn(shape.workspaces, shape.active) && shape.active !== DEFAULT_ID)
            shape.active = DEFAULT_ID;
        if (!shape.workspaces[DEFAULT_ID]) {
            shape.workspaces[DEFAULT_ID] = { name: '默认工作区', createdAt: new Date().toISOString() };
        }
        const store = new WorkspaceStore(root, shape);
        await store.save();
        return store;
    }
    async save() {
        const snapshot = JSON.stringify(this.shape, null, 2);
        const operation = this.saving.catch(() => { }).then(async () => {
            const temp = this.file + '.' + randomUUID() + '.tmp';
            try {
                await writeFile(temp, snapshot);
                await rename(temp, this.file);
            }
            finally {
                await rm(temp, { force: true }).catch(() => { });
            }
        });
        this.saving = operation;
        await operation;
    }
    dir(id) {
        if (id !== DEFAULT_ID && !/^w[a-z0-9]+$/.test(id))
            throw new Error('工作区标识无效');
        return id === DEFAULT_ID ? this.root : join(this.root, 'workspaces', id);
    }
    activeId() {
        return this.shape.active;
    }
    name(id) {
        return this.shape.workspaces[id]?.name || id;
    }
    activeDir() {
        return this.dir(this.shape.active);
    }
    assetsDir() {
        return this.shape.workspaces[this.activeId()]?.assetsDir || (this.activeId() === DEFAULT_ID ? this.shape.settings.assetsDir : '') || join(this.activeDir(), 'assets');
    }
    recipes() { return this.shape.workspaces[this.activeId()].assetRecipes || []; }
    async recipeAction(input) {
        const current = this.recipes();
        if (input.action === 'delete') {
            if (typeof input.id !== 'string' || !current.some(r => r.id === input.id))
                throw new Error('制作配方不存在');
            this.shape.workspaces[this.activeId()].assetRecipes = current.filter(r => r.id !== input.id);
        }
        else if (input.action === 'save') {
            if (current.length >= 32)
                throw new Error('每个工作区最多保存 32 个配方');
            const recipe = { id: randomUUID() };
            for (const key of ['name', 'template', 'style', 'pixel', 'theme', 'palette', 'items']) {
                if (typeof input[key] !== 'string' || input[key].length > (key === 'items' ? 6000 : 1000))
                    throw new Error('配方字段无效或过长');
                recipe[key] = input[key].trim();
            }
            if (!recipe.name || recipe.name.length > 80 || !recipe.items || recipe.items.split(/\r?\n/).filter(Boolean).length > 32)
                throw new Error('填写配方名称与 1–32 项素材清单');
            if (!['props', 'weapons', 'ui-icons', 'terrain', 'buildings', 'character'].includes(recipe.template) || !['pixel', 'hd'].includes(recipe.style) || !['32', '64', '128', '256'].includes(recipe.pixel))
                throw new Error('配方模板或规格无效');
            this.shape.workspaces[this.activeId()].assetRecipes = [...current, recipe];
        }
        else
            throw new Error('未知的配方操作');
        await this.save();
        return this.recipes();
    }
    async list() {
        const rows = [];
        for (const [id, value] of Object.entries(this.shape.workspaces)) {
            rows.push({
                id,
                name: value.name,
                createdAt: value.createdAt,
                dir: this.dir(id),
                active: id === this.shape.active,
                size: await this.sizeOf(this.dir(id))
            });
        }
        return rows.sort((a, b) => (a.id === DEFAULT_ID ? -1 : b.id === DEFAULT_ID ? 1 : a.createdAt.localeCompare(b.createdAt)));
    }
    async sizeOf(dir) {
        let total = 0;
        const walk = async (current) => {
            let entries = [];
            try {
                entries = await readdir(current, { withFileTypes: true });
            }
            catch {
                return;
            }
            for (const entry of entries) {
                if (current === this.root && entry.name === 'workspaces')
                    continue;
                if (entry.isDirectory())
                    await walk(join(current, entry.name));
                else {
                    try {
                        total += (await stat(join(current, entry.name))).size;
                    }
                    catch { /* 忽略不可读文件 */ }
                }
            }
        };
        await walk(dir);
        return total;
    }
    async create(name) {
        const clean = String(name || '').trim().slice(0, 40);
        if (!clean)
            throw Object.assign(new Error('请填写工作区名称'), { status: 400 });
        const id = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
        this.shape.workspaces[id] = { name: clean, createdAt: new Date().toISOString() };
        await mkdir(join(this.dir(id), 'chatgpt-images'), { recursive: true });
        await mkdir(join(this.dir(id), 'video'), { recursive: true });
        await this.save();
        return { id, name: clean, createdAt: this.shape.workspaces[id].createdAt, dir: this.dir(id) };
    }
    async rename(id, name) {
        if (!this.shape.workspaces[id])
            throw Object.assign(new Error('工作区不存在'), { status: 404 });
        const clean = String(name || '').trim().slice(0, 40);
        if (!clean)
            throw Object.assign(new Error('请填写工作区名称'), { status: 400 });
        this.shape.workspaces[id].name = clean;
        await this.save();
    }
    async remove(id) {
        if (id === DEFAULT_ID)
            throw Object.assign(new Error('默认工作区不能删除'), { status: 400 });
        if (id === this.shape.active)
            throw Object.assign(new Error('请先切换到其它工作区再删除'), { status: 400 });
        if (!this.shape.workspaces[id])
            throw Object.assign(new Error('工作区不存在'), { status: 404 });
        delete this.shape.workspaces[id];
        await this.save();
        await rm(this.dir(id), { recursive: true, force: true });
    }
    async activate(id) {
        if (!this.shape.workspaces[id])
            throw Object.assign(new Error('工作区不存在'), { status: 404 });
        this.shape.active = id;
        await mkdir(join(this.dir(id), 'chatgpt-images'), { recursive: true });
        await mkdir(join(this.dir(id), 'video'), { recursive: true });
        await this.save();
    }
    settings() {
        return this.shape.settings;
    }
    async updateSettings(patch) {
        const next = { ...this.shape.settings };
        if (typeof patch.assetsDir === 'string') {
            const target = patch.assetsDir.trim();
            if (target && !isAbsolute(target))
                throw new Error('素材保存位置必须是绝对路径');
            if (target)
                await mkdir(target, { recursive: true });
            this.shape.workspaces[this.activeId()].assetsDir = target;
            if (this.activeId() === DEFAULT_ID)
                next.assetsDir = target;
        }
        if (Number.isFinite(Number(patch.retentionDays)))
            next.retentionDays = Math.max(1, Math.min(365, Number(patch.retentionDays)));
        if (typeof patch.autoCopyHandoff === 'boolean')
            next.autoCopyHandoff = patch.autoCopyHandoff;
        if (typeof patch.autoGenerateImages === 'boolean')
            next.autoGenerateImages = patch.autoGenerateImages;
        if (typeof patch.defaultSize === 'string')
            next.defaultSize = patch.defaultSize;
        this.shape.settings = next;
        await this.save();
        return next;
    }
}
export { DEFAULT_ID };
