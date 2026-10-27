/** 横版关卡：程序化生成、水平拼接、素材提取（瓦片图集 / 碰撞 / 生成点 / 分段）。 */
import { h, toast } from '../lib/dom.js';
import { createCanvas, loadImageFromFile, canvasToBlob } from '../lib/canvas.js';
import { panel, btn, split, actionRow, range, select, textInput, previewCanvas } from './kit.js';

type Theme = { name: string; sky: [string, string]; far: string; near: string; ground: string; top: string; platform: string; hazard: string; decor: string };
const THEMES: Record<string, Theme> = {
  forest: { name: '森林', sky: ['#0d1a24', '#1d3b3a'], far: '#214d46', near: '#1a3a35', ground: '#3b5a3a', top: '#78b05a', platform: '#6b5636', hazard: '#c95a5a', decor: '#9bd06a' },
  desert: { name: '沙漠', sky: ['#2a1c16', '#5a3a24'], far: '#7a5232', near: '#5c3d25', ground: '#8a6a42', top: '#d9b46a', platform: '#6f5230', hazard: '#c06a3a', decor: '#e8c77a' },
  snow: { name: '雪地', sky: ['#101c2c', '#28415c'], far: '#3c5b78', near: '#2b4358', ground: '#6f8497', top: '#d9e8f2', platform: '#5a6c7d', hazard: '#7fb4d6', decor: '#eaf4fb' },
  lava: { name: '熔岩', sky: ['#1a0c0c', '#3a1414'], far: '#4a1e1e', near: '#321414', ground: '#4a2a24', top: '#8a3a2a', platform: '#55302a', hazard: '#ff7a3a', decor: '#d96a3a' },
  ruins: { name: '遗迹', sky: ['#141022', '#2c2444'], far: '#3b3358', near: '#2a2340', ground: '#4a4260', top: '#8a7fb0', platform: '#554d6e', hazard: '#b06ad0', decor: '#b9a8e0' }
};

function rngFrom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function saveCanvas(canvas: HTMLCanvasElement, name: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  });
}
function saveJson(value: any, name: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function tileDraw(ctx: CanvasRenderingContext2D, id: number, x: number, y: number, size: number, theme: Theme): void {
  if (id === 1) {
    ctx.fillStyle = theme.ground; ctx.fillRect(x, y, size, size);
    ctx.fillStyle = theme.top; ctx.fillRect(x, y, size, Math.max(2, size * 0.18));
    ctx.fillStyle = theme.decor; ctx.fillRect(x + size * 0.12, y - 2, size * 0.12, 2);
  } else if (id === 2) {
    ctx.fillStyle = theme.ground; ctx.fillRect(x, y, size, size);
    ctx.fillStyle = 'rgba(0,0,0,.12)';
    for (let i = 0; i < 3; i++) ctx.fillRect(x + (i * 7 + 3) % size, y + ((i * 11 + 5) % size), Math.max(2, size * 0.06), Math.max(2, size * 0.06));
  } else if (id === 3) {
    ctx.fillStyle = theme.platform; ctx.fillRect(x, y, size, Math.max(3, size * 0.28));
    ctx.fillStyle = theme.top; ctx.fillRect(x, y, size, 2);
  } else if (id === 4) {
    ctx.fillStyle = theme.hazard;
    for (let i = 0; i < 3; i++) {
      const w = size / 3;
      ctx.beginPath(); ctx.moveTo(x + i * w, y + size); ctx.lineTo(x + i * w + w / 2, y + size * 0.3); ctx.lineTo(x + (i + 1) * w, y + size); ctx.closePath(); ctx.fill();
    }
  } else if (id === 5) {
    ctx.strokeStyle = theme.decor; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + size * 0.3, y + size); ctx.quadraticCurveTo(x + size * 0.1, y + size * 0.5, x + size * 0.4, y + size * 0.4); ctx.stroke();
  }
}

