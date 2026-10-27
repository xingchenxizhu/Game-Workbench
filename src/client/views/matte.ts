/** 抠图去背：颜色键控 + 软边 + 收边 + 自动裁边，全部本地完成。 */
import { h, toast } from '../lib/dom.js';
import { cloneCanvas, detectBackdrop, matteKey, erodeAlpha, trimAlpha, toHex, fromHex, dominantColors } from '../lib/canvas.js';
import { panel, split, imageDrop, previewCanvas, downloadCanvas, btn, range, toggle, actionRow } from './kit.js';

export function mountMatte(container: any, { toast: notify }: any = {}) {
  let original = null;
  let result = null;
  let key = { r: 255, g: 255, b: 255 };
  let tolerance = 48;
  let softness = 36;
  let shrink = 0;
  let despill = true;
  let autoTrim = true;
  let view = 'result';

  const colorInput = h('input', { type: 'color', value: '#ffffff', 'aria-label': '背景色' });
  const colorText = h('code', { class: 'color-code' }, '#ffffff');
  const palette = h('div', { class: 'swatches' });
  const stage = h('div', { class: 'stage' });
  const info = h('p', { class: 'stage-info' }, '上传一张图开始。');
  const viewToggle = h('div', { class: 'segmented' },
    segButton('原图', 'original'), segButton('结果', 'result')
  );
  const applyButton = btn('应用抠图', { kind: 'primary', disabled: true });
  const downloadButton = btn('下载透明 PNG', { disabled: true });

  function segButton(label, value) {
    return h('button', { type: 'button', class: value === view ? 'seg on' : 'seg', dataset: { view: value }, onclick: () => { view = value; paintView(); } }, label);
  }

  const drop = imageDrop({
    label: '上传要抠的图',
    hint: '人物立绘、精灵、道具都可以；纯色或绿幕背景效果最好',
    onChange: (canvas) => {
      original = canvas;
      result = null;
      key = detectBackdrop(canvas);
      colorInput.value = toHex(key);
      colorText.textContent = toHex(key);
      paintSwatches();
      applyButton.disabled = false;
      view = 'result';
      run();
    }
  });

  const controls = panel('抠图设置', '先自动取四角背景色，再微调容差。',
    h('div', { class: 'field-block' },
      h('span', { class: 'field-label' }, '背景色'),
      h('div', { class: 'color-row' }, colorInput, colorText,
        btn('取四角颜色', { kind: 'quiet', onclick: () => { if (!original) return; key = detectBackdrop(original); colorInput.value = toHex(key); colorText.textContent = toHex(key); run(); } })
      ),
      h('span', { class: 'field-hint' }, '也可以直接点击左侧图片取色。')
    ),
    palette,
    range({ label: '容差', min: 0, max: 300, step: 2, value: tolerance, onInput: (value) => { tolerance = value; run(); }, hint: '背景色与目标色的最大距离，越大去掉的越多。' }),
    range({ label: '软边', min: 1, max: 160, step: 2, value: softness, onInput: (value) => { softness = value; run(); }, hint: '边缘过渡宽度，头发和半透明效果别调太小。' }),
    range({ label: '收边', min: 0, max: 4, step: 1, value: shrink, suffix: 'px', onInput: (value) => { shrink = value; run(); } }),
    toggle({ label: '去色溢', value: despill, hint: '抹掉边缘残留的背景色，绿幕特别明显', onChange: (value) => { despill = value; run(); } }),
    toggle({ label: '自动裁边', value: autoTrim, hint: '去掉四周全透明的像素', onChange: (value) => { autoTrim = value; run(); } }),
    actionRow(applyButton, downloadButton)
  );

  colorInput.addEventListener('input', () => {
    key = fromHex(colorInput.value);
    colorText.textContent = toHex(key);
    run();
  });

  applyButton.addEventListener('click', run);
  downloadButton.addEventListener('click', async () => {
    if (!result) return;
    await downloadCanvas(result, drop.node._file?.name || 'matte', 'image/png');
    toast('透明 PNG 已导出');
  });

  function paintSwatches() {
    palette.replaceChildren();
    if (!original) return;
    for (const color of dominantColors(original, 8)) {
      const hex = toHex(color);
      palette.append(h('button', { type: 'button', class: 'swatch', style: { background: hex }, title: `使用 ${hex}`, 'aria-label': `使用背景色 ${hex}`, onclick: () => { key = color; colorInput.value = hex; colorText.textContent = hex; run(); } }));
    }
  }

  function run() {
    if (!original) return;
    const keyed = matteKey(cloneCanvas(original), { ...key, tolerance, softness, shrink: 0, despill });
    result = shrink > 0 ? erodeAlpha(keyed, shrink) : keyed;
    if (autoTrim) result = trimAlpha(result).canvas;
    downloadButton.disabled = false;
    paintView();
  }

  function paintView() {
    stage.replaceChildren();
    const canvas = view === 'result' && result ? result : original;
    if (!canvas) {
      stage.append(h('div', { class: 'stage-empty' }, '还没有图片'));
      return;
    }
    const shown = view === 'result' && result ? result : original;
    const preview = previewCanvas(shown, 'checker');
    if (!result || view === 'original') preview.addEventListener('click', (event) => {
      const rect = shown.getBoundingClientRect();
      const x = Math.round((event.clientX - rect.left) * (shown.width / rect.width));
      const y = Math.round((event.clientY - rect.top) * (shown.height / rect.height));
      const data = shown.getContext('2d', { willReadFrequently: true }).getImageData(Math.max(0, x), Math.max(0, y), 1, 1).data;
      if (data[3] < 8) return;
      key = { r: data[0], g: data[1], b: data[2] };
      colorInput.value = toHex(key);
      colorText.textContent = toHex(key);
      run();
      view = 'result';
      paintView();
    });
    stage.append(preview);
    info.textContent = canvas === original
      ? `原图 ${canvas.width} × ${canvas.height}，点击图片可以取背景色。`
      : `输出 ${canvas.width} × ${canvas.height}，透明背景 PNG。`;
    for (const button of viewToggle.children) button.classList.toggle('on', button.dataset.view === view);
  }

  const left = split(
    panel('原图', '点击图片可以取背景色。', drop.node, h('div', { class: 'segmented-row' }, viewToggle), stage, info),
    controls
  );
  container.append(left);

  // 视图切换按钮只切换显示，不重跑算法。
  for (const button of viewToggle.children) button.addEventListener('click', () => { view = button.dataset.view; paintView(); });

  paintView();
  return () => { /* 无全局订阅 */ };
}
