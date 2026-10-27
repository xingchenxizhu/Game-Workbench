/** 设置中心：工作区、素材保存位置、生成后端与 API Key、行为与数据。 */
import { h, clear, toast, formatDate, emptyState } from '../lib/dom.js';
import { api, taskStore, withBase } from '../lib/api.js';
import { panel, btn, actionRow, select, toggle, badge } from './kit.js';
function formatSize(bytes) {
    if (!bytes)
        return '0 B';
    if (bytes > 1024 * 1024)
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes > 1024)
        return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
}
export function mountSettings(container, { toast: notify } = {}) {
    let workspaces = { active: '', workspaces: [], settings: {}, assetsDir: '' };
    let health = {};
    let config = {};
    let editingId = '';
    let busy = false;
    const root = h('div', { class: 'settings-page' });
    container.append(root);
    async function load() {
        try {
            const [ws, hlt, cfg] = await Promise.all([
                api.workspaces(),
                api.health(),
                api.rpc('getConfig', {}).catch(() => ({ value: {} }))
            ]);
            workspaces = ws;
            health = hlt;
            config = cfg?.value || {};
        }
        catch (error) {
            toast(error.message, 'error');
        }
        paint();
    }
    async function act(payload, message) {
        if (busy)
            return;
        busy = true;
        try {
            const value = await api.workspaceAction(payload);
            workspaces = value;
            if (payload.action === 'activate')
                await taskStore.load(true);
            toast(message);
            paint();
        }
        catch (error) {
            toast(error.message, 'error');
        }
        finally {
            busy = false;
        }
    }
    function workspaceCard(item) {
        const card = h('article', { class: item.active ? 'workspace-card active' : 'workspace-card' }, h('div', { class: 'workspace-top' }, h('strong', null, item.name), item.active ? badge('使用中', 'done') : null, h('span', { class: 'workspace-size' }, formatSize(item.size || 0))), h('code', { class: 'workspace-path' }, item.dir), h('span', { class: 'muted small' }, `创建于 ${formatDate(item.createdAt)}`));
        if (editingId === item.id) {
            const input = h('input', { type: 'text', value: item.name, 'aria-label': '工作区名称' });
            card.append(actionRow(btn('保存', { kind: 'primary', onclick: () => act({ action: 'rename', id: item.id, name: input.value }, '已重命名') }), btn('取消', { kind: 'quiet', onclick: () => { editingId = ''; paint(); } })));
            setTimeout(() => input.focus(), 0);
            card.dataset.editing = '1';
            return card;
        }
        const actions = actionRow(item.active ? btn('当前工作区', { kind: 'quiet', disabled: true }) : btn('切换', { onclick: () => act({ action: 'activate', id: item.id }, `已切换到「${item.name}」`) }), btn('重命名', { kind: 'quiet', onclick: () => { editingId = item.id; paint(); } }), item.id === 'default' ? null : btn('删除', { kind: 'danger-quiet', onclick: () => {
                if (!confirm(`删除工作区「${item.name}」？其中的任务、视频与导出文件会一起删除。`))
                    return;
                void act({ action: 'delete', id: item.id }, '工作区已删除');
            } }));
        card.append(actions);
        return card;
    }
    function keyStatus() {
        const keys = Object.entries(config || {}).filter(([key]) => /key/i.test(key) && !/keyboard/i.test(key));
        if (!keys.length)
            return '未读到后端凭据字段（可直接到素材模块设置里查看/填写）';
        return keys.map(([key, value]) => {
            const configured = value === true || (typeof value === 'string' && value && value !== '***');
            return `${key}：${configured ? '已配置' : '未配置'}`;
        }).join(' · ');
    }
    function paint() {
        clear(root);
        const settings = workspaces.settings || {};
        const createInput = h('input', { type: 'text', placeholder: '新工作区名称，例如：横版像素 RPG', 'aria-label': '新工作区名称' });
        const assetsInput = h('input', { type: 'text', value: workspaces.assetsDir || '', 'aria-label': '素材保存位置' });
        const autoCopy = toggle({ label: '创建任务后自动复制交接指令', value: settings.autoCopyHandoff !== false });
        const autoGenerate = toggle({ label: 'ChatGPT 生图：创建任务后自动生成并回填', value: settings.autoGenerateImages === true });
        const defaultSize = select({
            label: '流程默认尺寸', value: settings.defaultSize || '1024x1024',
            options: [
                { value: '1024x1024', label: '1024×1024 方形' }, { value: '1344x768', label: '1344×768 横向' },
                { value: '768x1344', label: '768×1344 竖向' }, { value: '1536x1024', label: '1536×1024 宽幅' }
            ],
            onChange: () => { }
        });
        root.append(panel('工作区', '每个工作区隔离素材项目、后端密钥、任务、视频和导出目录；任务运行时不能切换。默认工作区保留原 data/ 数据。切换前请保存当前页面的编辑草稿。', h('div', { class: 'workspace-list' }, ...(workspaces.workspaces || []).map(workspaceCard), (workspaces.workspaces || []).length ? null : emptyState('▤', '还没有工作区', '创建一个开始。')), h('div', { class: 'create-workspace' }, createInput, btn('新建工作区', { kind: 'primary', onclick: () => {
                if (!createInput.value.trim()) {
                    toast('请填写工作区名称', 'error');
                    return;
                }
                void act({ action: 'create', name: createInput.value.trim() }, '工作区已创建');
            } }))), panel('素材保存位置', '本地图片工具、图层画布和图集工具的导出会另存到这里；原素材模块的工程仍保留在当前工作区各项目目录中。', h('div', { class: 'inline-row' }, assetsInput, btn('保存位置', { kind: 'primary', onclick: async () => {
                try {
                    await api.saveSettings({ assetsDir: assetsInput.value.trim() });
                    await load();
                    toast('素材保存位置已更新');
                }
                catch (error) {
                    toast(error.message, 'error');
                }
            } }), btn('打开文件夹', { kind: 'quiet', onclick: async () => {
                try {
                    const value = await api.openFolder('assets');
                    toast(`已打开 ${value.path}`);
                }
                catch (error) {
                    toast(error.message, 'error');
                }
            } })), h('p', { class: 'muted small' }, `当前：${workspaces.assetsDir || '—'}`)), panel('生成后端与 API Key', '凭据属于当前工作区。AI 流程任务通过 ChatGPT 桥交接；图片、角色等模块使用这里配置的生成后端。', h('div', { class: 'kv-list' }, h('div', null, h('span', null, '生图后端'), h('strong', null, String(config.imageProvider || 'custom（ChatGPT 技能）'))), h('div', null, h('span', null, '模型'), h('strong', null, String(config.customModel || config.arkModel || '—'))), h('div', null, h('span', null, '接口地址'), h('code', null, String(config.customBaseUrl || '—'))), h('div', null, h('span', null, '凭据'), h('span', { class: 'muted small' }, keyStatus()))), actionRow(btn('配置模型与 API Key', { kind: 'primary', onclick: (event) => {
                const button = event.currentTarget, section = button.closest('section');
                const existing = section.querySelector('iframe');
                if (existing) {
                    existing.remove();
                    return;
                }
                section.append(h('iframe', { title: '模型与 API Key 设置', src: withBase('/material.html?settings=1&embedded=1'), style: { width: '100%', height: '650px', border: '1px solid #334155', borderRadius: '8px', marginTop: '16px' } }));
            } }), btn('切换为 ChatGPT 技能', { kind: 'quiet', onclick: async () => {
                try {
                    await api.preset();
                    await load();
                    toast('已切换为 ChatGPT 技能后端');
                }
                catch (error) {
                    toast(error.message, 'error');
                }
            } }))), panel('行为与数据', '自动生图使用本机已登录 ChatGPT 的 Codex 内置图片工具，不需要填写 OpenAI API Key；占用当前账号用量。', h('div', { class: 'field-row' }, h('p', { class: 'muted small' }, '任务与项目不会自动删除；请自行备份工作区目录。'), h('label', { class: 'field' }, h('span', { class: 'field-label' }, '流程默认尺寸'), defaultSize)), autoGenerate, autoCopy, actionRow(btn('保存行为设置', { kind: 'primary', onclick: async () => {
                try {
                    await api.saveSettings({
                        autoCopyHandoff: autoCopy.querySelector('input').checked,
                        autoGenerateImages: autoGenerate.querySelector('input').checked,
                        defaultSize: defaultSize.querySelector('select').value
                    });
                    await load();
                    toast('已保存');
                }
                catch (error) {
                    toast(error.message, 'error');
                }
            } }), btn('打开数据目录', { kind: 'quiet', onclick: async () => {
                try {
                    const value = await api.openFolder('data');
                    toast(`已打开 ${value.path}`);
                }
                catch (error) {
                    toast(error.message, 'error');
                }
            } })), h('div', { class: 'kv-list' }, h('div', null, h('span', null, '数据根目录'), h('code', null, String(health.dataRoot || '—'))), h('div', null, h('span', null, '视频转码'), h('span', null, health.video?.ok ? '可用' : String(health.video?.message || '未检测'))), h('div', null, h('span', null, '版本'), h('span', null, `工作台 ${health.version || ''} · Node ${health.node || ''}`)))));
    }
    paint();
    void load();
    return () => { };
}
