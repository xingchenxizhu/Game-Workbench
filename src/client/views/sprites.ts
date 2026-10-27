/** Sprite Sheet split, frame order/alignment, packed atlas and actual GIF. */
import { h, toast } from '../lib/dom.js';
import { withBase } from '../lib/api.js';
import { createCanvas, loadImageFromFile, canvasToBlob } from '../lib/canvas.js';
import { exportBlob, loadZip } from '../lib/export.js';
import { splitSheet, normalizeFrames, joinFrames, SpriteFrame, flipFrames, actionGroups, characterSheet } from '../lib/sprites.js';
import { panel, btn, actionRow, fileDrop, imageDrop, previewCanvas } from './kit.js';
export function mountSprites(container: HTMLElement) {
    let frames: SpriteFrame[] = [], source: HTMLCanvasElement | null = null, selected = 0, tick = 0, timer: ReturnType<typeof setInterval> | undefined;
    const field = (name: string, value: number, min = 0, max = 128) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, name), h('input', { type: 'number', value, min, max, step: 1, 'aria-label': name }));
    const cols = field('图集列数', 4, 1), rows = field('图集行数', 4, 1), margin = field('外边距', 0), gap = field('帧间隔', 0), outCols = field('合图列数', 4, 1), sizeW = field('统一帧宽（0 自动）', 0, 0, 4096), sizeH = field('统一帧高（0 自动）', 0, 0, 4096), fps = field('播放帧率', 8, 1, 60);
    const number = (node: HTMLElement) => Number((node.querySelector('input') as HTMLInputElement).value);
    const groupLength = field('每组动作帧数', 4, 1), cellSize = field('角色表单格像素', 48, 8, 512);
    const group = h('select', { 'aria-label': '预览动作分组' });
    function selectedFrames() { const groups = actionGroups(frames, number(groupLength)); return group.value === 'all' ? frames : groups[Number(group.value)] || []; }
    group.onchange = () => { stop(); tick = 0; if (group.value !== 'all')
        selected = Number(group.value) * number(groupLength); draw(); };
    groupLength.onchange = () => { stop(); try {
        paint();
    }
    catch (error: any) {
        (groupLength.querySelector('input') as HTMLInputElement).value = '4';
        paint();
        toast(error.message, 'error');
    } };
    const trim = h('input', { type: 'checkbox' }), grid = h('div', { class: 'sprite-frame-grid' }), preview = createCanvas(128, 128), summary = h('p', { class: 'stage-info' }, '上传图集，或导入多张帧图片。');
    const history: SpriteFrame[][] = [];
    function remember() {
        history.push(frames.slice());
        if (history.length > 30)
            history.shift();
    }
    async function act(button: HTMLButtonElement, fn: () => Promise<void> | void) {
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
    function paint() {
        const previousGroup = group.value;
        const groups = actionGroups(frames, number(groupLength));
        group.replaceChildren(h('option', { value: 'all' }, '全部帧'), ...groups.map((g, i) => h('option', { value: String(i) }, `动作 ${i + 1} · ${g.length} 帧`)));
        group.value = previousGroup === 'all' || groups[Number(previousGroup)] ? previousGroup || 'all' : 'all';
        grid.replaceChildren();
        frames.forEach((frame, index) => {
            const canvas = createCanvas(90, 90), ctx = canvas.getContext('2d')!, scale = Math.min(90 / frame.canvas.width, 90 / frame.canvas.height);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(frame.canvas, (90 - frame.canvas.width * scale) / 2, (90 - frame.canvas.height * scale) / 2, frame.canvas.width * scale, frame.canvas.height * scale);
            grid.append(h('button', { class: 'sprite-frame' + (index === selected ? ' selected' : ''), onclick: () => { selected = index; paint(); }, 'aria-label': `选择帧 ${index + 1}` }, canvas, h('span', null, `${index + 1} · ${frame.name}`)));
        });
        summary.textContent = frames.length ? `${frames.length} 帧 · 可调整顺序、统一底线并导出` : '还没有帧';
        draw();
    }
    function draw() {
        if (!frames.length) {
            preview.getContext('2d')!.clearRect(0, 0, preview.width, preview.height);
            return;
        }
        const active = selectedFrames();
        if (!active.length)
            return;
        const f = timer ? active[tick % active.length].canvas : frames[Math.min(selected, frames.length - 1)].canvas;
        preview.width = f.width;
        preview.height = f.height;
        preview.getContext('2d')!.drawImage(f, 0, 0);
    }
    function stop() {
        if (timer)
            clearInterval(timer);
        timer = undefined;
        play.textContent = '播放预览';
        draw();
    }
    function ordered() { return normalizeFrames(frames, trim.checked, number(sizeW), number(sizeH)); }
    const play = btn('播放预览', { onclick: () => {
            if (!frames.length)
                return;
            if (timer)
                return stop();
            const rate = number(fps);
            if (rate < 1 || rate > 60)
                return toast('帧率必须为 1–60', 'error');
            play.textContent = '停止播放';
            tick = 0;
            timer = setInterval(() => { tick++; draw(); }, 1000 / rate);
            draw();
        } });
    const sheet = imageDrop({ label: '上传 Sprite Sheet 图集', hint: 'PNG / JPEG / WebP，按行从左到右拆分', onChange: (canvas: HTMLCanvasElement) => { source = canvas; } });
    const importFrames = fileDrop({ label: '导入多张帧图片', accept: 'image/png,image/jpeg,image/webp', multiple: true, onFiles: async (files: File[]) => {
            try {
                if (files.length > 128)
                    throw new Error('最多导入 128 帧');
                const next: SpriteFrame[] = [];
                for (const file of files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
                    const image = await loadImageFromFile(file);
                    if (image.width * image.height > 4 * 1024 * 1024)
                        throw new Error('单帧过大，请先缩小图片');
                    const canvas = createCanvas(image.width, image.height);
                    canvas.getContext('2d')!.drawImage(image, 0, 0);
                    next.push({ name: file.name.replace(/\.[^.]+$/, ''), canvas });
                }
                remember();
                stop();
                frames = next;
                selected = 0;
                paint();
            }
            catch (error: any) {
                toast(error.message, 'error');
            }
        } });
    const toolbar = actionRow(play, btn('前移', { onclick: () => {
            if (selected < 1)
                return;
            remember();
            [frames[selected - 1], frames[selected]] = [frames[selected], frames[selected - 1]];
            selected--;
            paint();
        } }), btn('后移', { onclick: () => {
            if (selected >= frames.length - 1)
                return;
            remember();
            [frames[selected + 1], frames[selected]] = [frames[selected], frames[selected + 1]];
            selected++;
            paint();
        } }), btn('复制帧', { onclick: () => {
            if (!frames.length || frames.length >= 128)
                return;
            remember();
            frames.splice(selected + 1, 0, { ...frames[selected] });
            selected++;
            paint();
        } }), btn('移除帧', { onclick: () => {
            if (!frames.length)
                return;
            remember();
            frames.splice(selected, 1);
            selected = Math.max(0, selected - 1);
            paint();
        } }), btn('撤销', { onclick: () => {
            const previous = history.pop();
            if (previous) {
                stop();
                frames = previous;
                selected = 0;
                paint();
            }
        } }));
    function transform(fn: (input: SpriteFrame[]) => SpriteFrame[]) {
        try {
            if (!frames.length)
                throw new Error('请先导入帧');
            const next = fn(frames);
            if (next.length > 128)
                throw new Error('处理后不能超过 128 帧');
            remember();
            stop();
            frames = next;
            selected = 0;
            paint();
        }
        catch (error: any) {
            toast(error.message, 'error');
        }
    }
    toolbar.append(btn('倒序', { onclick: () => transform(input => input.slice().reverse()) }), btn('生成往返序列', { onclick: () => transform(input => input.length < 3 ? input.slice() : [...input, ...input.slice(1, -1).reverse()]) }), btn('水平翻转全部帧', { onclick: () => transform(input => flipFrames(input, true)) }), btn('垂直翻转全部帧', { onclick: () => transform(input => flipFrames(input, false)) }));
    async function gifBlob(input: SpriteFrame[]) {
        if (!input.length)
            throw new Error('请先导入帧');
        const normalized = normalizeFrames(input, trim.checked, number(sizeW), number(sizeH));
        const response = await fetch(withBase('/api/images/gif'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fps: number(fps), frames: normalized.map(f => f.canvas.toDataURL('image/png')) }) });
        if (!response.ok) {
            const result = await response.json();
            throw new Error(result.error?.message || result.error || 'GIF 导出失败');
        }
        return response.blob();
    }
    const advanced = panel('动作分组与引擎导出', '按每行或每个动作的帧数分组。角色表必须先按下、左、右、上排列，每方向 3 帧；不会自动补帧或猜测朝向。', h('div', { class: 'fields' }, groupLength, h('label', { class: 'field' }, '预览动作分组', group), cellSize), actionRow(btn('导出当前动作 GIF', { onclick: (e: Event) => act(e.currentTarget as HTMLButtonElement, async () => exportBlob(await gifBlob(selectedFrames()), 'action.gif', false)) }), btn('逐动作 GIF 打包', { onclick: (e: Event) => act(e.currentTarget as HTMLButtonElement, async () => {
            if (!frames.length)
                throw new Error('请先导入帧');
            const groups = actionGroups(frames, number(groupLength));
            if (groups.length > 32)
                throw new Error('一次最多导出 32 组动作，请增加每组帧数');
            const Zip = await loadZip(), zip = new Zip();
            for (const [i, part] of groups.entries())
                zip.file(`action-${String(i + 1).padStart(2, '0')}.gif`, await gifBlob(part));
            zip.file('actions.json', JSON.stringify({ fps: number(fps), framesPerAction: number(groupLength), groups: groups.map(g => g.map(f => f.name)) }, null, 2));
            await exportBlob(await zip.generateAsync({ type: 'blob' }), 'sprite-actions.zip');
        }) }), btn('导出 RPG Maker 单角色 PNG', { onclick: (e: Event) => act(e.currentTarget as HTMLButtonElement, async () => exportBlob((await canvasToBlob(characterSheet(frames, number(cellSize))))!, '$character.png')) })));
    container.append(panel('导入与拆分', '图集边距与帧间隔会参与尺寸校验；原图不会被修改。', sheet.node, h('div', { class: 'fields' }, cols, rows, margin, gap), btn('拆分图集', { kind: 'primary', onclick: (event: Event) => act(event.currentTarget as HTMLButtonElement, () => {
            if (!source)
                throw new Error('请先上传图集');
            const next = splitSheet(source, number(cols), number(rows), number(margin), number(gap));
            remember();
            stop();
            frames = next;
            selected = 0;
            paint();
        }) }), importFrames.node), panel('帧顺序与预览', '自然数字排序导入；导出使用当前帧顺序。', toolbar, summary, previewCanvas(preview, 'checker sprite-preview'), fps, grid), panel('统一尺寸与导出', '统一帧底线后生成透明图集、逐帧 PNG、定位 JSON 和 GIF。', h('div', { class: 'fields' }, sizeW, sizeH, outCols), h('label', { class: 'toggle' }, trim, '裁透明边后按底线居中'), actionRow(btn('应用帧对齐', { onclick: (e: Event) => act(e.currentTarget as HTMLButtonElement, () => {
            if (!frames.length)
                throw new Error('请先导入帧');
            const next = ordered();
            remember();
            stop();
            frames = next;
            trim.checked = false;
            paint();
        }) }), btn('导出图集 PNG', { kind: 'primary', onclick: (e: Event) => act(e.currentTarget as HTMLButtonElement, async () => { const joined = joinFrames(ordered(), number(outCols)); await exportBlob((await canvasToBlob(joined.canvas))!, 'spritesheet.png'); }) }), btn('导出帧与图集 ZIP', { onclick: (e: Event) => act(e.currentTarget as HTMLButtonElement, async () => {
            if (!frames.length)
                throw new Error('请先导入帧');
            const normalized = ordered(), joined = joinFrames(normalized, number(outCols)), Zip = await loadZip(), zip = new Zip();
            for (const [i, f] of normalized.entries())
                zip.file(`frames/${String(i + 1).padStart(3, '0')}.png`, await canvasToBlob(f.canvas));
            zip.file('spritesheet.png', await canvasToBlob(joined.canvas));
            zip.file('frames.json', JSON.stringify({ ...joined.manifest, fps: number(fps) }, null, 2));
            await exportBlob(await zip.generateAsync({ type: 'blob' }), 'sprite-frames.zip');
        }) }), btn('导出动画 GIF', { onclick: (e: Event) => act(e.currentTarget as HTMLButtonElement, async () => {
            if (!frames.length)
                throw new Error('请先导入帧');
            const normalized = ordered();
            const response = await fetch(withBase('/api/images/gif'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fps: number(fps), frames: normalized.map(f => f.canvas.toDataURL('image/png')) }) });
            if (!response.ok) {
                const result = await response.json();
                throw new Error(result.error?.message || 'GIF 导出失败');
            }
            await exportBlob(await response.blob(), 'animation.gif', false);
            toast('GIF 已同时保存到素材目录');
        }) }))));
    container.append(advanced);
    paint();
    return stop;
}
