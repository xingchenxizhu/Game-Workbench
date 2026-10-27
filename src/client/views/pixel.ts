/** 像素净化：真像素网格检测、调色板量化、抖动、描边与倍率导出。 */
import { h, toast } from '../lib/dom.js';
import { createCanvas, quantizeCanvas, canvasToBlob } from '../lib/canvas.js';
import { panel, split, imageDrop, previewCanvas, btn, range, toggle, select, actionRow } from './kit.js';

function saveDownload(url: string, name: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
}

function detectGrid(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const at = (x: number, y: number, channel: number) => data[(Math.min(height - 1, y) * width + Math.min(width - 1, x)) * 4 + channel];
  const sample = 1200;
  let best = { size: 1, error: Infinity };
  for (let size = 1; size <= 16; size++) {
    let error = 0;
    for (let i = 0; i < sample; i++) {
      const x = (i * 37) % width;
      const y = (i * 53) % height;
      for (const channel of [0, 1, 2]) {
        error += Math.abs(at(x, y, channel) - at(x + size, y, channel));
        error += Math.abs(at(x, y, channel) - at(x, y + size, channel));
      }
    }
    const normalized = error / (sample * 6);
    // 网格越大越可能是真实像素块；同等误差优先大网格
    const score = normalized + 0.15 / size;
    if (score < best.error) best = { size, error: score };
  }
  return best.size;
}

function bayerDither(canvas: HTMLCanvasElement, strength = 24): HTMLCanvasElement {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const matrix = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const data = image.data;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const index = (y * canvas.width + x) * 4;
      if (data[index + 3] === 0) continue;
      const offset = (matrix[y % 4][x % 4] / 16 - 0.5) * strength;
      data[index] += offset; data[index + 1] += offset; data[index + 2] += offset;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function mountPixel(container: any) {
  let source: HTMLCanvasElement | null = null;
  let output: HTMLCanvasElement | null = null;
  let grid = 1;
  let colors = 16;
  let dither = false;
  let outline = false;
  let exportScale = 4;
  let detected = 0;

  const stage = h('div', { class: 'stage' });
  const info = h('p', { class: 'stage-info' }, '上传图片后先「检测网格」，再决定是否量化。');
  const downloadButton = btn('导出像素 PNG', { kind: 'primary', disabled: true });
  const detectButton = btn('检测网格', { kind: 'quiet', disabled: true });

  const drop = imageDrop({
    label: '上传要像素化的图', hint: '插画、AI 生成图、截图都可以；透明背景会被保留',
    onChange: (canvas: HTMLCanvasElement) => {
      source = canvas;
      detected = 0;
      detectButton.disabled = false;
      run();
    }
  });

  detectButton.addEventListener('click', () => {
    if (!source) return;
    detected = detectGrid(source);
    grid = detected;
    toast(`检测到约 ${detected}px 的像素网格`);
    run();
  });

  function run() {
    if (!source) return;
    const size = Math.max(1, grid);
    const width = Math.max(1, Math.round(source.width / size));
    const height = Math.max(1, Math.round(source.height / size));
    let small = createCanvas(width, height);
    small.getContext('2d').drawImage(source, 0, 0, width, height);
    if (colors > 0) small = dither ? quantizeCanvas(bayerDither(small), colors) : quantizeCanvas(small, colors);
    if (outline) {
      const lined = createCanvas(small.width, small.height);
      const ctx = lined.getContext('2d');
      ctx.drawImage(small, 0, 0);
      const data = small.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, small.width, small.height);
      const out = ctx.getImageData(0, 0, small.width, small.height);
      for (let y = 0; y < small.height; y++) {
        for (let x = 0; x < small.width; x++) {
          const i = (y * small.width + x) * 4;
          if (data.data[i + 3] === 0) continue;
          let edge = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= small.width || ny >= small.height) { edge = true; break; }
            if (data.data[(ny * small.width + nx) * 4 + 3] === 0) { edge = true; break; }
          }
          if (edge) { out.data[i] = 16; out.data[i + 1] = 18; out.data[i + 2] = 22; out.data[i + 3] = 255; }
        }
      }
      ctx.putImageData(out, 0, 0);
      small = lined;
    }
    output = createCanvas(small.width * exportScale, small.height * exportScale);
    const ctx = output.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, output.width, output.height);
    downloadButton.disabled = false;
    paint();
  }

  function paint() {
    stage.replaceChildren();
    if (!output || !source) { stage.append(h('div', { class: 'stage-empty' }, '还没有图片')); return; }
    stage.append(previewCanvas(output, 'checker'));
    info.textContent = `原图 ${source.width}×${source.height} · 网格 ${grid}px · 像素尺寸 ${output.width / exportScale}×${output.height / exportScale} · 导出 ${output.width}×${output.height}`;
  }

  const controls = panel('像素参数', '先检测网格，再按需要量化颜色。',
    h('div', { class: 'inline-row' }, detectButton, h('span', { class: 'muted small' }, detected ? `检测结果：${detected}px` : '尚未检测')),
    range({ label: '像素块大小', min: 1, max: 16, step: 1, value: grid, suffix: 'px', onInput: (value: number) => { grid = value; run(); } }),
    range({ label: '颜色数量', min: 2, max: 128, step: 2, value: colors, onInput: (value: number) => { colors = value; run(); }, hint: '16 / 32 色最像传统像素画；128 色保留更多渐变。' }),
    toggle({ label: 'Bayer 抖动', value: dither, hint: '用有序抖动模拟更多颜色，像素风更复古', onChange: (value: boolean) => { dither = value; run(); } }),
    toggle({ label: '1px 深色描边', value: outline, hint: '透明边缘自动加深色轮廓', onChange: (value: boolean) => { outline = value; run(); } }),
    select({ label: '导出倍率', value: String(exportScale), options: [1, 2, 4, 8].map((value) => ({ value: String(value), label: `${value}×（最近邻）` })), onChange: (value: string) => { exportScale = Number(value); run(); } }),
    actionRow(downloadButton)
  );

  downloadButton.addEventListener('click', async () => {
    if (!output) return;
    const blob = await canvasToBlob(output);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    saveDownload(url, `pixel-${Date.now()}.png`);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast('像素图已导出');
  });

  container.append(split(panel('预览', '导出的是放大后的最近邻像素图。', drop.node, stage, info), controls));
  paint();
  return () => {};
}
