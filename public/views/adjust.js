/** 单图调整：调色、像素化、颜色量化、网格对齐、透明裁边。 */
import { h, toast, debounce } from '../lib/dom.js';
import { cloneCanvas, adjustCanvas, pixelate, quantizeCanvas, alignToGrid, trimAlpha, resizeCanvas } from '../lib/canvas.js';
import { panel, split, imageDrop, previewCanvas, downloadCanvas, btn, range, toggle, select, textInput, actionRow } from './kit.js';
export function mountAdjust(container) {
    let source = null;
    let output = null;
    const values = {
        brightness: 100, contrast: 100, saturation: 100, hue: 0,
        pixel: 1, quantize: false, colors: 32, grid: 0, trim: false, width: 0, smooth: false
    };
    const stage = h('div', { class: 'stage' });
    const info = h('p', { class: 'stage-info' }, '上传一张图开始调整。');
    const downloadButton = btn('导出 PNG', { kind: 'primary', disabled: true });
    const resetButton = btn('重置', { kind: 'quiet' });
    const rerender = debounce(() => {
        if (!source)
            return;
        let canvas = cloneCanvas(source);
        canvas = adjustCanvas(canvas, values);
        if (values.pixel > 1)
            canvas = pixelate(canvas, values.pixel);
        if (values.quantize)
            canvas = quantizeCanvas(canvas, values.colors);
        if (values.width > 0 && values.width !== canvas.width) {
            const scale = values.width / canvas.width;
            canvas = resizeCanvas(canvas, Math.round(values.width), Math.round(canvas.height * scale), values.smooth);
        }
        if (values.grid > 0)
            canvas = alignToGrid(canvas, values.grid);
        if (values.trim)
            canvas = trimAlpha(canvas).canvas;
        output = canvas;
        downloadButton.disabled = false;
        paint();
    }, 60);
    const drop = imageDrop({
        label: '上传要调整的图',
        hint: '调色、像素化、量化都按原图重新计算，随时可以回退',
        onChange: (canvas) => {
            source = canvas;
            rerender();
        }
    });
    function paint() {
        stage.replaceChildren();
        if (!output) {
            stage.append(h('div', { class: 'stage-empty' }, '还没有图片'));
            return;
        }
        stage.append(previewCanvas(output, 'checker'));
        info.textContent = `输出 ${output.width} × ${output.height}${values.pixel > 1 ? ` · 像素块 ${values.pixel}px` : ''}${values.quantize ? ` · ${values.colors} 色` : ''}`;
    }
    const controls = panel('调整参数', '所有处理都在浏览器本地完成，不上传原图。', range({ label: '亮度', min: 40, max: 160, step: 1, value: 100, suffix: '%', onInput: (value) => { values.brightness = value; rerender(); } }), range({ label: '对比度', min: 40, max: 200, step: 1, value: 100, suffix: '%', onInput: (value) => { values.contrast = value; rerender(); } }), range({ label: '饱和度', min: 0, max: 200, step: 1, value: 100, suffix: '%', onInput: (value) => { values.saturation = value; rerender(); } }), range({ label: '色相', min: -180, max: 180, step: 1, value: 0, suffix: '°', onInput: (value) => { values.hue = value; rerender(); } }), h('div', { class: 'divider' }), range({ label: '像素块大小', min: 1, max: 24, step: 1, value: 1, suffix: 'px', onInput: (value) => { values.pixel = value; rerender(); }, hint: '1px 表示不像素化；像素画素材会按块重新采样。' }), toggle({ label: '颜色量化', value: false, hint: '减少颜色数量，统一像素画调色板', onChange: (value) => { values.quantize = value; rerender(); } }), range({ label: '颜色数量', min: 2, max: 128, step: 1, value: 32, onInput: (value) => { values.colors = value; rerender(); } }), select({ label: '网格对齐', value: '0', options: [{ value: '0', label: '不规整' }, { value: '8', label: '8 的倍数' }, { value: '16', label: '16 的倍数' }, { value: '32', label: '32 的倍数' }, { value: '48', label: '48 的倍数' }, { value: '64', label: '64 的倍数' }], onChange: (value) => { values.grid = Number(value); rerender(); } }), textInput({ label: '目标宽度（可选）', placeholder: '例如 512，留空保持原尺寸', onInput: (value) => { values.width = Math.max(0, Number(value.replace(/\D/g, '')) || 0); rerender(); } }), toggle({ label: '平滑缩放', value: false, hint: '像素图建议关闭，保持硬边', onChange: (value) => { values.smooth = value; rerender(); } }), toggle({ label: '裁掉透明边', value: false, onChange: (value) => { values.trim = value; rerender(); } }), actionRow(downloadButton, resetButton));
    downloadButton.addEventListener('click', async () => {
        if (!output)
            return;
        await downloadCanvas(output, drop.node._file?.name || 'adjust', 'image/png');
        toast('图片已导出');
    });
    resetButton.addEventListener('click', () => {
        container.replaceChildren();
        mountAdjust(container);
        toast('参数已重置');
    });
    container.append(split(panel('预览', '按参数实时重算。', drop.node, stage, info), controls));
    paint();
    return () => { };
}
