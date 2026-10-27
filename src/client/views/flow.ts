/** AI 流程页：按 flows.js 的定义渲染输入、生成提示词并提交生图任务。 */
import { h, clear, toast, copyText, formatDate, baseName, download } from '../lib/dom.js';
import { createCanvas, canvasToDataURL, cloneCanvas } from '../lib/canvas.js';
import { api, taskStore, statusOf, fileToDataURL, taskFolder } from '../lib/api.js';
import { sendTaskToRig, rigDeepLink } from '../lib/rig.js';
import { panel, split, imageDrop, btn, badge, actionRow, previewCanvas, range, toggle, select, textInput, textArea } from './kit.js';
export function mountFlow(container: any, { flow, navigate, openDeepLink }: any) {
    let alive = true, optionsDirty = false, autoCopy = true;
    const values = {};
    const images: any = {};
    for (const field of flow.fields)
        values[field.id] = field.value ?? (field.type === 'toggle' ? false : field.type === 'range' ? field.min ?? 0 : '');
    const taskArea = h('div', { class: 'flow-tasks' });
    let promptEdited = false;
    const promptStatus = h('p', { class: 'field-hint', role: 'status' });
    const promptBox = h('textarea', { class: 'prompt-preview', rows: 12, 'aria-label': '提示词预览（可编辑）', style: { width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: '220px', fontSize: '14px' }, oninput: () => {
        promptEdited = true;
        promptStatus.textContent = '正在使用手动提示词；调整参数不会覆盖。单张和批量生成均使用此内容。';
    } });
    /* ── 批量队列状态 ───────────────────────────────── */
    const batchKey = `wb3.batch.${flow.id}`;
    let batchIds = (() => {
        try {
            const list = JSON.parse(localStorage.getItem(batchKey) || '[]');
            return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
        }
        catch {
            return [];
        }
    })();
    let batchMode = 'variants';
    const batchState = { list: null, progressText: null, progressBar: null, copyAll: null, backfillAll: null, cancelAll: null, clear: null, count: null };
    function saveBatchIds() { try {
        localStorage.setItem(batchKey, JSON.stringify(batchIds.slice(0, 40)));
    }
    catch { /* 隐私模式忽略 */ } }
    function batchTasks() { return batchIds.map((id) => taskStore.tasks.find((task) => task.id === id)).filter(Boolean); }
    /* ── 蒙版编辑器 ─────────────────────────────────── */
    function createMaskEditor(base: any, onChange: any): any {
        const mask = createCanvas(base.width, base.height);
        const dataCtx = mask.getContext('2d');
        dataCtx.fillStyle = '#000';
        dataCtx.fillRect(0, 0, mask.width, mask.height);
        const tint = createCanvas(base.width, base.height);
        const display = createCanvas(base.width, base.height);
        const displayCtx = display.getContext('2d');
        const wrap = h('div', { class: 'mask-editor checker' }, display);
        const sizeLabel = h('span', { class: 'brush-size' }, '画笔 48px');
        let brush = 48;
        let erasing = false;
        function repaint() {
            const tintCtx = tint.getContext('2d');
            tintCtx.globalCompositeOperation = 'source-over';
            tintCtx.fillStyle = '#f4536b';
            tintCtx.fillRect(0, 0, tint.width, tint.height);
            tintCtx.globalCompositeOperation = 'destination-in';
            tintCtx.drawImage(mask, 0, 0);
            tintCtx.globalCompositeOperation = 'source-over';
            displayCtx.clearRect(0, 0, display.width, display.height);
            displayCtx.drawImage(base, 0, 0);
            displayCtx.globalAlpha = 0.62;
            displayCtx.drawImage(tint, 0, 0);
            displayCtx.globalAlpha = 1;
        }
        const brushInput = h('input', { type: 'range', min: 8, max: 240, step: 4, value: brush, oninput: (event) => { brush = Number(event.target.value); sizeLabel.textContent = `画笔 ${brush}px`; } });
        const tools = h('div', { class: 'mask-tools' }, h('div', { class: 'segmented' }, h('button', { type: 'button', class: 'seg on', dataset: { mode: 'paint' }, onclick: (event) => { erasing = false; for (const b of event.currentTarget.parentElement.children)
                b.classList.toggle('on', b === event.currentTarget); } }, '涂抹'), h('button', { type: 'button', class: 'seg', dataset: { mode: 'erase' }, onclick: (event) => { erasing = true; for (const b of event.currentTarget.parentElement.children)
                b.classList.toggle('on', b === event.currentTarget); } }, '擦除')), brushInput, sizeLabel, btn('清空', { kind: 'quiet', onclick: () => {
                dataCtx.fillStyle = '#000';
                dataCtx.fillRect(0, 0, mask.width, mask.height);
                repaint();
                onChange?.(mask);
            } }));
        let drawing = false;
        function point(event) {
            const rect = display.getBoundingClientRect();
            return {
                x: (event.clientX - rect.left) * (display.width / rect.width),
                y: (event.clientY - rect.top) * (display.height / rect.height),
                scale: display.width / rect.width
            };
        }
        function draw(event) {
            if (!drawing)
                return;
            const { x, y, scale } = point(event);
            const radius = Math.max(1, (brush / 2) * scale);
            dataCtx.fillStyle = erasing ? '#000' : '#fff';
            dataCtx.beginPath();
            dataCtx.arc(x, y, radius, 0, Math.PI * 2);
            dataCtx.fill();
            repaint();
            onChange?.(mask);
        }
        display.addEventListener('pointerdown', (event) => { drawing = true; display.setPointerCapture(event.pointerId); draw(event); });
        display.addEventListener('pointermove', draw);
        display.addEventListener('pointerup', () => { drawing = false; });
        display.addEventListener('pointercancel', () => { drawing = false; });
        display.addEventListener('pointerleave', () => { drawing = false; });
        repaint();
        return {
            node: h('div', { class: 'mask-wrap' }, wrap, tools, h('p', { class: 'field-hint' }, '红色区域 = 只重绘这里；没涂到的地方会保持原样。')),
            mask
        };
    }
    function inputBlock(input) {
        const box = h('div', { class: 'flow-input' });
        if (input.type === 'image') {
            const drop = imageDrop({
                label: input.label,
                hint: input.hint || 'PNG / JPG / WebP',
                onChange: (canvas) => {
                    images[input.id] = canvas;
                    if (input.id === 'base') {
                        rebuildMask(canvas);
                    }
                    refresh();
                }
            });
            box.append(h('div', { class: 'flow-input-head' }, h('span', { class: 'field-label' }, input.label), input.required ? badge('必填', 'warn') : null), drop.node);
            return box;
        }
        if (input.type === 'mask') {
            const slot = h('div', { class: 'mask-slot' }, h('p', { class: 'muted small' }, '先上传原图，然后在上图涂抹。'));
            box.append(h('div', { class: 'flow-input-head' }, h('span', { class: 'field-label' }, input.label), badge('必填', 'warn')), slot);
            box._maskSlot = slot;
            return box;
        }
        return box;
    }
    const inputNodes = [];
    function rebuildMask(baseCanvas) {
        const slotNode = inputNodes.find((node) => node._maskSlot)?._maskSlot;
        if (!slotNode)
            return;
        clear(slotNode);
        const editor = createMaskEditor(baseCanvas, () => refresh());
        images.mask = editor.mask;
        slotNode.append(editor.node);
    }
    function fieldNode(field) {
        if (field.type === 'select')
            return select({ label: field.label, value: values[field.id], options: field.options, onChange: (value) => { values[field.id] = value; refresh(); } });
        if (field.type === 'textarea')
            return textArea({ label: field.label, value: values[field.id], rows: field.rows || 3, placeholder: field.placeholder, onInput: (value) => { values[field.id] = value; refresh(); } });
        if (field.type === 'text')
            return textInput({ label: field.label, value: values[field.id], placeholder: field.placeholder, onInput: (value) => { values[field.id] = value; refresh(); } });
        if (field.type === 'range')
            return range({ label: field.label, min: field.min, max: field.max, step: field.step, value: values[field.id], suffix: field.suffix, hint: field.hint, onInput: (value) => { values[field.id] = value; refresh(); } });
        if (field.type === 'toggle')
            return toggle({ label: field.label, value: values[field.id], hint: field.hint, onChange: (value) => { values[field.id] = value; refresh(); } });
        return null;
    }
    const promptPanel = panel('提示词预览', '可直接修改完整提示词，提交时使用下方内容。', promptBox, promptStatus, actionRow(btn('复制提示词', { kind: 'quiet', onclick: async () => { await copyText(promptBox.value); toast('提示词已复制'); } }), btn('按参数重建提示词', { kind: 'quiet', onclick: () => { promptEdited = false; refresh(); } }), btn('提交生成任务', { kind: 'primary', onclick: submit, id: 'flow-submit' })), h('p', { class: 'muted small' }, '提交后到任务中心复制交接指令，让当前聊天执行生图，再把结果回填。'));
    function build() {
        const payload = flow.build(values);
        const prompt = promptBox.value.trim();
        if (!prompt) throw new Error('请填写提示词后再提交。');
        return { ...payload, prompt: promptBox.value };
    }
    function refresh() {
        if (promptEdited) {
            promptStatus.textContent = '参数已更新，手动提示词保持不变；需要套用新参数时，点击“按参数重建提示词”。';
            return;
        }
        promptBox.value = flow.build(values).prompt;
        promptStatus.textContent = '提示词随参数更新，也可以直接在上方编辑。';
    }
    async function submit(event) {
        const button = event.currentTarget;
        const required = flow.inputs.filter((input) => input.required);
        for (const input of required) {
            if (!images[input.id]) {
                toast(`请先上传${input.label}`, 'error');
                return;
            }
        }
        button.disabled = true;
        try {
            const payload = build();
            const refs = flow.inputs.filter((input) => input.type === 'image' || input.type === 'mask').map((input) => images[input.id]).filter(Boolean);
            const task = await api.createTask({
                prompt: payload.prompt, size: payload.size, transparent: payload.transparent,
                images: refs.map((canvas) => canvasToDataURL(canvas)), source: `flow:${flow.id}`
            });
            const automatic=(await api.settings()).settings?.autoGenerateImages===true;
            if(automatic)toast('已提交 ChatGPT 自动生图，完成后自动回填并显示。');
            else if (autoCopy) {
                try {
                    await copyText(await api.instruction(task.id));
                    toast('任务已创建，交接指令已复制。');
                }
                catch {
                    toast('任务已创建；剪贴板不可用，请在任务卡中手动复制指令。', 'warn');
                }
            }
            else
                toast('任务已创建，可在任务卡中复制交接指令。');
            taskStore.load(true);
            paintTasks();
        }
        catch (error) {
            toast(error.message, 'error');
        }
        finally {
            button.disabled = false;
        }
    }
    /* ── 批量队列 ───────────────────────────────────── */
    async function createBatch(event) {
        const button = event.currentTarget;
        for (const input of flow.inputs.filter((item) => item.required)) {
            if (!images[input.id]) {
                toast(`请先上传${input.label}`, 'error');
                return;
            }
        }
        const count = Math.max(2, Math.min(8, Number(batchState.count?.value) || 3));
        const originalLabel = button.textContent;
        button.disabled = true;
        try {
            const payload = build();
            const refs = flow.inputs
                .filter((input) => input.type === 'image' || input.type === 'mask')
                .map((input) => images[input.id]).filter(Boolean)
                .map((canvas) => canvasToDataURL(canvas));
            const created = [];
            for (let index = 1; index <= count; index++) {
                button.textContent = `创建 ${index}/${count}…`;
                const extra = batchMode === 'variants'
                    ? `\n\n【批量第 ${index}/${count} 张】保持主题、画风、角色设计与配色一致，但在这前提下做出可以区分的细节变化（构图、角度、光照或小道具），不要和本批其它张重复。`
                    : `\n\n【批量第 ${index}/${count} 张】按同一提示词再生成一张。`;
                const task = await api.createTask({
                    prompt: payload.prompt + extra, size: payload.size, transparent: payload.transparent,
                    images: refs, source: `flow:${flow.id}`
                });
                created.push(task.id);
            }
            batchIds = [...created, ...batchIds].slice(0, 40);
            saveBatchIds();
            toast(`已创建 ${created.length} 条批量任务，逐张生成后再回填。`);
            taskStore.load(true);
            paintBatch();
        }
        catch (error) {
            toast(error.message, 'error');
        }
        finally {
            button.disabled = false;
            button.textContent = originalLabel;
        }
    }
    async function copyAllInstructions() {
        const waiting = batchTasks().filter((task) => task.status === 'waiting');
        if (!waiting.length) {
            toast('没有待回填的批量任务');
            return;
        }
        const parts = [];
        for (const [index, task] of waiting.entries()) {
            parts.push(`===== 批量任务 ${index + 1}/${waiting.length}（${task.id.slice(0, 8)}） =====\n${await api.instruction(task.id)}`);
        }
        await copyText(parts.join('\n\n'));
        toast(`已复制 ${waiting.length} 条交接指令`);
    }
    function backfillAll() {
        const waiting = batchTasks().filter((task) => task.status === 'waiting');
        if (!waiting.length)
            return;
        const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true });
        input.addEventListener('change', async () => {
            const files = [...input.files];
            input.remove();
            if (!files.length)
                return;
            let ok = 0;
            for (const [index, file] of files.slice(0, waiting.length).entries()) {
                try {
                    await api.completeTask(waiting[index].id, await fileToDataURL(file));
                    ok += 1;
                }
                catch (error) {
                    toast(`第 ${index + 1} 张回填失败：${error.message}`, 'error');
                }
            }
            toast(`已回填 ${ok} 张`);
            taskStore.load(true);
            paintBatch();
        });
        document.body.append(input);
        input.click();
    }
    async function cancelAll() {
        const waiting = batchTasks().filter((task) => task.status === 'waiting');
        if (!waiting.length)
            return;
        for (const task of waiting) {
            try {
                await api.cancelTask(task.id);
            }
            catch { /* 已结束的忽略 */ }
        }
        toast(`已取消 ${waiting.length} 条未完成任务`);
        taskStore.load(true);
        paintBatch();
    }
    function clearBatch() {
        batchIds = [];
        saveBatchIds();
        paintBatch();
        toast('队列已清空（任务本身仍在任务中心）');
    }
    async function toRig(task) {
        try {
            toast('正在创建骨骼任务并导入拆件图…');
            const jobId = await sendTaskToRig(task);
            if (typeof openDeepLink === 'function')
                openDeepLink(rigDeepLink(jobId));
            else
                location.hash = '/tool/rig';
            toast('已送入骨骼装配，正在打开拆件阶段。');
        }
        catch (error) {
            toast(error.message, 'error');
        }
    }
    function paintBatch() {
        if (!batchState.list)
            return;
        const tasks = batchTasks();
        const done = tasks.filter((task) => task.status === 'completed').length;
        const waiting = tasks.filter((task) => task.status === 'waiting').length;
        batchState.progressText.textContent = tasks.length ? `${done}/${tasks.length} 已完成 · ${waiting} 待回填` : '还没有批量任务';
        batchState.progressBar.style.width = tasks.length ? `${Math.round((done / tasks.length) * 100)}%` : '0%';
        clear(batchState.list);
        for (const [index, task] of tasks.entries()) {
            const status = statusOf(task);
            const row = h('div', { class: 'batch-row' }, h('span', { class: 'batch-no' }, `#${index + 1}`), badge(status.label, status.tone), h('span', { class: 'batch-text', title: task.prompt }, task.prompt.split('\n')[0].slice(0, 48)));
            if (task.status === 'waiting') {
                row.append(btn('复制', { kind: 'quiet', onclick: async () => { await copyText(await api.instruction(task.id)); toast('已复制'); } }), btn('取消', { kind: 'danger-quiet', onclick: async () => { await api.cancelTask(task.id).catch(() => { }); taskStore.load(true); paintBatch(); } }));
            }
            else if (task.status === 'completed' && task.result) {
                row.append(h('a', { class: 'btn btn-small', href: api.resultUrl(task), target: '_blank', rel: 'noopener' }, '查看'));
                if (flow.id === 'split' && typeof openDeepLink === 'function') {
                    row.append(btn('送骨骼', { kind: 'quiet', onclick: () => toRig(task) }));
                }
            }
            batchState.list.append(row);
        }
        batchState.copyAll.disabled = !waiting;
        batchState.backfillAll.disabled = !waiting;
        batchState.cancelAll.disabled = !waiting;
        batchState.clear.disabled = !tasks.length;
    }
    function buildBatchPanel() {
        const count = h('input', { type: 'number', min: '2', max: '8', step: '1', value: '3', 'aria-label': '批量数量' });
        const mode = h('select', { 'aria-label': '批量模式' }, h('option', { value: 'variants' }, '每条做可区分的变体'), h('option', { value: 'same' }, '同一提示词重复'));
        mode.addEventListener('change', () => { batchMode = mode.value; });
        const progressText = h('p', { class: 'muted small' }, '还没有批量任务');
        const progressBar = h('i');
        const list = h('div', { class: 'batch-list' });
        batchState.count = count;
        batchState.list = list;
        batchState.progressText = progressText;
        batchState.progressBar = progressBar;
        batchState.copyAll = btn('复制全部指令', { kind: 'quiet', onclick: copyAllInstructions });
        batchState.backfillAll = btn('回填全部', { onclick: backfillAll });
        batchState.cancelAll = btn('取消未完成', { kind: 'danger-quiet', onclick: cancelAll });
        batchState.clear = btn('清空队列', { kind: 'quiet', onclick: clearBatch });
        return h('section', { class: 'panel batch-panel' }, h('div', { class: 'panel-head' }, h('h2', null, '批量队列'), h('p', null, '一次建多条任务，逐张生成、批量回填；队列记录在本机浏览器。')), h('div', { class: 'batch-controls' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, '数量'), count), h('label', { class: 'field' }, h('span', { class: 'field-label' }, '模式'), mode)), btn('创建批量任务', { kind: 'primary', onclick: createBatch }), h('div', { class: 'batch-progress' }, progressBar), progressText, list, h('div', { class: 'batch-actions' }, batchState.copyAll, batchState.backfillAll, batchState.cancelAll, batchState.clear));
    }
    function paintTasks() {
        paintBatch();
        clear(taskArea);
        const tasks = taskStore.bySource(`flow:${flow.id}`).slice(0, 6);
        if (!tasks.length)
            return;
        taskArea.append(h('h3', { class: 'flow-task-title' }, '这个流程的任务'));
        for (const task of tasks) {
            const status = statusOf(task);
            const row = h('article', { class: 'flow-task' }, h('div', { class: 'flow-task-head' }, badge(status.label, status.tone), h('span', { class: 'muted small' }, formatDate(task.createdAt)), h('code', { class: 'task-id' }, task.id.slice(0, 8))), h('p', { class: 'muted small' }, task.prompt.split('\n')[0].slice(0, 100)));
            if (task.status === 'completed' && task.result) {
                const url = api.resultUrl(task);
                row.append(h('div', { class: 'flow-task-result' }, h('a', { href: url, target: '_blank', rel: 'noopener' }, h('img', { src: url, alt: '结果', loading: 'lazy' }))));
                const doneActions = actionRow(btn('下载结果', { kind: 'quiet', onclick: () => download(url, `flow-${flow.id}-${task.id.slice(0, 8)}.png`) }));
                if (flow.id === 'split' && typeof openDeepLink === 'function') {
                    doneActions.append(btn('送入骨骼装配', { kind: 'primary', onclick: () => toRig(task) }));
                }
                row.append(doneActions);
            }
            else if (task.status === 'waiting') {
                const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
                input.addEventListener('change', async () => {
                    if (!input.files[0])
                        return;
                    try {
                        await api.completeTask(task.id, await fileToDataURL(input.files[0]));
                        toast('回填完成');
                        taskStore.load(true);
                        paintTasks();
                    }
                    catch (error) {
                        toast(error.message, 'error');
                    }
                });
                row.append(actionRow(btn('复制交接指令', { kind: 'quiet', onclick: async () => { await copyText(await api.instruction(task.id)); toast('已复制交接指令'); } }), h('span', { class: 'inline-upload' }, input, btn('回填结果', { onclick: () => input.click() })), btn('取消', { kind: 'danger-quiet', onclick: async () => { await api.cancelTask(task.id); taskStore.load(true); paintTasks(); } })));
            }
            taskArea.append(row);
        }
    }
    /* 组装页面 */
    const inputPanel = panel('输入', '参考图会随任务一起写入本地任务目录。', ...flow.inputs.map((input) => { const node = inputBlock(input); inputNodes.push(node); return node; }));
    const optionPanel = panel('选项', '提示词默认随参数更新；手动编辑后保留你的内容。', ...flow.fields.map(field => { const node = fieldNode(field); if (node)
        node.dataset.field = field.id; return node; }));
    optionPanel.addEventListener('input', () => optionsDirty = true);
    optionPanel.addEventListener('change', () => optionsDirty = true);
    void api.settings().then(result => {
        if (!alive)
            return;
        autoCopy = result.settings?.autoCopyHandoff !== false;
        const size = result.settings?.defaultSize, control = optionPanel.querySelector('[data-field=size] select');
        if (!optionsDirty && size && control && [...control.options].some(option => option.value === size)) {
            values['size'] = size;
            control.value = size;
            refresh();
        }
    }).catch(() => { });
    const guide = h('div', { class: 'flow-guide' }, h('h3', null, '怎么用'), h('ol', null, ...flow.guide.map((line) => h('li', null, line))), h('p', { class: 'muted small' }, `参考来源：${flow.source}`));
    container.append(h('div', { class: 'flow-layout' }, h('div', { class: 'flow-col' }, inputPanel, guide), h('div', { class: 'flow-col' }, optionPanel, promptPanel), h('div', { class: 'flow-col' }, buildBatchPanel(), taskArea)));
    const unsubscribe = taskStore.subscribe(paintTasks);
    refresh();
    paintTasks();
    return () => { alive = false; unsubscribe(); };
}
