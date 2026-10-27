import { createCanvas } from './canvas.js';
export type MapLayer = 'whole' | 'ground' | 'objects';
export interface MapChunk {
    x: number;
    y: number;
    layer: MapLayer;
    canvas: HTMLCanvasElement;
}
export interface StitchSettings {
    width: number;
    height: number;
    overlapX: number;
    overlapY: number;
}
export function stride(settings: StitchSettings) {
    const { width, height, overlapX, overlapY } = settings;
    if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 4096) || ![overlapX, overlapY].every(n => Number.isFinite(n) && n >= 0 && n <= .45))
        throw new Error('地图尺寸或重叠比例无效');
    return { x: Math.max(1, Math.round(width * (1 - overlapX))), y: Math.max(1, Math.round(height * (1 - overlapY))) };
}
export const chunkKey = (x: number, y: number, layer: string) => `${layer}:${x}:${y}`;
export function mapBounds(chunks: MapChunk[], settings: StitchSettings) {
    if (!chunks.length)
        throw new Error('请先导入地图');
    const step = stride(settings), left = Math.min(...chunks.map(c => c.x)) * step.x, top = Math.min(...chunks.map(c => c.y)) * step.y;
    return { left, top, width: Math.max(...chunks.map(c => c.x)) * step.x + settings.width - left, height: Math.max(...chunks.map(c => c.y)) * step.y + settings.height - top };
}
export function drawMap(ctx: CanvasRenderingContext2D, chunks: MapChunk[], settings: StitchSettings, view = 'composite') {
    const step = stride(settings);
    const ordered = ['whole', 'ground', 'objects'];
    const chosen = chunks.filter(c => view === 'composite' || (view === 'mask' ? c.layer === 'objects' : c.layer === view));
    chosen.sort((a, b) => ordered.indexOf(a.layer) - ordered.indexOf(b.layer) || a.y - b.y || a.x - b.x);
    for (const chunk of chosen)
        ctx.drawImage(chunk.canvas, chunk.x * step.x, chunk.y * step.y, settings.width, settings.height);
}
export function composeMap(chunks: MapChunk[], settings: StitchSettings, view = 'composite') {
    const bounds = mapBounds(chunks, settings);
    if (bounds.width > 16384 || bounds.height > 16384 || bounds.width * bounds.height > 32 * 1024 * 1024)
        throw new Error('整图超过 3200 万像素或单边 16384，请导出分块包');
    const canvas = createCanvas(bounds.width, bounds.height), ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    if (view === 'mask') {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.translate(-bounds.left, -bounds.top);
    drawMap(ctx, chunks, settings, view);
    if (view === 'mask') {
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        // Object coverage is computed independently from the black background.
        const coverage = createCanvas(canvas.width, canvas.height), c = coverage.getContext('2d')!;
        c.translate(-bounds.left, -bounds.top);
        drawMap(c, chunks, settings, 'objects');
        const alpha = c.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < data.data.length; i += 4) {
            data.data[i] = data.data[i + 1] = data.data[i + 2] = alpha[i + 3];
            data.data[i + 3] = 255;
        }
        ctx.putImageData(data, 0, 0);
    }
    return { canvas, bounds };
}
/** Only overlapping neighbour pixels appear in the target. Blank pixels remain transparent. */
export function expansionReferences(chunks: MapChunk[], settings: StitchSettings, x: number, y: number, layer: MapLayer) {
    const step = stride(settings), context = createCanvas(settings.width, settings.height), ctx = context.getContext('2d')!;
    const nearby = chunks.filter(c => (c.layer === layer || c.layer === 'whole') && Math.abs(c.x - x) <= 1 && Math.abs(c.y - y) <= 1 && (c.x !== x || c.y !== y));
    if (!nearby.length)
        throw new Error('目标格需要至少一个已有相邻地图块');
    drawMap(ctx, nearby.map(c => ({ ...c, x: c.x - x, y: c.y - y })), settings);
    const mask = createCanvas(settings.width, settings.height), m = mask.getContext('2d')!, pixels = ctx.getImageData(0, 0, context.width, context.height), out = m.createImageData(mask.width, mask.height);
    for (let i = 0; i < out.data.length; i += 4) {
        const v = pixels.data[i + 3] ? 0 : 255;
        out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
        out.data[i + 3] = 255;
    }
    m.putImageData(out, 0, 0);
    return { context, mask, anchor: nearby[0].canvas };
}
export function frontier(chunks: MapChunk[], occupied: Set<string>, layer: MapLayer) {
    const coords = new Map<string, {
        x: number;
        y: number;
    }>();
    for (const c of chunks)
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
            const x = c.x + dx, y = c.y + dy, key = chunkKey(x, y, layer);
            if (!occupied.has(key))
                coords.set(key, { x, y });
        }
    return [...coords.values()].sort((a, b) => Math.abs(a.x) + Math.abs(a.y) - Math.abs(b.x) - Math.abs(b.y) || a.y - b.y || a.x - b.x);
}
