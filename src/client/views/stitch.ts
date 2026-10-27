import { h, toast, copyText } from '../lib/dom.js';
import { api, taskStore, withBase } from '../lib/api.js';
import { createCanvas, loadImageFromFile, loadImageFromUrl, canvasToBlob } from '../lib/canvas.js';
import { exportBlob, loadZip, loadPsd } from '../lib/export.js';
import { MapChunk, MapLayer, StitchSettings, stride, chunkKey, mapBounds, drawMap, composeMap, expansionReferences, frontier } from '../lib/stitch.js';
import { panel, btn, actionRow, fileDrop } from './kit.js';
export function mountStitch(container: HTMLElement, { navigate }: any) {
    let chunks: MapChunk[] = [], pending: any[] = [], settings: StitchSettings = { width: 512, height: 512, overlapX: .15, overlapY: .15 }, projectId = '', selected = { x: 0, y: 0 }, busy = false, receiving = false, autoLeft = 0, zoom = 1;
    let viewBox = { left: 0, top: 0, scale: 1 }, history: any[] = [], alive = true;
    let autoLayer: MapLayer = 'whole';
    const scope = api.health().then(info => info.workspace.id);
    const name = h('input', { type: 'text', value: '新地图', 'aria-label': '地图名称' }), projects = h('select', { 'aria-label': '已保存地图' });
    const mode = h('select', { 'aria-label': '地图视角' }, h('option', { value: 'topdown' }, '俯视 topdown'), h('option', { value: 'isometric' }, '45° 等距'), h('option', { value: 'side' }, '横版侧视'));
    const layer = h('select', { 'aria-label': '当前地图图层' }, ...['composite', 'whole', 'ground', 'objects', 'mask'].map((id, i) => h('option', { value: id }, ['整体预览', '整体层', '地表层', '物件层', '物件黑白蒙版'][i])));
    const xOverlap = h('input', { type: 'number', min: 0, max: 45, step: 1, value: 15, 'aria-label': '左右重叠百分比' }), yOverlap = h('input', { type: 'number', min: 0, max: 45, step: 1, value: 15, 'aria-label': '上下重叠百分比' });
    const steps = h('input', { type: 'number', min: 1, max: 16, value: 4, 'aria-label': '自动扩图块数' }), parallel = h('select', { 'aria-label': '同时等待生成数量' }, ...[1, 2, 4].map(n => h('option', { value: n }, `${n} 块`)));
    const prompt = h('textarea', { 'aria-label': '地图扩展要求', rows: 2, placeholder: '例如：向森林深处延续道路，保持地形高度和光源一致' });
    const divisions = h('select', { 'aria-label': '导出细分数' }, ...[[1, '不细分'], [2, '4 分块（2×2）'], [3, '9 分块（3×3）']].map(([value, label]) => h('option', { value }, label)));
    const canvas = createCanvas(900, 600), stage = h('div', { class: 'stitch-stage', tabindex: 0, 'aria-label': '地图拼接画布' }, canvas), status = h('p', { class: 'stage-info', role: 'status' }), taskList = h('div', { class: 'stitch-task-list' });
    canvas.dataset.testid = 'stitch-canvas';
    const field = (label: string, node: any) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), node);
    const targetLayer = (): MapLayer => ['ground', 'objects'].includes(layer.value) ? layer.value : 'whole';
    const occupied = () => new Set([...chunks, ...pending].map(c => chunkKey(c.x, c.y, c.layer)));
    const state = () => ({ format: 'game-workbench-stitch', version: 1, name: name.value.trim() || '新地图', mode: mode.value, settings, chunks: chunks.map(({ canvas, ...c }) => ({ ...c, source: canvas.toDataURL('image/png') })), pending });
    const remember = () => {
        history.push({ chunks: chunks.slice(), pending: pending.slice(), settings: { ...settings } });
        if (history.length > 20)
            history.shift();
    };
    async function request(path: string, body?: any) {
        const workspaceId = await scope;
        if (!alive)
            throw new Error('工作区已切换');
        const r = await fetch(withBase(path) + '?workspaceId=' + encodeURIComponent(workspaceId), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, workspaceId }) } : {});
        const value = await r.json();
        if (!r.ok)
            throw new Error(value.error?.message || value.error || '地图接口失败');
        return value;
    }
    async function refreshProjects() { const rows = await request('/api/map-projects'); projects.replaceChildren(h('option', { value: '' }, '选择已保存地图'), ...rows.map(r => h('option', { value: r.id }, `${r.name} · ${r.chunks} 块`))); projects.value = projectId; }
    async function save() { const info = await request('/api/map-projects', { id: projectId || undefined, state: state() }); projectId = info.id; await refreshProjects(); return info; }
    async function act(fn: () => Promise<void> | void) {
        if (busy || receiving)
            return;
        busy = true;
        try {
            await fn();
        }
        catch (e: any) {
            autoLeft = 0;
            toast(e.message, 'error');
        }
        finally {
            busy = false;
            render();
        }
    }
    function render() {
        const candidates = chunks.length ? frontier(chunks, occupied(), targetLayer()).filter(c => Math.abs(c.x) <= 64 && Math.abs(c.y) <= 64) : [{ x: 0, y: 0 }];
        const points = [...chunks, ...candidates];
        const step = stride(settings), minX = Math.min(...points.map(c => c.x)), maxX = Math.max(...points.map(c => c.x)), minY = Math.min(...points.map(c => c.y)), maxY = Math.max(...points.map(c => c.y));
        const width = (maxX - minX) * step.x + settings.width, height = (maxY - minY) * step.y + settings.height, scale = Math.min(1, 1400 / width, 1000 / height);
        canvas.width = Math.max(1, Math.ceil(width * scale));
        canvas.height = Math.max(1, Math.ceil(height * scale));
        canvas.style.width = canvas.width * zoom + 'px';
        canvas.style.height = canvas.height * zoom + 'px';
        viewBox = { left: minX * step.x, top: minY * step.y, scale };
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        ctx.scale(scale, scale);
        ctx.translate(-viewBox.left, -viewBox.top);
        if (layer.value === 'mask' && chunks.length) {
            const out = composeMap(chunks, settings, 'mask');
            ctx.drawImage(out.canvas, out.bounds.left, out.bounds.top);
        }
        else
            drawMap(ctx, chunks, settings, layer.value);
        for (const c of candidates) {
            ctx.strokeStyle = '#7c9cff';
            ctx.lineWidth = 2 / scale;
            ctx.setLineDash([7 / scale, 5 / scale]);
            ctx.strokeRect(c.x * step.x, c.y * step.y, settings.width, settings.height);
        }
        ctx.setLineDash([]);
        ctx.strokeStyle = '#b9f6cb';
        ctx.lineWidth = 3 / scale;
        ctx.strokeRect(selected.x * step.x, selected.y * step.y, settings.width, settings.height);
        status.textContent = `${chunks.length} 个地图层块 · 内存约 ${Math.round(chunks.reduce((s, c) => s + c.canvas.width * c.canvas.height * 4, 0) / 1048576)} MB · 单格 ${settings.width}×${settings.height} · 选中 (${selected.x}, ${selected.y}) · 等待 ${pending.length} · 自动队列剩余 ${autoLeft} · ${busy ? '处理中' : '未保存修改请保存工程'}`;
        taskList.replaceChildren(...pending.map(p => {
            const t = taskStore.tasks.find(t => t.id === p.taskId);
            return h('div', { class: 'pack-row' }, h('span', null, `(${p.x},${p.y}) ${p.layer} · ${t?.status || '等待读取任务'}`), btn('复制扩图指令', { onclick: async () => {
                    try {
                        await copyText(await api.instruction(p.taskId));
                        toast('已复制扩图任务指令');
                    }
                    catch (e: any) {
                        toast(e.message, 'error');
                    }
                } }), btn('解除关联', { onclick: () => { if(busy||receiving)return toast('正在处理地图，请稍后解除关联','warn'); autoLeft = 0; pending = pending.filter(v => v !== p); void save().catch(e => toast(e.message, 'error')); render(); } }));
        }));
    }
    canvas.onclick = (event: MouseEvent) => { const r = canvas.getBoundingClientRect(), step = stride(settings), x = (event.clientX - r.left) / r.width * canvas.width / viewBox.scale + viewBox.left, y = (event.clientY - r.top) / r.height * canvas.height / viewBox.scale + viewBox.top; selected = { x: Math.round((x - settings.width / 2) / step.x), y: Math.round((y - settings.height / 2) / step.y) }; render(); };
    let drag: any = null;
    canvas.oncontextmenu = e => e.preventDefault();
    stage.onpointerdown = e => {
        if (e.button === 1 || e.button === 2) {
            e.preventDefault();
            drag = { x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop };
            stage.setPointerCapture(e.pointerId);
        }
    };
    stage.onpointermove = e => {
        if (drag) {
            stage.scrollLeft = drag.left - (e.clientX - drag.x);
            stage.scrollTop = drag.top - (e.clientY - drag.y);
        }
    };
    stage.onpointerup = () => drag = null;
    stage.addEventListener('wheel', (e: WheelEvent) => { e.preventDefault(); const r = stage.getBoundingClientRect(), px = e.clientX - r.left + stage.scrollLeft, py = e.clientY - r.top + stage.scrollTop, old = zoom; zoom = Math.max(.25, Math.min(4, zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); render(); stage.scrollLeft = px * zoom / old - (e.clientX - r.left); stage.scrollTop = py * zoom / old - (e.clientY - r.top); }, { passive: false });
    layer.onchange = () => {
        try {
            render();
        }
        catch (e: any) {
            toast(e.message, 'error');
            layer.value = 'composite';
            render();
        }
    };
    async function canvasFromFile(file: File) { const image = await loadImageFromFile(file), out = createCanvas(settings.width, settings.height); out.getContext('2d')!.imageSmoothingEnabled = false; out.getContext('2d')!.drawImage(image, 0, 0, out.width, out.height); return out; }
    const upload = fileDrop({ label: '导入地图到选中格', accept: 'image/png,image/jpeg,image/webp', onFiles: (files: File[]) => act(async () => {
            if (pending.length)
                throw new Error('先完成扩图或解除关联后导入');
            const image = await loadImageFromFile(files[0]);
            if (image.width * image.height > 8 * 1024 * 1024 || image.width > 4096 || image.height > 4096)
                throw new Error('单格最多 800 万像素，单边不超过 4096');
            remember();
            if (!chunks.length) {
                settings.width = image.width;
                settings.height = image.height;
                selected = { x: 0, y: 0 };
            }
            if (chunks.length >= 64 || settings.width * settings.height * (chunks.length + 1) > 64 * 1024 * 1024)
                throw new Error('地图超过 64 块或 6400 万像素内存保护上限');
            const c = await canvasFromFile(files[0]), l = targetLayer();
            chunks = chunks.filter(v => chunkKey(v.x, v.y, v.layer) !== chunkKey(selected.x, selected.y, l));
            chunks.push({ ...selected, layer: l, canvas: c });
            if (image.width !== settings.width || image.height !== settings.height)
                toast('图片已缩放为当前地图单格尺寸', 'warn');
            await save();
        }) });
    async function loadState(data: any) {
        if (data?.format !== 'game-workbench-stitch' || data.version !== 1 || !Array.isArray(data.chunks) || data.chunks.length > 64 || !Array.isArray(data.pending) || data.pending.length > 32)
            throw new Error('不是工作台地图状态文件');
        stride(data.settings);
        if(data.chunks.length+data.pending.length>64||data.settings.width*data.settings.height*(data.chunks.length+data.pending.length)>64*1024*1024)throw new Error('地图超过内存保护上限');
        if (!['topdown', 'isometric', 'side'].includes(data.mode) || typeof data.name !== 'string' || data.name.length > 80)
            throw new Error('地图状态参数无效');
        const next: MapChunk[] = [], seen = new Set();
        let pixels = 0;
        for (const item of [...data.chunks, ...data.pending]) {
            const key = chunkKey(item.x, item.y, item.layer);
            if (!Number.isInteger(item.x) || !Number.isInteger(item.y) || Math.abs(item.x) > 64 || Math.abs(item.y) > 64 || !['whole', 'ground', 'objects'].includes(item.layer) || seen.has(key))
                throw new Error('地图坐标重复或无效');
            seen.add(key);
        }
        for (const item of data.chunks) {
            if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(item.source))
                throw new Error('仅支持内嵌 PNG');
            const image = await loadImageFromUrl(item.source);
            pixels += image.width * image.height;
            if (pixels > 64 * 1024 * 1024 || image.width !== data.settings.width || image.height !== data.settings.height)
                throw new Error('地图像素量或单格尺寸不一致');
            const out = createCanvas(image.width, image.height);
            out.getContext('2d')!.drawImage(image, 0, 0);
            next.push({ x: item.x, y: item.y, layer: item.layer, canvas: out });
        }
        if (data.pending.some(p => !/^[-a-f0-9]{36}$/.test(p.taskId)))
            throw new Error('扩图任务编号无效');
        autoLeft = 0;
        chunks = next;
        pending = data.pending;
        settings = { ...data.settings };
        name.value = data.name;
        mode.value = data.mode;
        layer.value = 'composite';
        xOverlap.value = Math.round(settings.overlapX * 100);
        yOverlap.value = Math.round(settings.overlapY * 100);
        history = [];
        selected = { x: 0, y: 0 };
        render();
    }
    const stateInput = h('input', { type: 'file', accept: '.json,.zip', hidden: true, 'aria-label': '导入地图状态或工作台引擎包', onchange: (e: Event) => act(async () => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file)
                return;
            if (file.size > 64 * 1024 * 1024)
                throw new Error('状态文件超过 64 MB');
            let data;
            if (file.name.endsWith('.zip')) {
                const Zip = await loadZip(), zip = await Zip.loadAsync(file), entry = zip.file('map-state.json');
                if (!entry || entry._data?.uncompressedSize > 64 * 1024 * 1024)
                    throw new Error('包中没有可读取的 map-state.json；仅支持本工作台状态包和引擎包');
                data = JSON.parse(await entry.async('string'));
            }
            else
                data = JSON.parse(await file.text());
            await loadState(data);
            projectId = '';
            await save();
        }) });
    async function createExpansion(x: number, y: number, l: MapLayer = targetLayer()) {
        if (chunks.length + pending.length >= 64 || settings.width * settings.height * (chunks.length + pending.length + 1) > 64 * 1024 * 1024)
            throw new Error('地图超过 64 块或 6400 万像素内存保护上限');
        if (occupied().has(chunkKey(x, y, l)))
            throw new Error('目标格已有地图或等待任务');
        if (Math.abs(x) > 64 || Math.abs(y) > 64)
            throw new Error('地图坐标超出范围');
        const ref = expansionReferences(chunks, settings, x, y, l);
        await save();
        const task = await api.createTask({ workspaceId: await scope, prompt: `地图无缝扩展。视角：${mode.value}。目标单格 (${x}, ${y})，图层 ${l}，输出 ${settings.width}×${settings.height}。参考图1为目标格已有相邻边缘，参考图2白色为需要补绘的区域、黑色为必须保留的边缘，参考图3为原始地图风格。保持边缘像素、透视、比例、道路连接、光源和材质一致，仅补绘空白。${l === 'objects' ? '仅绘制独立建筑、树木等物件，透明背景，不画地面。' : '地图需覆盖完整画布，无边框。'}${prompt.value} 不要文字、水印或格线。`, size: '1024x1024', transparent: l === 'objects', images: [ref.context.toDataURL(), ref.mask.toDataURL(), ref.anchor.toDataURL()], source: `stitch:${projectId}:${l}:${x}:${y}` });
        pending.push({ x, y, layer: l, taskId: task.id });
        await save();
        await taskStore.load(true);
    }
    async function pump() {
        if (busy || receiving || !autoLeft)
            return;
        await act(async () => {
            while (autoLeft > 0 && pending.length < Number(parallel.value)) {
                const candidate = frontier(chunks, occupied(), autoLayer).find(c => Math.abs(c.x) <= 64 && Math.abs(c.y) <= 64);
                if (!candidate)
                    break;
                await createExpansion(candidate.x, candidate.y, autoLayer);
                autoLeft--;
            }
        });
    }
    async function receive() {
        if (receiving || busy)
            return;
        receiving = true;
        try {
            for (const p of pending.slice()) {
                const task = taskStore.tasks.find(t => t.id === p.taskId);
                if (task?.result && task.status === 'completed') {
                    const image = await loadImageFromUrl(api.resultUrl(task)), out = createCanvas(settings.width, settings.height);
                    out.getContext('2d')!.imageSmoothingEnabled = false;
                    out.getContext('2d')!.drawImage(image, 0, 0, out.width, out.height);
                    chunks.push({ x: p.x, y: p.y, layer: p.layer, canvas: out });
                    pending = pending.filter(v => v !== p);
                    if (image.width !== settings.width || image.height !== settings.height)
                        toast('扩图结果已按单格尺寸规整', 'warn');
                    await save();
                }
                else if (task && ['cancelled', 'expired', 'interrupted'].includes(task.status)) {
                    autoLeft = 0;
                }
            }
            render();
        }
        catch (e: any) {
            autoLeft = 0;
            toast(e.message, 'error');
        }
        finally {
            receiving = false;
            void pump();
        }
    }
    async function exportZip(engine = 'state') {
        if (!chunks.length)
            throw new Error('请先导入地图');
        const Zip = await loadZip(), zip = new Zip(), step = stride(settings), bounds = mapBounds(chunks, settings), manifest: any = { format: 'game-workbench-map', version: 1, settings, mode: mode.value, bounds, chunks: [] };
        const sorted = [...chunks].sort((a, b) => ['whole', 'ground', 'objects'].indexOf(a.layer) - ['whole', 'ground', 'objects'].indexOf(b.layer) || a.y - b.y || a.x - b.x);
        for (const [i, c] of sorted.entries()) {
            const file = `maps/chunk-${i}.png`;
            zip.file(file, await canvasToBlob(c.canvas));
            manifest.chunks.push({ file, x: c.x * step.x, y: c.y * step.y, layer: c.layer, width: settings.width, height: settings.height });
            if (engine === 'unity')
                zip.file(`Assets/Resources/WorkbenchMap/chunk-${i}.png`, await canvasToBlob(c.canvas));
        }
        const n = Number(divisions.value);
        for (const [i, c] of chunks.entries())
            for (let y = 0; y < n; y++)
                for (let x = 0; x < n; x++) {
                    const x0 = Math.floor(x * settings.width / n), y0 = Math.floor(y * settings.height / n), w = Math.floor((x + 1) * settings.width / n) - x0, hh = Math.floor((y + 1) * settings.height / n) - y0;
                    if (!w || !hh)
                        continue;
                    const out = createCanvas(w, hh);
                    out.getContext('2d')!.drawImage(c.canvas, x0, y0, w, hh, 0, 0, w, hh);
                    zip.file(`split/chunk-${i}-${x}-${y}.png`, await canvasToBlob(out));
                }
        zip.file('map-state.json', JSON.stringify(state()));
        zip.file('manifest.json', JSON.stringify(manifest, null, 2));
        if (engine === 'godot') {
            zip.file('project.godot', 'config_version=5\n[application]\nconfig/name="Workbench Map"\nrun/main_scene="res://Map.tscn"\n[display]\nwindow/size/viewport_width=1280\nwindow/size/viewport_height=720\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
            const lines = ['[gd_scene load_steps=' + String(chunks.length + 1) + ' format=3]', ...manifest.chunks.map((c, i) => `[ext_resource type="Texture2D" path="res://${c.file}" id="${i + 1}"]`), '[node name="Map" type="Node2D"]', '[node name="Camera2D" type="Camera2D" parent="."]', `position = Vector2(${bounds.left + bounds.width / 2},${bounds.top + bounds.height / 2})`, `zoom = Vector2(${Math.min(1, 1200 / bounds.width, 650 / bounds.height)},${Math.min(1, 1200 / bounds.width, 650 / bounds.height)})`];
            manifest.chunks.forEach((c, i) => lines.push(`[node name="Chunk${i}" type="Sprite2D" parent="."]`, `position = Vector2(${c.x},${c.y})`, 'centered = false', 'texture_filter = 1', `z_index = ${c.layer === 'objects' ? 2 : c.layer === 'ground' ? 1 : 0}`, `texture = ExtResource("${i + 1}")`));
            zip.file('Map.tscn', lines.join('\n'));
        }
        if (engine === 'unity') {
            const lines = manifest.chunks.map((c, i) => `Add("chunk-${i}",${c.x},${c.y},${c.layer === 'objects' ? 2 : c.layer === 'ground' ? 1 : 0});`).join('\n');
            zip.file('Assets/WorkbenchMapLoader.cs', `using UnityEngine;\npublic class WorkbenchMapLoader:MonoBehaviour { void Start(){${lines}} void Add(string n,float x,float y,int order){var t=Resources.Load<Texture2D>("WorkbenchMap/"+n);if(t==null)return;t.filterMode=FilterMode.Point;var g=new GameObject(n);g.transform.SetParent(transform,false);g.transform.localPosition=new Vector3(x/100f,-y/100f,0);var r=g.AddComponent<SpriteRenderer>();r.sprite=Sprite.Create(t,new Rect(0,0,t.width,t.height),new Vector2(0,1),100);r.sortingOrder=order;} }`);
        }
        zip.file('README.md', engine === 'godot' ? 'Godot 4：解压后导入 project.godot 运行。包含分层地图场景，不含角色、碰撞或导航。' : engine === 'unity' ? '将 Assets 合入 Unity 项目，把 WorkbenchMapLoader 挂到空物体；配置一个正交相机并运行。图片通过 Texture2D 加载后创建 Sprite。不含碰撞、角色或导航。' : '地图状态与分块文件，map-state.json 可回到工作台继续编辑。');
        await exportBlob(await zip.generateAsync({ type: 'blob' }), `map-${engine}.zip`);
    }
    container.append(panel('地图工程与扩图设置', '点击虚线格选中扩展位置；中键/右键拖动、滚轮缩放。扩图共用工作台生图任务；开启 ChatGPT 自动生图后，生成结果自动接入。', h('div', { class: 'fields' }, field('地图名称', name), field('已保存地图', projects), field('地图视角', mode), field('当前图层', layer)), actionRow(btn('保存地图工程', { onclick: () => act(async () => { await save(); toast('已保存到当前工作区'); }) }), btn('读取地图工程', { onclick: () => act(async () => {
            if (!projects.value)
                throw new Error('请选择地图');
            await loadState(await request('/api/map-projects/' + projects.value));
            projectId = projects.value;
        }) }), btn('新地图', { onclick: () => act(() => {
            if ((chunks.length || pending.length) && !confirm('请确认已保存当前工程。切换新地图不会删除旧工程或生图任务。'))
                return;
            chunks = [];
            pending = [];
            projectId = '';
            autoLeft = 0;
            history = [];
            name.value = '新地图';
            selected = { x: 0, y: 0 };
        }) }), h('a', { class: 'btn', href: withBase('/mapstitch'), target: '_blank', rel: 'noopener' }, '打开旧版 MapStitch 项目')), h('div', { class: 'fields' }, field('左右重叠 %', xOverlap), field('上下重叠 %', yOverlap), field('自动扩图块数', steps), field('同时等待', parallel)), btn('应用重叠设置', { onclick: () => act(() => {
            if (pending.length)
                throw new Error('等待扩图时不能改变重叠');
            const next = { ...settings, overlapX: Number(xOverlap.value) / 100, overlapY: Number(yOverlap.value) / 100 };
            stride(next);
            remember();
            settings = next;
        }) }), field('扩展要求', prompt)), panel('地图画布', '导入图片会保存到当前选中格。不同尺寸会明确提示并规整为单格尺寸；物件层请上传透明图。', upload.node, actionRow(btn('向左选格', { onclick: () => { selected.x--; render(); } }), btn('向右选格', { onclick: () => { selected.x++; render(); } }), btn('向上选格', { onclick: () => { selected.y--; render(); } }), btn('向下选格', { onclick: () => { selected.y++; render(); } }), btn('缩放复位', { onclick: () => { zoom = 1; render(); } }), btn('撤销本地修改', { onclick: () => {
            if (pending.length)
                return toast('等待扩图时不能撤销', 'warn');
            const s = history.pop();
            if (s) {
                chunks = s.chunks;
                settings = s.settings;
                xOverlap.value=Math.round(settings.overlapX*100);yOverlap.value=Math.round(settings.overlapY*100);
                render();
            }
        } })), status, stage, actionRow(btn('手动创建扩图任务', { kind: 'primary', onclick: () => act(async () => { await createExpansion(selected.x, selected.y); toast('扩图任务已创建，请复制指令并回填'); }) }), btn('启动自动扩图队列', { onclick: () => {
            const n = Number(steps.value);
            if (!Number.isInteger(n) || n < 1 || n > 16)
                return toast('自动扩图块数为 1–16', 'error');
            autoLayer = targetLayer();
            autoLeft = n;
            void pump();
        } }), btn('停止自动扩图', { onclick: () => { autoLeft = 0; render(); } }), btn('前往任务中心', { onclick: () => navigate('tasks') })), taskList), panel('状态与导出', '状态包和工作台引擎包可恢复地图。引擎包只含地图，不附送角色、碰撞或第三方素材。物件黑白蒙版根据物件层 alpha 计算，不会自动语义分层。', field('导出细分', divisions), stateInput, actionRow(btn('导出当前层 PNG', { onclick: () => act(async () => { await exportBlob((await canvasToBlob(composeMap(chunks, settings, layer.value).canvas))!, 'stitched-map.png'); }) }), btn('保存完整状态 ZIP', { onclick: () => act(() => exportZip('state')) }), btn('导入状态 / 工作台引擎包', { onclick: () => stateInput.click() }), btn('导出 Godot 地图包', { onclick: () => act(() => exportZip('godot')) }), btn('导出 Unity 地图包', { onclick: () => act(() => exportZip('unity')) }), btn('导出地图 PSD', { onclick: () => act(async () => {
            const output = composeMap(chunks, settings);
            if (output.canvas.width * output.canvas.height > 16 * 1024 * 1024)
                throw new Error('PSD 合成预览最多 1600 万像素');
            const { writePsd } = await loadPsd(), step = stride(settings);
            const children = [...chunks].sort((a, b) => ['whole', 'ground', 'objects'].indexOf(b.layer) - ['whole', 'ground', 'objects'].indexOf(a.layer) || b.y - a.y || b.x - a.x).map(c => ({ name: `${c.layer}_${c.x}_${c.y}`, left: c.x * step.x - output.bounds.left, top: c.y * step.y - output.bounds.top, canvas: c.canvas }));
            await exportBlob(new Blob([writePsd({ width: output.canvas.width, height: output.canvas.height, canvas: output.canvas, children }, { noBackground: true })], { type: 'application/vnd.adobe.photoshop' }), 'stitched-map.psd');
        }) }))));
    const unsubscribe = taskStore.subscribe(() => void receive());
    void refreshProjects().catch(e => toast(e.message, 'error'));
    render();
    return () => { alive = false; autoLeft = 0; unsubscribe(); };
}