function drawBackground(canvas: HTMLCanvasElement, level: any, theme: Theme): void {
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, theme.sky[0]); g.addColorStop(1, theme.sky[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [color, amp, offset, alpha] of [[theme.far, 0.22, 0.55, 0.7], [theme.near, 0.16, 0.72, 0.9]] as any[]) {
    ctx.fillStyle = color; ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.moveTo(0, canvas.height);
    for (let x = 0; x <= canvas.width; x += 24) {
      const y = canvas.height * offset - Math.sin((x + level.seed) * 0.004) * canvas.height * amp - Math.sin((x + level.seed) * 0.011) * canvas.height * amp * 0.4;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(canvas.width, canvas.height); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function buildLevel(opts: any): any {
  const rng = rngFrom(opts.seed);
  const rows = 12;
  const cols = opts.segments * 10;
  const grid = Array.from({ length: rows }, () => Array(cols).fill(0));
  const tops: number[] = [];
  let x = 0;
  while (x < cols) {
    const gap = x > 4 && x < cols - 6 && rng() < opts.gapRate * 0.35;
    if (gap) { const width = 2 + Math.floor(rng() * 2); for (let i = 0; i < width && x < cols; i++, x++) tops.push(rows); continue; }
    const variation = Math.round((rng() - 0.5) * opts.heightVar * 2);
    const top = Math.max(3, Math.min(rows - 2, 6 + variation));
    const width = 3 + Math.floor(rng() * 5);
    for (let i = 0; i < width && x < cols; i++, x++) {
      tops.push(top);
      for (let y = top; y < rows; y++) grid[y][x] = y === top ? 1 : 2;
      if (rng() < 0.14) grid[top - 1][x] = 5;
      if (rng() < opts.platformDensity * 0.35 && x > 2) {
        const py = top - 3 - Math.floor(rng() * 2);
        const pw = 2 + Math.floor(rng() * 3);
        for (let k = 0; k < pw && x + k < cols; k++) if (py >= 0) grid[py][x + k] = 3;
      }
      if (rng() < 0.06) grid[top - 1][x] = 4;
    }
  }
  // 起点与终点强制落地
  const first = tops.findIndex((t) => t < rows);
  if (first >= 0) for (let y = tops[first]; y < rows; y++) grid[y][first] = y === tops[first] ? 1 : 2;
  const spawns: any[] = [];
  if (first >= 0) spawns.push({ type: 'player', x: first, y: tops[first] - 1 });
  for (let col = 0; col < cols; col += 7) {
    const top = tops[col];
    if (top >= rows) continue;
    spawns.push({ type: col % 21 === 0 ? 'enemy' : 'coin', x: col, y: top - 3 });
  }
  const last = [...tops].reverse().findIndex((t) => t < rows);
  if (last >= 0) spawns.push({ type: 'goal', x: cols - 1 - last, y: tops[cols - 1 - last] - 1 });
  const collisions: any[] = [];
  for (let y = 0; y < rows; y++) {
    let start = -1;
    for (let col = 0; col <= cols; col++) {
      const solid = col < cols && (grid[y][col] === 1 || grid[y][col] === 2 || grid[y][col] === 3);
      if (solid && start < 0) start = col;
      if (!solid && start >= 0) {
        collisions.push({ x: start * opts.tileSize, y: y * opts.tileSize, w: (col - start) * opts.tileSize, h: opts.tileSize });
        start = -1;
      }
    }
  }
  const gaps: any[] = [];
  for (let col = 0; col < cols; col++) if (tops[col] >= rows) { const start = col; while (col < cols && tops[col] >= rows) col++; gaps.push({ x: start, w: col - start }); }
  return { ...opts, rows, cols, grid, tops, spawns, collisions, warnings: gaps.filter((g) => g.w > 3).map((g) => `第 ${g.x} 列附近有 ${g.w} 格宽的断崖（建议 ≤3 格）`) };
}

function renderLevel(level: any): HTMLCanvasElement {
  const theme = THEMES[level.theme] || THEMES.forest;
  const canvas = createCanvas(level.cols * level.tileSize, level.rows * level.tileSize);
  drawBackground(canvas, level, theme);
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < level.rows; y++) for (let x = 0; x < level.cols; x++) {
    const id = level.grid[y][x];
    if (id) tileDraw(ctx, id, x * level.tileSize, y * level.tileSize, level.tileSize, theme);
  }
  for (const spawn of level.spawns) {
    const cx = spawn.x * level.tileSize + level.tileSize / 2;
    const cy = spawn.y * level.tileSize + level.tileSize / 2;
    ctx.fillStyle = spawn.type === 'player' ? '#7c9cff' : spawn.type === 'enemy' ? '#f2738a' : spawn.type === 'goal' ? '#5fd6a8' : '#f0b46a';
    ctx.beginPath(); ctx.arc(cx, cy, level.tileSize * 0.26, 0, Math.PI * 2); ctx.fill();
  }
  return canvas;
}

function buildAtlas(level: any): { canvas: HTMLCanvasElement; meta: any } {
  const theme = THEMES[level.theme] || THEMES.forest;
  const ids = [...new Set(level.grid.flat().filter((id: number) => id > 0))] as number[];
  const cell = Math.max(32, level.tileSize);
  const canvas = createCanvas(cell * ids.length, cell);
  const ctx = canvas.getContext('2d');
  const tiles = ids.map((id, index) => {
    tileDraw(ctx, id, index * cell, 0, cell, theme);
    return { id, x: index * cell, y: 0, w: cell, h: cell };
  });
  return { canvas, meta: { tileSize: cell, columns: ids.length, tiles } };
}

export function mountSidescroll(container: any) {
  let opts: any = { seed: Date.now() % 100000, segments: 8, tileSize: 48, theme: 'forest', platformDensity: 0.5, gapRate: 0.5, heightVar: 1.5 };
  let level: any = null;
  let preview: any = null;
  let tab = 'gen';

  const tabs = h('div', { class: 'video-tabs' },
    ...[['gen', '生成'], ['stitch', '拼接'], ['extract', '提取素材']].map(([id, label]) =>
      h('button', { class: tab === id ? 'video-tab on' : 'video-tab', type: 'button', onclick: () => { tab = id; paint(); } }, label))
  );
  const body = h('div', { class: 'side-body' });
  const root = panel('横版关卡', '2D 横轴地图：程序化生成 → 水平拼接 → 提取瓦片/碰撞/生成点。所有处理都在浏览器完成。', tabs, body);
  container.append(root);

  function regenerate() {
    level = buildLevel(opts);
    paint();
  }

  function paint() {
    body.replaceChildren();
    if (tab === 'gen') paintGen();
    else if (tab === 'stitch') paintStitch();
    else paintExtract();
  }

  function paintGen() {
    const seed = textInput({ value: String(opts.seed), placeholder: '种子', onInput: (value: string) => { opts.seed = Number(value) || 1; } });
    const previewBox = h('div', { class: 'side-preview' });
    const info = h('p', { class: 'stage-info' });
    if (level) {
      const canvas = renderLevel(level);
      previewBox.append(previewCanvas(canvas, 'side-canvas'));
      info.textContent = `${level.cols} 列 × ${level.rows} 行 · ${level.tileSize}px · ${level.collisions.length} 个碰撞块 · ${level.spawns.length} 个生成点${level.warnings.length ? ` · ⚠ ${level.warnings.length} 处断崖偏宽` : ''}`;
    } else {
      previewBox.append(h('div', { class: 'stage-empty' }, '点「生成关卡」'));
    }
    body.append(split(
      h('div', null, previewBox, info, level?.warnings?.length ? h('p', { class: 'warn-text' }, level.warnings.join('；')) : null,
        actionRow(
          btn('生成关卡', { kind: 'primary', onclick: regenerate }),
          btn('换一个种子', { kind: 'quiet', onclick: () => { opts.seed = Math.floor(Math.random() * 999999); regenerate(); } }),
          btn('导出地图 PNG', { kind: 'quiet', onclick: () => level && saveCanvas(renderLevel(level), `side-level-${level.seed}.png`) }),
          btn('导出碰撞 JSON', { kind: 'quiet', onclick: () => level && saveJson({ seed: level.seed, tileSize: level.tileSize, rows: level.rows, cols: level.cols, collisions: level.collisions, spawns: level.spawns, grid: level.grid }, `side-level-${level.seed}.json`) }),
          btn('导出瓦片图集', { kind: 'quiet', onclick: () => {
            if (!level) return;
            const atlas = buildAtlas(level);
            saveCanvas(atlas.canvas, `side-atlas-${level.seed}.png`);
            saveJson(atlas.meta, `side-atlas-${level.seed}.json`);
          } }),
          btn('导出背景层', { kind: 'quiet', onclick: () => {
            if (!level) return;
            const canvas = createCanvas(level.cols * level.tileSize, level.rows * level.tileSize);
            drawBackground(canvas, level, THEMES[level.theme] || THEMES.forest);
            saveCanvas(canvas, `side-bg-${level.seed}.png`);
          } })
        )
      ),
      panel('参数', '种子固定即可复现同一张图；难度参数按整张图生效。',
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, '种子'), seed),
        range({ label: '长度（段）', min: 2, max: 24, step: 1, value: opts.segments, onInput: (value: number) => { opts.segments = value; } }),
        select({ label: '瓦片尺寸', value: String(opts.tileSize), options: [32, 48, 64, 96].map((v) => ({ value: String(v), label: `${v}px` })), onChange: (value: string) => { opts.tileSize = Number(value); } }),
        select({ label: '主题', value: opts.theme, options: Object.entries(THEMES).map(([id, t]) => ({ value: id, label: t.name })), onChange: (value: string) => { opts.theme = value; } }),
        range({ label: '平台密度', min: 0, max: 10, step: 1, value: Math.round(opts.platformDensity * 10), onInput: (value: number) => { opts.platformDensity = value / 10; } }),
        range({ label: '断崖频率', min: 0, max: 10, step: 1, value: Math.round(opts.gapRate * 10), onInput: (value: number) => { opts.gapRate = value / 10; } }),
        range({ label: '高度起伏', min: 0, max: 5, step: 1, value: Math.round(opts.heightVar), onInput: (value: number) => { opts.heightVar = value; } }),
        actionRow(btn('应用并生成', { kind: 'primary', onclick: regenerate }))
      )
    ));
  }

  function paintStitch() {
    const files: HTMLImageElement[] = [];
    const box = h('div', { class: 'side-preview' });
    const info = h('p', { class: 'stage-info' }, '按顺序横向拼接，自动按最高一张对齐底部。');
    const input = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
    input.addEventListener('change', async () => {
      for (const file of Array.from((input.files || []) as FileList)) files.push(await loadImageFromFile(file as File));
      paintStitchPreview();
    });
    let merged: HTMLCanvasElement | null = null;
    const offsets: any[] = [];
    function paintStitchPreview() {
      box.replaceChildren();
      if (!files.length) { box.append(h('div', { class: 'stage-empty' }, '选择多张横版分段图')); return; }
      const height = Math.max(...files.map((image) => image.height));
      const scale = files.map((image) => height / image.height);
      const width = files.reduce((sum, image, index) => sum + image.width * scale[index], 0);
      merged = createCanvas(width, height);
      const ctx = merged.getContext('2d');
      let offset = 0;
      offsets.length = 0;
      files.forEach((image, index) => {
        const w = image.width * scale[index];
        ctx.drawImage(image, offset, height - image.height * scale[index], w, image.height * scale[index]);
        offsets.push({ index, x: Math.round(offset), w: Math.round(w), source: image.src.slice(0, 60) });
        offset += w;
      });
      box.append(previewCanvas(merged, 'side-canvas'));
      info.textContent = `已拼接 ${files.length} 张，总宽 ${Math.round(width)}px，高 ${height}px。`;
    }
    body.append(split(
      h('div', null, box, info, actionRow(
        btn('选择分段图', { kind: 'primary', onclick: () => input.click() }),
        input,
        btn('导出拼接 PNG', { kind: 'quiet', onclick: () => merged && saveCanvas(merged, `side-stitched-${Date.now()}.png`) }),
        btn('导出分段偏移 JSON', { kind: 'quiet', onclick: () => saveJson({ offsets }, 'side-stitch-offsets.json') }),
        btn('清空', { kind: 'quiet', onclick: () => { files.length = 0; paintStitchPreview(); } })
      )),
      panel('拼接说明', '适合把程序化生成的分段、手绘长图或截图按顺序接成一张超长横版地图。',
        h('p', { class: 'muted small' }, '• 高度不同时按最高一张等比缩放，底部对齐。'),
        h('p', { class: 'muted small' }, '• 拼接后可继续到「提取素材」切片。'),
        h('p', { class: 'muted small' }, '• 需要交错/重叠拼接时，先在画布工具里对齐再导入。'))
    ));
    paintStitchPreview();
  }

  function paintExtract() {
    let source: HTMLCanvasElement | null = null;
    let result: { canvas: HTMLCanvasElement; meta: any } | null = null;
    const box = h('div', { class: 'side-preview' });
    const info = h('p', { class: 'stage-info' }, '上传一张横版长图或地块图，自动提取不重复的瓦片。');
    let tileSize = 48;
    let segmentWidth = 1024;
    const drop = h('div', { class: 'dropzone' }, h('div', { class: 'drop-preview' }, h('span', { class: 'drop-icon' }, '↥'), h('strong', null, '上传要提取的长图'), h('small', null, 'PNG / JPG；按网格扫描不重复瓦片')));
    const file = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    drop.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      const image = await loadImageFromFile(chosen);
      source = createCanvas(image.width, image.height);
      source.getContext('2d').drawImage(image, 0, 0);
      extract();
    });
    function extract() {
      if (!source) return;
      const cols = Math.floor(source.width / tileSize);
      const rows = Math.floor(source.height / tileSize);
      const ctx = source.getContext('2d', { willReadFrequently: true });
      const seen = new Set<string>();
      const tiles: any[] = [];
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const data = ctx.getImageData(x * tileSize, y * tileSize, tileSize, tileSize).data;
        let key = '';
        for (let i = 0; i < data.length; i += 4 * 17) key += `${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]};`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (tiles.length >= 256) break;
        tiles.push({ x: x * tileSize, y: y * tileSize });
      }
      const atlas = createCanvas(tileSize * Math.min(tiles.length, 16), tileSize * Math.ceil(tiles.length / 16));
      const actx = atlas.getContext('2d');
      tiles.forEach((tile, index) => actx.drawImage(source!, tile.x, tile.y, tileSize, tileSize, (index % 16) * tileSize, Math.floor(index / 16) * tileSize, tileSize, tileSize));
      result = { canvas: atlas, meta: { tileSize, unique: tiles.length, cells: tiles.map((tile, index) => ({ index, sx: tile.x, sy: tile.y, ax: (index % 16) * tileSize, ay: Math.floor(index / 16) * tileSize })) } };
      box.replaceChildren(previewCanvas(atlas, 'side-canvas'));
      info.textContent = `扫描 ${cols}×${rows} 格，找到 ${tiles.length} 个不重复瓦片。`;
    }
    body.append(split(
      h('div', null, drop, file, box, info, actionRow(
        btn('重新提取', { kind: 'quiet', onclick: extract }),
        btn('导出图集 PNG', { kind: 'quiet', onclick: () => result && saveCanvas(result.canvas, 'side-extracted-atlas.png') }),
        btn('导出图集 JSON', { kind: 'quiet', onclick: () => result && saveJson(result.meta, 'side-extracted-atlas.json') })
      )),
      panel('提取设置', '按瓦片尺寸扫描长图；适合从 AI 生成的长图里回收可复用素材。',
        range({ label: '瓦片尺寸', min: 8, max: 128, step: 8, value: tileSize, suffix: 'px', onInput: (value: number) => { tileSize = value; extract(); } }),
        range({ label: '分段宽度', min: 256, max: 4096, step: 128, value: segmentWidth, suffix: 'px', onInput: (value: number) => { segmentWidth = value; } }),
        actionRow(btn('按宽度切段', { kind: 'primary', onclick: () => {
          if (!source) { toast('先上传长图', 'error'); return; }
          for (let start = 0, index = 0; start < source.width; start += segmentWidth, index++) {
            const width = Math.min(segmentWidth, source.width - start);
            const piece = createCanvas(width, source.height);
            piece.getContext('2d').drawImage(source, start, 0, width, source.height, 0, 0, width, source.height);
            saveCanvas(piece, `side-segment-${String(index + 1).padStart(2, '0')}.png`);
          }
          toast('已按宽度导出分段');
        } })),
        h('p', { class: 'muted small' }, '图集坐标 JSON 可直接用于 Tiled / Godot 的 AtlasTexture 或代码裁切。')
      )
    ));
  }

  regenerate();
  return () => {};
}
