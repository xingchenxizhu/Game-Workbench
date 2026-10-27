/** 原生视图共用的界面零件。 */
import { h, stamp, baseName, copyText, toast } from '../lib/dom.js';
import { createCanvas, loadImageFromFile, canvasToBlob } from '../lib/canvas.js';
import { exportBlob } from '../lib/export.js';
export function panel(title, subtitle, ...children) {
    return h('section', { class: 'panel' }, title ? h('div', { class: 'panel-head' }, h('h2', null, title), subtitle ? h('p', null, subtitle) : null) : null, ...children);
}
export function split(...sections) {
    return h('div', { class: 'split' }, ...sections);
}
export function stack(...children) {
    return h('div', { class: 'stack' }, ...children);
}
/** 拖拽 + 点击上传，返回 { node, onChange }；内部保留原始图片画布。 */
export function imageDrop({ label = '上传图片', hint = 'PNG / JPG / WebP，最大 20 MB', accept = 'image/png,image/jpeg,image/webp', onChange } = {}) {
    const input = h('input', { type: 'file', accept, hidden: true });
    const preview = h('div', { class: 'drop-preview' }, h('span', { class: 'drop-icon' }, '⬆'), h('strong', null, label), h('small', null, hint));
    const node = h('div', { class: 'dropzone', tabindex: '0', role: 'button', 'aria-label': label }, input, preview);
    const emit = (file) => {
        loadImageFromFile(file).then((image) => {
            const canvas = createCanvas(image.naturalWidth, image.naturalHeight);
            canvas.getContext('2d').drawImage(image, 0, 0);
            preview.replaceChildren(h('img', { src: canvas.toDataURL('image/png'), alt: label }), h('span', { class: 'drop-change' }, '点击更换'));
            node.classList.add('has-image');
            node._file = file;
            onChange?.(canvas, file);
        }).catch((error) => {
            preview.querySelector('small')?.replaceChildren(document.createTextNode(error.message));
            node.classList.add('has-error');
        });
    };
    node.addEventListener('click', () => input.click());
    node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            input.click();
        }
    });
    input.addEventListener('change', () => {
        if (input.files[0])
            emit(input.files[0]);
    });
    node.addEventListener('dragover', (event) => { event.preventDefault(); node.classList.add('drag'); });
    node.addEventListener('dragleave', () => node.classList.remove('drag'));
    node.addEventListener('drop', (event) => {
        event.preventDefault();
        node.classList.remove('drag');
        const file = [...event.dataTransfer.files].find((item) => /^image\//.test(item.type));
        if (file)
            emit(file);
    });
    return { node, setFile: emit };
}
/** 通用文件拖放（视频等），只负责拿到 File，不解析内容。 */
export function fileDrop({ label = '上传文件', hint = '', accept = '', multiple = false, onFiles } = {}) {
    const input = h('input', { type: 'file', accept, multiple, hidden: true });
    const preview = h('div', { class: 'drop-preview' }, h('span', { class: 'drop-icon' }, '⬆'), h('strong', null, label), h('small', null, hint));
    const node = h('div', { class: 'dropzone', tabindex: '0', role: 'button', 'aria-label': label }, input, preview);
    const emit = (files) => {
        const list = [...files];
        if (!list.length)
            return;
        node._files = list;
        preview.replaceChildren(h('span', { class: 'drop-icon' }, '▤'), h('strong', null, list.length === 1 ? list[0].name : `${list.length} 个文件`), h('small', null, '点击可以重新选择'));
        node.classList.add('has-image');
        onFiles?.(list);
    };
    node.addEventListener('click', () => input.click());
    node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            input.click();
        }
    });
    input.addEventListener('change', () => {
        if (input.files.length)
            emit([...input.files]);
    });
    node.addEventListener('dragover', (event) => { event.preventDefault(); node.classList.add('drag'); });
    node.addEventListener('dragleave', () => node.classList.remove('drag'));
    node.addEventListener('drop', (event) => {
        event.preventDefault();
        node.classList.remove('drag');
        if (event.dataTransfer.files.length)
            emit([...event.dataTransfer.files]);
    });
    return { node, input };
}
/** 棋盘底预览画布。 */
export function previewCanvas(canvas, className = '') {
    const wrap = h('div', { class: `canvas-preview ${className}`.trim() });
    wrap.append(canvas);
    return wrap;
}
export function downloadCanvas(canvas, name = 'image', type = 'image/png', quality = 0.94) {
    return canvasToBlob(canvas, type, quality).then((blob) => {
        if (!blob)
            throw new Error('图片导出失败');
        return exportBlob(blob, `${baseName(name)}-${stamp()}.${type === 'image/jpeg' ? 'jpg' : 'png'}`);
    });
}
export function actionRow(...buttons) {
    return h('div', { class: 'action-row' }, ...buttons);
}
export function btn(label, { kind = 'default', onclick, disabled, id } = {}) {
    return h('button', { type: 'button', class: `btn btn-${kind}`, onclick, disabled: !!disabled, id: id || null }, label);
}
export function range({ label, min = 0, max = 100, step = 1, value = 50, suffix = '', onInput, hint }) {
    const output = h('output', { class: 'range-value' }, `${value}${suffix}`);
    const input = h('input', { type: 'range', min, max, step, value, oninput: (event) => { output.textContent = `${event.target.value}${suffix}`; onInput?.(Number(event.target.value)); } });
    const row = h('label', { class: 'range-row' }, h('span', { class: 'field-label' }, label), input, output);
    return hint ? h('div', { class: 'field-block' }, row, h('span', { class: 'field-hint' }, hint)) : row;
}
export function select({ label, options, value, onChange }) {
    const node = h('select', { onchange: (event) => onChange?.(event.target.value) });
    for (const option of options)
        node.append(h('option', { value: option.value, selected: option.value === value }, option.label));
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), node);
}
export function textInput({ label, value = '', placeholder, onInput, type = 'text' }) {
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), h('input', { type, value, placeholder, oninput: (event) => onInput?.(event.target.value) }));
}
export function textArea({ label, value = '', placeholder, rows = 3, onInput }) {
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), h('textarea', { rows, placeholder, oninput: (event) => onInput?.(event.target.value) }, value));
}
export function toggle({ label, value = false, hint, onChange }) {
    return h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: !!value, onchange: (event) => onChange?.(event.target.checked) }), h('span', { class: 'toggle-track' }, h('span', { class: 'toggle-thumb' })), h('span', { class: 'toggle-text' }, label, hint ? h('small', null, hint) : null));
}
export function badge(text, tone = '') {
    return h('span', { class: `badge ${tone}`.trim() }, text);
}
export function copyButton(label, getText) {
    return btn(label, {
        kind: 'quiet',
        onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
                await copyText(await getText());
                toast('已复制到剪贴板');
            }
            catch (error) {
                toast(error.message, 'error');
            }
            finally {
                button.disabled = false;
            }
        }
    });
}
export function meta(text) {
    return h('p', { class: 'muted small' }, text);
}
