/** A whole asset brief becomes ordinary persisted image-bridge tasks. */
import { h, toast, copyText, download } from '../lib/dom.js';
import { api, taskStore, fileToDataURL, statusOf, withBase } from '../lib/api.js';
import { loadZip, exportBlob } from '../lib/export.js';
import { panel, btn, actionRow, fileDrop } from './kit.js';
const TEMPLATES = [
    { id: 'props', name: '像素道具包', items: ['治疗药水', '魔力药水', '金币', '钥匙', '宝箱', '卷轴', '背包', '火把'], layout: '单件物品，正面展示，物品完整居中，不要文字' },
    { id: 'weapons', name: '武器装备包', items: ['铁剑', '木弓', '法杖', '盾牌', '匕首', '战斧'], layout: '单件装备，统一 45 度斜向展示，轮廓完整，材质一致' },
    { id: 'ui-icons', name: 'UI 图标包', items: ['背包', '设置', '任务', '地图', '技能', '商店'], layout: '单枚游戏界面图标，同一外框、同一视角、同一描边和光源' },
    { id: 'terrain', name: '俯视地块包', items: ['草地', '泥土', '沙地', '石板', '浅水', '雪地'], layout: '俯视正交游戏地块，正方形，纹理四边可平铺，无透视、无文字、无边框' },
    { id: 'buildings', name: '等距建筑包', items: ['村民住宅', '铁匠铺', '杂货商店', '旅馆'], layout: '45 度等距建筑，同一地面菱形基座、同一镜头、统一比例，完整建筑居中' },
    { id: 'character', name: '角色设定包', items: ['主角正面设定', '主角侧面设定', '主角背面设定', '主角装备展示'], layout: '同一角色的游戏设定图，身份服装发型配色严格一致，全身完整展示' }
];
export function mountAssetPack(container: HTMLElement, { navigate }: any) {
    let references: string[] = [], creating = false;
    const list = h('div', { class: 'pack-task-list' });
    const template = h('select', { 'aria-label': '素材包模板' }, ...TEMPLATES.map(t => h('option', { value: t.id }, t.name)));
    const theme = h('input', { 'aria-label': '素材包主题', placeholder: '例如：森林魔法学院的冒险装备' });
    const style = h('select', { 'aria-label': '美术风格' }, h('option', { value: 'pixel' }, '像素美术'), h('option', { value: 'hd' }, '高清手绘'));
    const pixel = h('select', { 'aria-label': '目标像素规格' }, ...[32, 64, 128, 256].map(n => h('option', { value: n, selected: n === 64 }, `${n} × ${n} 像素规格`)));
    const palette = h('input', { 'aria-label': '统一风格说明', placeholder: '例如：16 色，紫色与薄荷绿，深色 1px 描边' });
    const items = h('textarea', { 'aria-label': '素材清单', rows: 8 }, TEMPLATES[0].items.join('\n'));
    const recipeName = h('input', { type: 'text', 'aria-label': '制作配方名称', placeholder: '给这套主题、风格与清单起个名字' });
    const recipeSelect = h('select', { 'aria-label': '已保存制作配方' });
    let recipes: any[] = [];
    const recipeStatus = h('p', { class: 'muted', role: 'status' });
    async function recipeRequest(body?: any) {
        const res = await fetch(withBase('/api/asset-recipes'), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
        const value = await res.json();
        if (!res.ok)
            throw new Error(value.error?.message || value.error || '配方读取失败');
        recipes = value;
        recipeSelect.replaceChildren(h('option', { value: '' }, '选择已保存的制作配方'), ...recipes.map(r => h('option', { value: r.id }, r.name)));
        recipeStatus.textContent = `当前工作区已保存 ${recipes.length} 个配方`;
    }
    const recipePanel = panel('我的制作配方', '将主题、画风、规格与素材清单保存到当前工作区。配方不保存参考图，套用后请重新上传参考图。', h('div', { class: 'fields' }, h('label', { class: 'field' }, '配方名称', recipeName), h('label', { class: 'field' }, '已保存配方', recipeSelect)), actionRow(btn('保存当前制作配方', { onclick: (e: Event) => run(e, async () => {
            await recipeRequest({ action: 'save', name: recipeName.value, template: template.value, style: style.value, pixel: pixel.value, theme: theme.value, palette: palette.value, items: items.value });
            toast('制作配方已保存到当前工作区');
        }) }), btn('套用制作配方', { onclick: () => {
            const recipe = recipes.find(r => r.id === recipeSelect.value);
            if (!recipe)
                return toast('请先选择制作配方', 'error');
            template.value = recipe.template;
            style.value = recipe.style;
            pixel.value = recipe.pixel;
            theme.value = recipe.theme;
            palette.value = recipe.palette;
            items.value = recipe.items;
            recipeName.value = recipe.name;
            references = [];
            reference.input.value = '';
            reference.node._files = [];
            reference.node.classList.remove('has-image');
            reference.node.querySelector('.drop-preview').replaceChildren(h('strong', null, '添加全包参考图'), h('small', null, '套用配方后需重新上传参考图'));
            toast('配方已套用，请重新上传参考图');
        } }), btn('删除制作配方', { kind: 'danger-quiet', onclick: (e: Event) => run(e, async () => {
            if (!recipeSelect.value)
                throw new Error('请先选择制作配方');
            if (!confirm('删除这个制作配方？已创建的任务与素材不会删除。'))
                return;
            await recipeRequest({ action: 'delete', id: recipeSelect.value });
        }) })), recipeStatus);
    template.onchange = () => { items.value = TEMPLATES.find(t => t.id === template.value)!.items.join('\n'); };
    const reference = fileDrop({ label: '添加全包参考图', accept: 'image/png,image/jpeg,image/webp', multiple: true, onFiles: async (files: File[]) => {
            try {
                if (files.length > 5)
                    throw new Error('最多 5 张公共参考图');
                if (files.some(f => f.size > 20 * 1024 * 1024))
                    throw new Error('单张参考图不超过 20 MB');
                references = await Promise.all(files.map(fileToDataURL)) as string[];
            }
            catch (error: any) {
                toast(error.message, 'error');
            }
        } });
    async function run(event: Event, fn: () => Promise<void>) {
        const b = event.currentTarget as HTMLButtonElement;
        b.disabled = true;
        try {
            await fn();
        }
        catch (error: any) {
            toast(error.message, 'error');
        }
        finally {
            b.disabled = false;
        }
    }
    const create = btn('创建整套待生图任务', { kind: 'primary', onclick: (e: Event) => run(e, async () => {
            if (creating)
                return;
            const names = items.value.split('\n').map((s: string) => s.trim()).filter(Boolean);
            if (!theme.value.trim())
                throw new Error('请填写素材包主题');
            if (!names.length || names.length > 32)
                throw new Error('清单需要 1–32 项，每行一项');
            creating = true;
            const id = crypto.randomUUID(), preset = TEMPLATES.find(t => t.id === template.value)!;
            const art = style.value === 'pixel' ? `精确像素美术，目标 ${pixel.value}×${pixel.value} 像素规格，硬边无抗锯齿，无渐变和模糊` : '高清手绘游戏美术，清晰轮廓，细致材质';
            let created = 0;
            try {
                for (const [i, name] of names.entries()) {
                    create.textContent = `创建中 ${i + 1} / ${names.length}`;
                    const prompt = `游戏素材包：${theme.value.trim()}\n素材项目 ${i + 1}/${names.length}：${name}\n全包美术规范：${art}。${palette.value.trim()}\n构图：${preset.layout}。\n保持整套素材的画风、调色板、光源方向、描边、比例一致。参考图用于整套风格与角色一致性。只画当前素材，透明背景，不要标签、水印、文字、格线。\n像素规格是设计目标；最终结果需在像素净化或图片调整工具中规整，不得谎称已经达到精确像素尺寸。`;
                    await api.createTask({ prompt, size: '1024x1024', transparent: true, images: references, source: `asset-pack:${id}:${theme.value.trim().slice(0, 80)}` });
                    created++;
                }
                toast(`已创建 ${created} 项；到任务中心复制指令并回填。`);
            }
            catch (error: any) {
                throw new Error(`已保留前 ${created} 项任务；后续创建失败：${error.message}`);
            }
            finally {
                creating = false;
                create.textContent = '创建整套待生图任务';
                await taskStore.load(true);
            }
        }) });
    function groups() {
        const result = new Map<string, any[]>();
        for (const task of taskStore.tasks) {
            if (!String(task.source).startsWith('asset-pack:'))
                continue;
            const key = task.source.split(':')[1];
            if (!result.has(key))
                result.set(key, []);
            result.get(key)!.push(task);
        }
        return result;
    }
    function taskRow(task: any) {
        const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
        file.addEventListener('change', async () => {
            const chosen = (file as any).files?.[0];
            if (!chosen) return;
            try {
                const data = await fileToDataURL(chosen);
                await api.completeTask(task.id, data);
                toast('回填完成，原流程会继续。');
                await taskStore.load(true);
            }
            catch (error: any) {
                toast(`回填失败：${error.message}`, 'error');
            }
            finally { (file as any).value = ''; }
        });
        const waiting = task.status === 'waiting' || task.status === 'running';
        return h('div', { class: 'pack-row' },
            task.result ? h('a', { class: 'pack-thumb-link', href: api.resultUrl(task), target: '_blank', rel: 'noopener' }, h('img', { class: 'pack-thumb', src: api.resultUrl(task), alt: '生成结果' })) : null,
            h('span', null, task.prompt.split('\n')[1]),
            h('span', { class: 'badge ' + statusOf(task).tone }, statusOf(task).label),
            waiting ? btn('复制指令', { kind: 'quiet', onclick: async () => {
                try { await copyText(await api.instruction(task.id)); toast('已复制该项交接指令'); }
                catch (error: any) { toast(error.message, 'error'); }
            } }) : null,
            waiting ? btn('回填结果', { kind: 'primary', onclick: () => file.click() }) : null,
            file
        );
    }
    function paint() {
        list.replaceChildren();
        for (const [id, tasks] of groups()) {
            tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            const completed = tasks.filter(t => t.result), card = h('article', { class: 'pack-group' }, h('h3', null, tasks[0].source.split(':').slice(2).join(':')), h('p', { class: 'muted' }, `${completed.length} / ${tasks.length} 项已有结果`), h('p', { class: 'muted small' }, '「等待回填」= 还没上传图片。每行可直接复制指令或回填结果，也可以到任务中心统一处理。'), h('div', { class: 'pack-rows' }, ...tasks.map(taskRow)));
            card.append(actionRow(btn('自动生成整包', { kind: 'primary', onclick: (e: Event) => run(e, async () => {
                    const pending = tasks.filter(t => ['waiting', 'running', 'interrupted'].includes(t.status));
                    if (!pending.length)
                        throw new Error('没有待回填任务');
                    const job: any = await api.autoRun(pending.map(t => t.id));
                    toast(`已调用 Codex，共 ${job.total} 项；生成完成后会自动回填`);
                    while (true) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        const state: any = await api.autoJob(job.id);
                        if (state.status === 'failed')
                            throw new Error(state.message);
                        if (state.status === 'done' || state.status === 'partial') {
                            toast(state.message);
                            await taskStore.load(true);
                            break;
                        }
                    }
                }) }), btn('复制整包交接指令', { onclick: (e: Event) => run(e, async () => {
                    const texts = await Promise.all(tasks.filter(t => t.status === 'waiting').map(t => api.instruction(t.id)));
                    if (!texts.length)
                        throw new Error('该包没有待执行任务');
                    await copyText(texts.join('\n\n---\n\n'));
                    toast('已复制所有待生图任务指令');
                }) }), btn('打开任务中心', { onclick: () => navigate('tasks') }), btn('导出素材包 ZIP', { onclick: (e: Event) => run(e, async () => {
                    if (!completed.length)
                        throw new Error('请先生成并回填至少一个结果');
                    const Zip = await loadZip(), zip = new Zip();
                    const entries = [];
                    for (const [index, task] of tasks.entries()) {
                        let file: null | string = null;
                        if (task.result) {
                            file = `assets/${String(index + 1).padStart(3, '0')}.${task.result.split('.').pop()}`;
                            const response = await fetch(api.resultUrl(task));
                            if (!response.ok)
                                throw new Error('结果图片下载失败');
                            zip.file(file, await response.blob());
                        }
                        entries.push({ id: task.id, status: task.status, prompt: task.prompt, file });
                    }
                    zip.file('manifest.json', JSON.stringify({ id, name: tasks[0].source.split(':').slice(2).join(':'), complete: completed.length === tasks.length, items: entries }, null, 2));
                    zip.file('README.md', `已回填 ${completed.length}/${tasks.length} 项。manifest.json 的 complete 字段表示是否整包完成。像素尺寸与美术一致性请人工验收。`);
                    await exportBlob(await zip.generateAsync({ type: 'blob' }), 'asset-pack.zip');
                }) })));
            list.append(card);
        }
        if (!list.children.length)
            list.append(h('p', { class: 'muted' }, '创建后的素材包保存在当前工作区任务中，刷新后可继续查看。'));
    }
    container.append(panel('整套素材制作', '按模板填写主题和素材清单。统一规格与参考图，逐项建立任务；开启自动生图后会自动生成并回填。', h('div', { class: 'fields' }, h('label', { class: 'field' }, '模板', template), h('label', { class: 'field' }, '美术风格', style), h('label', { class: 'field' }, '像素规格（仅像素模式）', pixel)), h('label', { class: 'field' }, '素材包主题', theme), h('label', { class: 'field' }, '统一风格说明', palette), h('label', { class: 'field' }, '素材清单（每行一项）', items), reference.node, actionRow(create)), panel('当前工作区的素材包', '开启自动生图后，任务会交给 ChatGPT 内置图片工具并自动回填。整包结果可下载为含清单的 ZIP。', list));
    container.prepend(recipePanel);
    void recipeRequest().catch((error: Error) => { recipeStatus.textContent = error.message; });
    return taskStore.subscribe(paint);
}
