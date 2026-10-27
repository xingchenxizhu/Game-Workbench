/** Local layered canvas. Projects contain embedded raster sources, never URLs. */
import { h, toast } from '../lib/dom.js';
import { createCanvas, loadImageFromFile, loadImageFromUrl, canvasToBlob } from '../lib/canvas.js';
import { exportBlob, loadZip, loadPsd } from '../lib/export.js';
import { panel, btn, actionRow, fileDrop, previewCanvas } from './kit.js';
interface Layer {
    id: string;
    name: string;
    image: HTMLImageElement;
    source: string;
    x: number;
    y: number;
    scale: number;
    rotation: number;
    opacity: number;
    visible: boolean;
}
interface Snapshot {
    width: number;
    height: number;
    layers: Layer[];
    selected: string;
}
export function mountLayers(container: HTMLElement) {
    let width = 1024, height = 1024, layers: Layer[] = [], selected = '', drag: null | {
        x: number;
        y: number;
        originX: number;
        originY: number;
        id: string;
    } = null;
    const undo: Snapshot[] = [], redo: Snapshot[] = [];
    const canvas = createCanvas(width, height), stage = previewCanvas(canvas, 'checker layers-stage'), list = h('div', { class: 'layer-list' }), controls = h('div', { class: 'layer-controls' }), info = h('p', { class: 'stage-info' }, '导入图片后，直接在画布上拖动图层。');
    canvas.dataset.testid = 'layer-canvas';
    canvas.style.touchAction = 'none';
    const snapshot = (): Snapshot => ({ width, height, layers: layers.map(l => ({ ...l })), selected });
    function remember() {
        undo.push(snapshot());
        if (undo.length > 30)
            undo.shift();
        redo.length = 0;
    }
    function restore(s: Snapshot) { width = s.width; height = s.height; layers = s.layers.map(l => ({ ...l })); selected = s.selected; render(); }
    function draw(target = canvas, selection = true) {
        target.width = width;
        target.height = height;
        const ctx = target.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        for (const l of layers) {
            if (!l.visible)
                continue;
            ctx.save();
            ctx.globalAlpha = l.opacity;
            ctx.translate(l.x, l.y);
            ctx.rotate(l.rotation * Math.PI / 180);
            ctx.scale(l.scale, l.scale);
            ctx.drawImage(l.image, -l.image.width / 2, -l.image.height / 2);
            if (selection && l.id === selected) {
                ctx.globalAlpha = 1;
                ctx.strokeStyle = '#9dc2ff';
                ctx.lineWidth = 2 / l.scale;
                ctx.setLineDash([5 / l.scale, 4 / l.scale]);
                ctx.strokeRect(-l.image.width / 2, -l.image.height / 2, l.image.width, l.image.height);
            }
            ctx.restore();
        }
    }
    function checkedNumber(value: unknown, min: number, max: number): number {
        const n = Number(value);
        if (!Number.isFinite(n) || n < min || n > max)
            throw new Error(`数值必须介于 ${min}–${max}`);
        return n;
    }
    async function act(e: Event, fn: () => Promise<void>) {
        const button = e.currentTarget as HTMLButtonElement;
        button.disabled = true;
        try {
            await fn();
        }
        catch (error: any) {
            toast(error.message, 'error');
        }
        finally {
            button.disabled = false;
        }
    }
    function render() {
        draw();
        widthInput.value = String(width);
        heightInput.value = String(height);
        list.replaceChildren();
        for (const l of [...layers].reverse()) {
            list.append(h('button', { class: 'layer-item' + (selected === l.id ? ' selected' : ''), onclick: () => { selected = l.id; render(); } }, h('span', null, l.visible ? '◉' : '○'), h('span', null, l.name)));
        }
        controls.replaceChildren();
        const l = layers.find(item => item.id === selected);
        info.textContent = `${width} × ${height} · ${layers.length} 个图层`;
        if (!l) {
            controls.append(h('p', { class: 'muted' }, '选择一个图层以编辑位置、缩放与透明度。'));
            return;
        }
        const name = h('input', { value: l.name, 'aria-label': '图层名称', onchange: (e: Event) => { remember(); l.name = (e.target as HTMLInputElement).value.slice(0, 80); render(); } });
        controls.append(h('label', { class: 'field' }, '图层名称', name));
        for (const [key, label, min, max, step] of [['x', '横向位置', -16384, 16384, 1], ['y', '纵向位置', -16384, 16384, 1], ['scale', '缩放', .01, 16, .01], ['rotation', '旋转角度', -360, 360, 1], ['opacity', '透明度', 0, 1, .05]] as const) {
            const input = h('input', { type: 'number', value: l[key], min, max, step, 'aria-label': label, onchange: (e: Event) => {
                    try {
                        const value = checkedNumber((e.target as HTMLInputElement).value, min, max);
                        remember();
                        l[key] = value;
                        render();
                    }
                    catch (error: any) {
                        toast(error.message, 'error');
                        render();
                    }
                } });
            controls.append(h('label', { class: 'field' }, label, input));
        }
        controls.append(h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: l.visible, onchange: (e: Event) => { remember(); l.visible = (e.target as HTMLInputElement).checked; render(); } }), '显示图层'));
    }
    const position = (e: PointerEvent) => { const rect = canvas.getBoundingClientRect(); return { x: (e.clientX - rect.left) * width / rect.width, y: (e.clientY - rect.top) * height / rect.height }; };
    canvas.addEventListener('pointerdown', e => {
        const p = position(e);
        for (const l of [...layers].reverse()) {
            if (!l.visible || l.opacity === 0)
                continue;
            const angle = -l.rotation * Math.PI / 180, dx = p.x - l.x, dy = p.y - l.y, x = (dx * Math.cos(angle) - dy * Math.sin(angle)) / l.scale, y = (dx * Math.sin(angle) + dy * Math.cos(angle)) / l.scale;
            if (Math.abs(x) <= l.image.width / 2 && Math.abs(y) <= l.image.height / 2) {
                selected = l.id;
                remember();
                drag = { ...p, originX: l.x, originY: l.y, id: l.id };
                canvas.setPointerCapture(e.pointerId);
                draw();
                return;
            }
        }
    });
    canvas.addEventListener('pointermove', e => {
        if (!drag)
            return;
        const l = layers.find(l => l.id === drag.id);
        if (!l)
            return;
        const p = position(e);
        l.x = Math.round(drag.originX + p.x - drag.x);
        l.y = Math.round(drag.originY + p.y - drag.y);
        draw();
    });
    const end = () => {
        if (drag) {
            drag = null;
            render();
        }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    const files = fileDrop({ label: '添加图片图层', hint: 'PNG / JPEG / WebP，支持一次选择多张', accept: 'image/png,image/jpeg,image/webp', multiple: true, onFiles: async (files: File[]) => {
            try {
                if (layers.length + files.length > 32)
                    throw new Error('最多 32 个图层');
                const next: Layer[] = [];
                for (const file of files) {
                    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 20 * 1024 * 1024)
                        throw new Error('图层应为不超过 20 MB 的 PNG / JPEG / WebP');
                    const image = await loadImageFromFile(file);
                    if (image.width * image.height > 16 * 1024 * 1024)
                        throw new Error('图层像素过大');
                    const c = createCanvas(image.width, image.height);
                    c.getContext('2d')!.drawImage(image, 0, 0);
                    next.push({ id: crypto.randomUUID(), name: file.name, image, source: c.toDataURL('image/png'), x: width / 2, y: height / 2, scale: 1, rotation: 0, opacity: 1, visible: true });
                }
                remember();
                if (!layers.length && next[0]) {
                    width = next[0].image.width;
                    height = next[0].image.height;
                    for (const l of next) {
                        l.x = width / 2;
                        l.y = height / 2;
                    }
                }
                layers.push(...next);
                selected = next.at(-1)?.id || selected;
                render();
            }
            catch (error: any) {
                toast(error.message, 'error');
            }
        } });
    const widthInput = h('input', { type: 'number', value: width, min: 1, max: 4096, 'aria-label': '画布宽度' }), heightInput = h('input', { type: 'number', value: height, min: 1, max: 4096, 'aria-label': '画布高度' });
    const projectInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': '导入画布工程' });
    projectInput.onchange = async () => {
        try {
            const file = projectInput.files[0];
            if (!file)
                return;
            if (file.size > 64 * 1024 * 1024)
                throw new Error('工程文件超过 64 MB');
            const data = JSON.parse(await file.text());
            if (data.format !== 'game-workbench-layers' || data.version !== 1 || !Array.isArray(data.layers) || data.layers.length > 32)
                throw new Error('画布工程格式无效');
            const w = checkedNumber(data.width, 1, 4096), hgt = checkedNumber(data.height, 1, 4096);
            if (!Number.isInteger(w) || !Number.isInteger(hgt))
                throw new Error('画布尺寸必须为整数');
            const next: Layer[] = [];
            let pixels = 0;
            for (const item of data.layers) {
                if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(item.source))
                    throw new Error('工程只能包含内嵌图片');
                const image = await loadImageFromUrl(item.source);
                pixels += image.width * image.height;
                if (pixels > 64 * 1024 * 1024)
                    throw new Error('工程图层像素总量过大');
                next.push({ id: crypto.randomUUID(), name: String(item.name || '图层').slice(0, 80), image, source: item.source, x: checkedNumber(item.x, -16384, 16384), y: checkedNumber(item.y, -16384, 16384), scale: checkedNumber(item.scale, .01, 16), rotation: checkedNumber(item.rotation, -360, 360), opacity: checkedNumber(item.opacity, 0, 1), visible: item.visible !== false });
            }
            remember();
            width = w;
            height = hgt;
            layers = next;
            selected = next.at(-1)?.id || '';
            widthInput.value = width;
            heightInput.value = height;
            render();
        }
        catch (error: any) {
            toast(error.message, 'error');
        }
    };
    function move(direction: number) {
        const i = layers.findIndex(l => l.id === selected), n = i + direction;
        if (i < 0 || n < 0 || n >= layers.length)
            return;
        remember();
        [layers[i], layers[n]] = [layers[n], layers[i]];
        render();
    }
    function project() { return { format: 'game-workbench-layers', version: 1, width, height, layers: layers.map(({ image, ...item }) => item) }; }
    const toolbar = actionRow(btn('撤销', { onclick: () => {
            const prev = undo.pop();
            if (prev) {
                redo.push(snapshot());
                restore(prev);
            }
        } }), btn('重做', { onclick: () => {
            const next = redo.pop();
            if (next) {
                undo.push(snapshot());
                restore(next);
            }
        } }), btn('上移一层', { onclick: () => move(1) }), btn('下移一层', { onclick: () => move(-1) }), btn('居中', { onclick: () => {
            const l = layers.find(l => l.id === selected);
            if (l) {
                remember();
                l.x = width / 2;
                l.y = height / 2;
                render();
            }
        } }), btn('复制图层', { onclick: () => {
            const l = layers.find(l => l.id === selected);
            if (l && layers.length < 32) {
                remember();
                const copy = { ...l, id: crypto.randomUUID(), name: l.name + ' 副本', x: l.x + 16, y: l.y + 16 };
                layers.push(copy);
                selected = copy.id;
                render();
            }
        } }), btn('删除图层', { onclick: () => {
            if (!selected)
                return;
            remember();
            layers = layers.filter(l => l.id !== selected);
            selected = layers.at(-1)?.id || '';
            render();
        } }));
    container.append(panel('自由画布与图层', '拖动摆放图片，调整层级、透明度、缩放与旋转。工程可再次打开编辑。', files.node, h('div', { class: 'fields' }, h('label', { class: 'field' }, '画布宽度', widthInput), h('label', { class: 'field' }, '画布高度', heightInput), btn('应用画布尺寸', { onclick: () => {
            try {
                const w = checkedNumber(widthInput.value, 1, 4096), hgt = checkedNumber(heightInput.value, 1, 4096);
                if (!Number.isInteger(w) || !Number.isInteger(hgt))
                    throw new Error('尺寸必须为整数');
                remember();
                width = w;
                height = hgt;
                render();
            }
            catch (error: any) {
                toast(error.message, 'error');
            }
        } })), toolbar, info, h('div', { class: 'layer-workspace' }, stage, h('aside', { class: 'layer-sidebar' }, list, controls))), panel('保存与导出', '导出不包含编辑选框；分层 ZIP 内含工程 JSON 和独立 PNG，可在工作台继续编辑。', projectInput, actionRow(btn('导出合成 PNG', { kind: 'primary', onclick: (e: Event) => act(e, async () => { const out = createCanvas(width, height); draw(out, false); await exportBlob((await canvasToBlob(out))!, 'composition.png'); }) }), btn('保存画布工程', { onclick: (e: Event) => act(e, async () => { await exportBlob(new Blob([JSON.stringify(project(), null, 2)], { type: 'application/json' }), 'canvas-project.json'); }) }), btn('导入画布工程', { onclick: () => projectInput.click() }), btn('导出分层 ZIP', { onclick: (e: Event) => act(e, async () => {
            const Zip = await loadZip(), zip = new Zip();
            zip.file('project.json', JSON.stringify(project(), null, 2));
            for (const [index, layer] of layers.entries())
                zip.file(`layers/${String(index + 1).padStart(2, '0')}.png`, layer.source.split(',')[1], { base64: true });
            const out = createCanvas(width, height);
            draw(out, false);
            zip.file('composition.png', await canvasToBlob(out));
            await exportBlob(await zip.generateAsync({ type: 'blob' }), 'layered-project.zip');
        }) }))));
    const psdButton = btn('导出分层 PSD', { onclick: (e: Event) => act(e, async () => {
            if (!layers.length)
                throw new Error('请先导入图层');
            if (width * height * layers.length > 16 * 1024 * 1024)
                throw new Error('PSD 图层总像素超过 1600 万，请缩小画布或减少图层');
            const { writePsd } = await loadPsd(), composite = createCanvas(width, height);
            draw(composite, false);
            const children = [...layers].reverse().map(layer => {
                const image = createCanvas(width, height), ctx = image.getContext('2d')!;
                ctx.imageSmoothingEnabled = false;
                ctx.translate(layer.x, layer.y);
                ctx.rotate(layer.rotation * Math.PI / 180);
                ctx.scale(layer.scale, layer.scale);
                ctx.drawImage(layer.image, -layer.image.width / 2, -layer.image.height / 2);
                return { name: layer.name, canvas: image, opacity: layer.opacity, hidden: !layer.visible, blendMode: 'normal' };
            });
            const bytes = writePsd({ width, height, canvas: composite, children }, { generateThumbnail: false, noBackground: true });
            await exportBlob(new Blob([bytes], { type: 'application/vnd.adobe.photoshop' }), 'layered-project.psd');
        }) });
    container.lastElementChild!.querySelector('.action-row')!.append(psdButton);
    container.lastElementChild!.append(h('p', { class: 'field-hint' }, 'PSD 保留独立栅格图层、名称、透明度与可见性。位置、缩放和旋转烘焙进图层像素；在画布外的像素会裁掉。继续调整原变换请保存工程 JSON。'));
    render();
    return () => { drag = null; };
}
