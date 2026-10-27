/** 画布工具：抠图、放大、调色、量化、裁边。全部在浏览器本地完成。 */

export function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) {
      reject(new Error('请选择 PNG、JPG 或 WebP 图片'));
      return;
    }
    if(file.size>32*1024*1024){reject(new Error('单张图片不能超过 32 MB'));return;}
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url);if(image.width*image.height>32*1024*1024){reject(new Error('图片像素总量超过 32 MP，请先缩小'));return;}resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    image.src = url;
  });
}

export function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = url;
  });
}

export function imageToCanvas(image: HTMLImageElement) {
  const canvas = createCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = 0.94): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export function canvasToDataURL(canvas) {
  return canvas.toDataURL('image/png');
}

export function cloneCanvas(source) {
  const canvas = createCanvas(source.width, source.height);
  canvas.getContext('2d').drawImage(source, 0, 0);
  return canvas;
}

export function resizeCanvas(source, width, height, smooth = true) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = smooth;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function scaleCanvas(source, factor, smooth = false) {
  return resizeCanvas(source, source.width * factor, source.height * factor, smooth);
}

/** 取四角出现最多的颜色作为背景色（纯色/绿幕素材足够用）。 */
export function detectBackdrop(canvas, sample = 6) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const points = [];
  const inset = 1;
  for (let i = 0; i < sample; i++) {
    const t = inset + (i / Math.max(1, sample - 1)) * (canvas.width - inset * 2 - 1);
    points.push([t, inset], [t, canvas.height - inset - 1]);
    const u = inset + (i / Math.max(1, sample - 1)) * (canvas.height - inset * 2 - 1);
    points.push([inset, u], [canvas.width - inset - 1, u]);
  }
  const buckets = new Map();
  for (const [x, y] of points) {
    const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    if (d[3] < 8) continue;
    const key = `${d[0] >> 3},${d[1] >> 3},${d[2] >> 3}`;
    const row = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
    row.r += d[0]; row.g += d[1]; row.b += d[2]; row.n += 1;
    buckets.set(key, row);
  }
  let best = null;
  for (const row of buckets.values()) if (!best || row.n > best.n) best = row;
  if (!best) return { r: 255, g: 255, b: 255 };
  return { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n) };
}

/**
 * 颜色键控去背。
 * tolerance 0-200（欧氏距离），softness 0-120 决定边缘过渡宽度，
 * shrink 0-4 像素收边，despill 抹掉边缘残留的背景色偏。
 */
export function matteKey(canvas: HTMLCanvasElement, options: any = {}) {
  const { r = 255, g = 255, b = 255, tolerance = 60, softness = 40, shrink = 0, despill = true } = options;
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, width, height);
  const pixels = data.data;
  const soft = Math.max(1, softness);
  for (let i = 0; i < pixels.length; i += 4) {
    const dr = pixels[i] - r;
    const dg = pixels[i + 1] - g;
    const db = pixels[i + 2] - b;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    let alpha = 1;
    if (distance <= tolerance) alpha = 0;
    else if (distance < tolerance + soft) alpha = (distance - tolerance) / soft;
    else alpha = 1;
    if (alpha < 1) {
      pixels[i + 3] = Math.round(pixels[i + 3] * alpha);
      if (despill && alpha > 0) {
        const lum = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114);
        const bgLum = (r * 0.299 + g * 0.587 + b * 0.114);
        const mix = Math.max(0, 1 - alpha) * 0.9;
        if (lum > bgLum) {
          pixels[i] = Math.round(pixels[i] * (1 - mix) + lum * mix);
          pixels[i + 1] = Math.round(pixels[i + 1] * (1 - mix) + lum * mix);
          pixels[i + 2] = Math.round(pixels[i + 2] * (1 - mix) + lum * mix);
        }
      }
    }
  }
  ctx.putImageData(data, 0, 0);
  return shrink > 0 ? erodeAlpha(canvas, shrink) : canvas;
}

export function erodeAlpha(canvas, radius = 1) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const source = ctx.getImageData(0, 0, width, height);
  const data = new Uint8ClampedArray(source.data);
  const out = new Uint8ClampedArray(source.data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let min = 255;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = Math.min(width - 1, Math.max(0, x + dx));
          const ny = Math.min(height - 1, Math.max(0, y + dy));
          const a = data[(ny * width + nx) * 4 + 3];
          if (a < min) min = a;
        }
      }
      out[(y * width + x) * 4 + 3] = min;
    }
  }
  const result = createCanvas(width, height);
  result.getContext('2d').putImageData(new ImageData(out, width, height), 0, 0);
  return result;
}

/** 裁掉全透明外边，返回新画布与裁切信息。 */
export function trimAlpha(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 2) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (right < 0) return { canvas: cloneCanvas(canvas), rect: { x: 0, y: 0, width, height } };
  const rect = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  const out = createCanvas(rect.width, rect.height);
  out.getContext('2d').drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  return { canvas: out, rect };
}

