import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const queues = new Map<string, Promise<unknown>>();
const validId = (id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id))
        throw new Error('地图工程编号无效');
    return id;
};
export function validateMapState(state: any) {
    if (state?.format !== 'game-workbench-stitch' || state.version !== 1 || !Array.isArray(state.chunks) || state.chunks.length > 64 || !Array.isArray(state.pending) || state.pending.length > 32)
        throw new Error('地图状态格式无效');
    if (typeof state.name !== 'string' || state.name.length > 80 || !state.name.trim())
        throw new Error('请填写地图名称');
    const s = state.settings;
    if (!s || ![s.width, s.height].every(n => Number.isInteger(n) && n >= 1 && n <= 4096) || ![s.overlapX, s.overlapY].every(n => Number.isFinite(n) && n >= 0 && n <= .45) || !['topdown', 'isometric', 'side'].includes(state.mode))
        throw new Error('地图参数无效');
    if (state.chunks.length + state.pending.length > 64 || s.width * s.height * (state.chunks.length + state.pending.length) > 64 * 1024 * 1024)
        throw new Error('地图超过内存保护上限');
    const seen = new Set();
    for (const c of [...state.chunks, ...state.pending]) {
        if (!Number.isInteger(c.x) || !Number.isInteger(c.y) || Math.abs(c.x) > 64 || Math.abs(c.y) > 64 || !['whole', 'ground', 'objects'].includes(c.layer))
            throw new Error('地图格坐标或图层无效');
        const key = `${c.layer}:${c.x}:${c.y}`;
        if (seen.has(key))
            throw new Error('地图格重复');
        seen.add(key);
        if (c.source !== undefined && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(c.source))
            throw new Error('地图块必须是内嵌 PNG');
        if (c.source) {
            const raw = Buffer.from(c.source.split(',')[1], 'base64');
            if (raw.length < 24 || raw.toString('hex', 0, 8) !== '89504e470d0a1a0a' || raw.readUInt32BE(16) !== s.width || raw.readUInt32BE(20) !== s.height)
                throw new Error('地图块 PNG 尺寸与单格参数不符');
        }
        if (c.taskId !== undefined && !/^[a-f0-9-]{36}$/.test(c.taskId))
            throw new Error('扩图任务编号无效');
    }
    if (state.chunks.some(c => typeof c.source !== 'string') || state.pending.some(c => typeof c.taskId !== 'string'))
        throw new Error('地图块或待生成任务不完整');
    if (JSON.stringify(state).length > 64 * 1024 * 1024)
        throw new Error('状态文件超过 64 MB');
    return state;
}
export async function listMapProjects(root: string) {
    const dir = join(root, 'map-projects');
    await mkdir(dir, { recursive: true });
    const names = (await readdir(dir)).filter(n => /^[a-f0-9-]{36}\.info\.json$/.test(n));
    const rows = await Promise.all(names.map(async (name) => JSON.parse(await readFile(join(dir, name), 'utf8'))));
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function loadMapProject(root: string, id: string) { return validateMapState(JSON.parse(await readFile(join(root, 'map-projects', validId(id) + '.json'), 'utf8'))); }
export async function saveMapProject(root: string, input: any) {
    const id = input.id ? validId(input.id) : randomUUID(), state = validateMapState(input.state), dir = join(root, 'map-projects');
    const info = { id, name: state.name, updatedAt: new Date().toISOString(), chunks: state.chunks.length, pending: state.pending.length };
    const operation = (queues.get(dir) || Promise.resolve()).catch(() => { }).then(async () => {
        await mkdir(dir, { recursive: true });
        for (const [name, data] of [[id + '.json', state], [id + '.info.json', info]] as const) {
            const tmp = join(dir, name + '.' + randomUUID() + '.tmp');
            try {
                await writeFile(tmp, JSON.stringify(data));
                await rename(tmp, join(dir, name));
            }
            finally {
                await rm(tmp, { force: true });
            }
        }
        return info;
    });
    queues.set(dir, operation);
    try {
        return await operation;
    }
    finally {
        if (queues.get(dir) === operation)
            queues.delete(dir);
    }
}
