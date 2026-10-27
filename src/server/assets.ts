import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const TYPES: Record<string, {
    ext: string;
    header: Buffer;
}> = {
    'image/png': { ext: 'png', header: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) },
    'image/jpeg': { ext: 'jpg', header: Buffer.from([255, 216, 255]) },
    'image/gif': { ext: 'gif', header: Buffer.from('GIF8') },
    'application/vnd.adobe.photoshop': { ext: 'psd', header: Buffer.from('8BPS') },
    'application/zip': { ext: 'zip', header: Buffer.from([80, 75, 3, 4]) },
    'image/webp': { ext: 'webp', header: Buffer.from('RIFF') },
    'application/json': { ext: 'json', header: Buffer.from('{') }
};
export async function saveAsset(root: string, input: {
    name?: string;
    data: string;
}): Promise<{
    path: string;
    file: string;
}> {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(input.data || '');
    if (!match || !TYPES[match[1]])
        throw new Error('只支持图片、ZIP 或画布工程 JSON');
    const type = TYPES[match[1]], bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 64 * 1024 * 1024 || !bytes.subarray(0, type.header.length).equals(type.header))
        throw new Error('素材格式或大小无效');
    if (match[1] === 'image/webp' && bytes.toString('ascii', 8, 12) !== 'WEBP')
        throw new Error('WebP 文件格式无效');
    if (match[1] === 'application/json' && !['game-workbench-layers','game-workbench-stitch'].includes(JSON.parse(bytes.toString('utf8')).format))
        throw new Error('只支持画布工程 JSON');
    const name = String(input.name || 'asset').replace(/\.[a-z0-9]+$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\.{2,}/g, '_').slice(0, 80) || 'asset';
    const file = `${name}-${randomUUID().slice(0, 8)}.${type.ext}`;
    await mkdir(root, { recursive: true });
    const path = join(root, file);
    await writeFile(path, bytes, { flag: 'wx' });
    return { path, file };
}
export async function encodeGif(root: string, input: {
    frames: string[];
    fps: number;
}): Promise<Buffer> {
    if (!Array.isArray(input.frames) || input.frames.length < 1 || input.frames.length > 128)
        throw new Error('GIF 需要 1–128 帧');
    const fps = Number(input.fps);
    if (!Number.isFinite(fps) || fps < 1 || fps > 60)
        throw new Error('帧率必须为 1–60');
    const dir = join(root, '.gif-' + randomUUID());
    await mkdir(dir, { recursive: true });
    try {
        let width = 0, height = 0, pixels = 0, size = 0;
        for (const [i, data] of input.frames.entries()) {
            const raw = Buffer.from(String(data).replace(/^data:image\/png;base64,/, ''), 'base64');
            size += raw.length;
            if (raw.length < 24 || !raw.subarray(0, 8).equals(TYPES['image/png'].header) || size > 64 * 1024 * 1024)
                throw new Error('GIF 帧必须是有效 PNG，且总大小不超过 64 MB');
            const w = raw.readUInt32BE(16), h = raw.readUInt32BE(20);
            pixels += w * h;
            if (!w || !h || w > 4096 || h > 4096 || pixels > 64 * 1024 * 1024)
                throw new Error('GIF 帧像素总量过大');
            if (i === 0) {
                width = w;
                height = h;
            }
            else if (width !== w || height !== h)
                throw new Error('GIF 各帧尺寸必须相同');
            await writeFile(join(dir, `${String(i).padStart(4, '0')}.png`), raw);
        }
        const media: any = await import(new URL('../modules/material/lib/media.js', import.meta.url).href);
        await media.runFfmpeg(['-y', '-framerate', String(fps), '-i', join(dir, '%04d.png'), '-filter_complex', '[0:v]split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128', '-loop', '0', join(dir, 'animation.gif')], 120000);
        return await readFile(join(dir, 'animation.gif'));
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
}
