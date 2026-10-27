import { createCanvas, trimAlpha } from './canvas.js';
/** Keep transforms immutable so undo restores the original pixels. */
export function flipFrames(frames, horizontal) {
    return frames.map(frame => {
        const canvas = createCanvas(frame.canvas.width, frame.canvas.height), ctx = canvas.getContext('2d');
        ctx.translate(horizontal ? canvas.width : 0, horizontal ? 0 : canvas.height);
        ctx.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
        ctx.drawImage(frame.canvas, 0, 0);
        return { name: frame.name, canvas };
    });
}
export function actionGroups(frames, length) {
    if (!Number.isInteger(length) || length < 1 || length > 128)
        throw new Error('每组帧数必须为 1–128 的整数');
    const groups = [];
    for (let i = 0; i < frames.length; i += length)
        groups.push(frames.slice(i, i + length));
    return groups;
}
/** Single-character 3x4 sheet. Inputs must already be ordered down/left/right/up. */
export function characterSheet(frames, cell) {
    if (frames.length !== 12)
        throw new Error('角色表需要恰好 12 帧：下、左、右、上，每方向 3 帧');
    if (!Number.isInteger(cell) || cell < 8 || cell > 512)
        throw new Error('角色单格尺寸必须为 8–512 像素');
    const canvas = createCanvas(cell * 3, cell * 4), ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    frames.forEach((frame, i) => {
        const scale = Math.min(cell / frame.canvas.width, cell / frame.canvas.height);
        const w = Math.max(1, Math.floor(frame.canvas.width * scale)), h = Math.max(1, Math.floor(frame.canvas.height * scale));
        ctx.drawImage(frame.canvas, i % 3 * cell + Math.floor((cell - w) / 2), Math.floor(i / 3) * cell + cell - h, w, h);
    });
    return canvas;
}
export function splitSheet(source, cols, rows, margin = 0, gap = 0) {
    if (![cols, rows, margin, gap].every(Number.isInteger) || cols < 1 || rows < 1 || cols * rows > 128 || margin < 0 || gap < 0)
        throw new Error('行列必须为正整数，总帧数不超过 128');
    const width = (source.width - margin * 2 - gap * (cols - 1)) / cols, height = (source.height - margin * 2 - gap * (rows - 1)) / rows;
    if (width < 1 || height < 1 || !Number.isInteger(width) || !Number.isInteger(height))
        throw new Error('图像尺寸扣除边距和间隔后，必须能被行列数整除');
    const frames = [];
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
            const canvas = createCanvas(width, height);
            canvas.getContext('2d').drawImage(source, margin + c * (width + gap), margin + r * (height + gap), width, height, 0, 0, width, height);
            frames.push({ name: `frame-${String(frames.length + 1).padStart(3, '0')}`, canvas });
        }
    return frames;
}
export function normalizeFrames(frames, trim, width = 0, height = 0) {
    const contents = frames.map(f => ({ name: f.name, canvas: trim ? trimAlpha(f.canvas).canvas : f.canvas }));
    const w = width || Math.max(...contents.map(f => f.canvas.width)), h = height || Math.max(...contents.map(f => f.canvas.height));
    if (w < 1 || h < 1 || w > 4096 || h > 4096 || w * h * frames.length > 64 * 1024 * 1024)
        throw new Error('统一帧尺寸过大');
    return contents.map(f => { const canvas = createCanvas(w, h); canvas.getContext('2d').drawImage(f.canvas, Math.floor((w - f.canvas.width) / 2), h - f.canvas.height); return { name: f.name, canvas }; });
}
export function joinFrames(frames, cols, padding = 0) {
    if (!frames.length || !Number.isInteger(cols) || cols < 1 || cols > 128)
        throw new Error('请先准备帧，并填写有效列数');
    const w = frames[0].canvas.width, h = frames[0].canvas.height, rows = Math.ceil(frames.length / cols);
    const width = cols * (w + padding) - padding, height = rows * (h + padding) - padding;
    if (width * height > 32 * 1024 * 1024)
        throw new Error('合图尺寸过大，请减少列数或帧尺寸');
    const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
    const rects = frames.map((f, i) => { const x = i % cols * (w + padding), y = Math.floor(i / cols) * (h + padding); ctx.drawImage(f.canvas, x, y); return { name: f.name, frame: { x, y, w, h } }; });
    return { canvas, manifest: { image: 'spritesheet.png', width, height, frameWidth: w, frameHeight: h, columns: cols, rows, frames: rects } };
}
