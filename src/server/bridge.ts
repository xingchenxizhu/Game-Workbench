import { mkdir, readdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export interface ImageTask {
    id: string;
    prompt: string;
    size: string;
    transparent: boolean;
    status: 'waiting' | 'completed' | 'expired' | 'interrupted' | 'cancelled';
    createdAt: string;
    completedAt?: string;
    references: string[];
    source: string;
    result?: string;
    message?: string;
    automation?: {
        stage: string;
        message?: string;
        threadId?: string;
        updatedAt?: string;
    };
}
interface Waiter {
    resolve: (bytes: Buffer) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}
export class ImageBridge {
    root: string;
    waiters: Map<string, Waiter>;
    baseUrl = '';
    onCreated?: (task: ImageTask) => void;
    private mutations = new Map<string, Promise<any>>();
    private mutate<T>(id: string, fn: () => Promise<T>): Promise<T> { const prior = this.mutations.get(id) || Promise.resolve(); const next = prior.catch(() => { }).then(fn); this.mutations.set(id, next); void next.finally(() => { if (this.mutations.get(id) === next)
        this.mutations.delete(id); }).catch(() => { }); return next; }
    updateAutomation(id: string, automation: any) { return this.mutate(id, async () => { const task = await this.get(id); if (!['completed', 'cancelled'].includes(task.status)) {
        task.automation = automation;
        await this.save(task);
    } return task; }); }
    interrupt(id: string, message = '自动生图已停止') { return this.mutate(id, async () => { const task = await this.get(id); if (['completed', 'cancelled'].includes(task.status))
        return task; task.status = 'interrupted'; task.message = message; task.automation = { stage: 'failed', message }; await this.save(task); const waiter = this.waiters.get(id); if (waiter) {
        clearTimeout(waiter.timer);
        this.waiters.delete(id);
        waiter.reject(new Error(message));
    } return task; }); }
    constructor(root: string) {
        this.root = root;
        this.waiters = new Map();
    }
    path(id: string): string {
        if (!/^[a-f0-9-]{36}$/.test(id))
            throw new Error('无效的生图任务编号');
        return join(this.root, id);
    }
    async save(task: ImageTask): Promise<void> {
        const dir = this.path(task.id);
        await mkdir(dir, { recursive: true });
        const tmp = join(dir, `task-${randomUUID()}.tmp`);
        await writeFile(tmp, JSON.stringify(task, null, 2));
        await rename(tmp, join(dir, 'task.json'));
    }
    async get(id: string): Promise<ImageTask> {
        return JSON.parse(await readFile(join(this.path(id), 'task.json'), 'utf8')) as ImageTask;
    }
    async list(): Promise<ImageTask[]> {
        await mkdir(this.root, { recursive: true });
        const entries = await readdir(this.root);
        const tasks = await Promise.all(entries.filter((x) => /^[a-f0-9-]{36}$/.test(x)).map(async (x) => {
            try {
                return await this.get(x);
            }
            catch (error: any) {
                if (error.code === 'ENOENT')
                    return undefined;
                throw error;
            }
        }));
        return tasks.filter(Boolean).sort((a, b) => b!.createdAt.localeCompare(a!.createdAt)) as ImageTask[];
    }
    async recover(): Promise<void> {
        for (const task of await this.list()) {
            if (task.status === 'waiting') {
                task.status = 'interrupted';
                task.message = '服务已重启，原调用已中断。可保存结果，重新生成时会创建新任务。';
                if (task.automation)
                    task.automation = { ...task.automation, stage: 'failed', message: task.message };
                await this.save(task);
            }
        }
    }
    async create(input: any): Promise<ImageTask> {
        if (typeof input.prompt !== 'string' || !input.prompt.trim())
            throw new Error('请填写图片描述');
        const task: ImageTask = {
            id: randomUUID(),
            prompt: input.prompt,
            size: input.size || '1024x1024',
            transparent: !!input.transparent,
            status: 'waiting',
            createdAt: new Date().toISOString(),
            references: [],
            source: input.source || 'workbench'
        };
        const dir = this.path(task.id);
        await mkdir(dir, { recursive: true });
        for (const [index, ref] of (input.images || []).entries()) {
            const match = /^data:image\/(png|jpeg|webp);base64,([\s\S]+)$/.exec(ref);
            if (!match)
                throw new Error('参考图必须为 PNG、JPEG 或 WebP 图片');
            const file = `reference-${index + 1}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
            await writeFile(join(dir, file), Buffer.from(match[2], 'base64'));
            task.references.push(file);
        }
        await this.save(task);
        const instruction = [
            '请使用 imagegen 技能及内置 image_gen 工具执行以下游戏素材任务。不要改用 API，也不要用代码绘图代替。',
            '',
            `任务编号：${task.id}`,
            `描述：${task.prompt}`,
            `期望尺寸：${task.size}（以工具实际输出为准）`,
            `透明背景：${task.transparent ? '是，保留真实 alpha' : '按描述要求'}`,
            `参考图：${task.references.length ? task.references.map((x) => join(dir, x)).join('\n') : '无'}`,
            '',
            '先读取参考图，再生成。将选定的生成图片复制到本任务目录，并执行回填：',
            `node tools/complete-image.ts ${task.id} "生成图片的绝对路径"${this.baseUrl ? ' ' + JSON.stringify(this.baseUrl) : ''}`,
            '工作目录：游戏工作台。回填后工作台中的等待调用会继续。若调用已超时，图片仍可从任务页下载再导入。'
        ].join('\n');
        await writeFile(join(dir, '交给ChatGPT生图.md'), instruction);
        this.onCreated?.(task);
        return task;
    }
    async wait(task: ImageTask, timeoutMs = 1800000): Promise<Buffer> {
        return new Promise<Buffer>((resolve, reject) => {
            const timer = setTimeout(async () => {
                let message = '';
                await this.mutate(task.id, async () => { const latest = await this.get(task.id); if (latest.status !== 'waiting')
                    return; this.waiters.delete(task.id); latest.status = 'expired'; message = latest.message = '等待生图超时，可重试或继续回填结果'; await this.save(latest); }).catch(() => { });
                if (message)
                    reject(new Error(message));
            }, timeoutMs);
            this.waiters.set(task.id, { resolve, reject, timer });
        });
    }
    async complete(id: string, bytes: Buffer): Promise<ImageTask> {
        return this.mutate(id, async () => {
            const task = await this.get(id);
            let ext: string;
            if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
                ext = 'png';
            else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
                ext = 'jpg';
            else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
                ext = 'webp';
            else
                throw new Error('结果不是 PNG、JPEG 或 WebP 图片');
            if (task.status === 'completed' || task.status === 'cancelled')
                throw new Error('任务已完成或取消，请新建任务');
            task.result = `result.${ext}`;
            task.completedAt = new Date().toISOString();
            task.status = 'completed';
            if (task.automation)
                task.automation = { ...task.automation, stage: 'completed' };
            await writeFile(join(this.path(id), task.result), bytes);
            await this.save(task);
            const waiter = this.waiters.get(id);
            if (waiter) {
                clearTimeout(waiter.timer);
                this.waiters.delete(id);
                waiter.resolve(bytes);
            }
            return task;
        });
    }
    async cancel(id: string): Promise<ImageTask> {
        return this.mutate(id, async () => {
            const task = await this.get(id);
            if (task.status === 'completed')
                throw new Error('已完成任务不能取消');
            task.status = 'cancelled';
            await this.save(task);
            const waiter = this.waiters.get(id);
            if (waiter) {
                clearTimeout(waiter.timer);
                this.waiters.delete(id);
                waiter.reject(new Error('用户取消了 ChatGPT 生图任务'));
            }
            return task;
        });
    }
}