/** 亮度 / 对比 / 饱和 / 色相，走 canvas filter，速度快。 */
export function adjustCanvas(canvas: HTMLCanvasElement, { brightness = 100, contrast = 100, saturation = 100, hue = 0 }: any = {}) {
  const out = createCanvas(canvas.width, canvas.height);
  const ctx = out.getContext('2d');
  ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) hue-rotate(${hue}deg)`;
  ctx.drawImage(canvas, 0, 0);
  return out;
}

/** 像素化：先缩小再最近邻放大，得到硬边像素块。 */
export function pixelate(canvas, block = 4) {
  const size = Math.max(1, Math.round(block));
  if (size === 1) return cloneCanvas(canvas);
  const small = resizeCanvas(canvas, Math.max(1, Math.round(canvas.width / size)), Math.max(1, Math.round(canvas.height / size)), true);
  return resizeCanvas(small, canvas.width, canvas.height, false);
}

/** 把尺寸规整到网格的整数倍（以中心对齐）。 */
export function alignToGrid(canvas, grid = 8) {
  const step = Math.max(1, Math.round(grid));
  const width = Math.max(step, Math.round(canvas.width / step) * step);
  const height = Math.max(step, Math.round(canvas.height / step) * step);
  const out = createCanvas(width, height);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, Math.round((width - canvas.width) / 2), Math.round((height - canvas.height) / 2));
  return out;
}

/**
 * 颜色量化（像素画常用）。用直方图 + k-means，量化后颜色更少、更统一。
 * 返回新画布；透明像素保持透明。
 */
export function quantizeCanvas(canvas: HTMLCanvasElement, colors = 32, dither = false) {
  const k = Math.max(2, Math.min(256, Math.round(colors)));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const source = ctx.getImageData(0, 0, width, height);
  const pixels = source.data;

  // 5-bit 直方图，避免逐像素聚类。
  const buckets = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 8) continue;
    const key = ((pixels[i] >> 3) << 10) | ((pixels[i + 1] >> 3) << 5) | (pixels[i + 2] >> 3);
    const row = buckets.get(key) || { key, r: 0, g: 0, b: 0, n: 0 };
    row.r += pixels[i]; row.g += pixels[i + 1]; row.b += pixels[i + 2]; row.n += 1;
    buckets.set(key, row);
  }
  const points = [...buckets.values()];
  if (!points.length) return cloneCanvas(canvas);
  const centers = chooseCenters(points, k);
  for (let iteration = 0; iteration < 6; iteration++) {
    const sums = centers.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (const point of points) {
      const index = nearestCenter(centers, point.r / point.n, point.g / point.n, point.b / point.n);
      sums[index].r += point.r; sums[index].g += point.g; sums[index].b += point.b; sums[index].n += point.n;
    }
    for (let i = 0; i < centers.length; i++) {
      if (sums[i].n) {
        centers[i] = { r: sums[i].r / sums[i].n, g: sums[i].g / sums[i].n, b: sums[i].b / sums[i].n };
      }
    }
  }
  const lookup = new Map();
  for (const point of points) {
    const index = nearestCenter(centers, point.r / point.n, point.g / point.n, point.b / point.n);
    lookup.set(point.key, centers[index]);
  }
  void dither;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 8) continue;
    const key = ((pixels[i] >> 3) << 10) | ((pixels[i + 1] >> 3) << 5) | (pixels[i + 2] >> 3);
    const center = lookup.get(key);
    if (!center) continue;
    pixels[i] = Math.round(center.r); pixels[i + 1] = Math.round(center.g); pixels[i + 2] = Math.round(center.b);
  }
  const out = createCanvas(width, height);
  out.getContext('2d').putImageData(source, 0, 0);
  return out;
}

function chooseCenters(points, k) {
  const sorted = [...points].sort((a, b) => b.n - a.n);
  const centers = [];
  for (let i = 0; i < k; i++) {
    const point = sorted[Math.floor((i / k) * (sorted.length - 1))] || sorted[0];
    centers.push({ r: point.r / point.n, g: point.g / point.n, b: point.b / point.n });
  }
  return centers;
}

function nearestCenter(centers, r, g, b) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const center = centers[i];
    const dr = r - center.r;
    const dg = g - center.g;
    const db = b - center.b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) { bestDistance = distance; best = i; }
  }
  return best;
}

/** 取主色（给界面上的色板/描边用）。 */
export function dominantColors(canvas, count = 6) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 24000)));
  const data = ctx.getImageData(0, 0, width, height).data;
  const buckets = new Map();
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 32) continue;
      const key = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`;
      const row = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
      row.r += data[i]; row.g += data[i + 1]; row.b += data[i + 2]; row.n += 1;
      buckets.set(key, row);
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((row) => ({ r: Math.round(row.r / row.n), g: Math.round(row.g / row.n), b: Math.round(row.b / row.n), n: row.n }));
}

export function toHex({ r, g, b }) {
  const value = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${value(r)}${value(g)}${value(b)}`;
}

export function fromHex(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!match) return { r: 255, g: 255, b: 255 };
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}
