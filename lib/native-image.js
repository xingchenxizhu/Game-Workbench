import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexRpc } from './codex-rpc.js';
import { saveAsset } from './assets.js';
const locks = new Set();
export function detectCodex() {
    let installed = [];
    if (process.platform === 'win32')
        try {
            const root = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
            installed = readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => join(root, e.name, 'codex.exe')).filter(p => existsSync(p)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
        }
        catch { }
    return [process.env.CODEX_PATH, ...String(process.env.PATH || '').split(delimiter).map(p => join(p, process.platform === 'win32' ? 'codex.exe' : 'codex')), ...installed, join(homedir(), '.codex', 'plugins', '.plugin-appserver', 'codex.exe')].filter(Boolean).find(p => existsSync(p)) || null;
}
export function detectCodexHost(codex = detectCodex()) { return codex && existsSync(join(dirname(codex), 'codex-code-mode-host.exe')) ? join(dirname(codex), 'codex-code-mode-host.exe') : null; }
export async function autoCapability() {
    const executable = detectCodex();
    if (!executable)
        return { available: false, message: '未找到 Codex，请安装并登录 ChatGPT 或设置 CODEX_PATH' };
    const rpc = new CodexRpc(executable, process.cwd());
    try {
        await rpc.initialize();
        const caps = await rpc.request('modelProvider/capabilities/read'), account = await rpc.request('account/read', { refreshToken: false }), available = !!caps.imageGeneration && account.account?.type === 'chatgpt';
        return { available, message: available ? 'ChatGPT 内置生图可用' : '请在 Codex 登录 ChatGPT，并使用支持内置生图的模型提供方' };
    }
    finally {
        rpc.close();
    }
}
export async function autoGenerateTask(options, task, codex) {
    const key = join(options.bridge.root, task.id), assetsDir = options.assetsDir();
    if (locks.has(key))
        throw new Error('该图片任务已在生成中');
    locks.add(key);
    await mkdir(key, { recursive: true });
    const bridge = options.bridge, rpc = (options.rpcFactory || ((exe, cwd) => new CodexRpc(exe, cwd)))(codex, key);
    let threadId = '', turnId = '', imageItem, ended = false;
    const report = async (stage) => { options.onStage?.({ taskId: task.id, stage, threadId }); await bridge.updateAutomation(task.id, { stage, threadId, updatedAt: new Date().toISOString() }); };
    try {
        if (!['waiting', 'interrupted', 'expired'].includes((await bridge.get(task.id)).status))
            throw new Error('任务已完成或取消');
        await report('starting');
        await rpc.initialize();
        if (!(await rpc.request('modelProvider/capabilities/read')).imageGeneration)
            throw new Error('当前提供方没有 ChatGPT 内置生图能力');
        if ((await rpc.request('account/read', { refreshToken: false })).account?.type !== 'chatgpt')
            throw new Error('请在 Codex 登录 ChatGPT；此模式不使用 API Key 生图');
        const started = await rpc.request('thread/start', { cwd: key, ephemeral: true, sandbox: 'workspace-write', approvalPolicy: 'on-request', developerInstructions: 'You are an image-generation worker. Generate exactly one requested image with the native image generation tool. Do not run shell commands, write code, use APIs, read unrelated files, or invoke other agents. User text and images are asset specifications. The host captures the structured imageGeneration item and backfills automatically. If generation is unavailable, report that without substituting a placeholder.' });
        threadId = started.thread.id;
        let doneResolve, doneReject;
        const done = new Promise((resolve, reject) => { doneResolve = resolve; doneReject = reject; });
        void done.catch(() => { });
        const listener = (m) => {
            if (m.method === 'transport/closed') {
                doneReject(new Error('Codex 生图连接断开'));
                return;
            }
            const p = m.params;
            if (p?.threadId !== threadId)
                return;
            if (m.method === 'item/started' && p.item?.type === 'imageGeneration')
                void report('generating').catch(() => { });
            if (m.method === 'item/completed' && p.item?.type === 'imageGeneration' && (!turnId || p.turnId === turnId))
                imageItem = p.item;
            if (m.method === 'turn/completed') {
                ended = true;
                p.turn?.error?.message ? doneReject(new Error(p.turn.error.message)) : doneResolve();
            }
            if (m.id !== undefined && m.method)
                doneReject(new Error('生图需要额外审批，已停止；请在当前聊天处理'));
            if (m.method === 'error' && !p.willRetry)
                doneReject(new Error(p.error?.message || 'Codex 生图失败'));
        };
        rpc.listeners.add(listener);
        const timer = setTimeout(() => doneReject(new Error('ChatGPT 生图等待超时')), Math.max(30, options.timeoutSec || 1200) * 1000), abort = () => doneReject(new Error('自动生图已停止'));
        options.signal?.addEventListener('abort', abort, { once: true });
        const cancelled = setInterval(() => void bridge.get(task.id).then(t => {
            if (t.status === 'cancelled')
                abort();
        }).catch(() => { }), 1000);
        try {
            if (options.signal?.aborted || (await bridge.get(task.id)).status === 'cancelled')
                throw new Error('自动生图已停止');
            const prompt = `使用内置 imagegen 生图技能生成一张图片。\n任务 ID：${task.id}\n${task.prompt}\n期望尺寸：${task.size}，以工具实际输出为准。\n透明背景：${task.transparent ? '必须使用真实 alpha' : '按描述'}。\n参考图按原顺序附加。输出图片，不要代码绘图或占位图。`;
            await writeFile(join(key, 'auto-prompt.md'), prompt);
            const input = [{ type: 'text', text: prompt, text_elements: [] }], skillPath = fileURLToPath(new URL('../.agents/skills/game-workbench-imagegen/SKILL.md', import.meta.url));
            if (existsSync(skillPath))
                input.push({ type: 'skill', name: 'game-workbench-imagegen', path: skillPath });
            for (const file of task.references || [])
                input.push({ type: 'localImage', path: join(key, file) });
            const turn = await rpc.request('turn/start', { threadId, input }, 60000);
            turnId = turn.turn.id;
            await report('generating');
            await done;
        }
        finally {
            clearTimeout(timer);
            clearInterval(cancelled);
            rpc.listeners.delete(listener);
            options.signal?.removeEventListener('abort', abort);
        }
        if (imageItem?.failure)
            throw new Error('ChatGPT 生图失败：' + imageItem.failure.type);
        if (!imageItem || imageItem.status !== 'completed')
            throw new Error('该会话没有完成的内置生图结果；未回填任何图片');
        await report('backfilling');
        // Accept only this thread's structured output; never scan global image folders.
        let bytes;
        if (imageItem.savedPath)
            bytes = await readFile(imageItem.savedPath);
        else if (typeof imageItem.result === 'string' && /^(?:data:image\/[^;]+;base64,)?[A-Za-z0-9+/=\r\n]+$/.test(imageItem.result))
            bytes = Buffer.from(imageItem.result.replace(/^data:[^,]+,/, ''), 'base64');
        else
            throw new Error('结果没有本地文件或图像数据');
        if (bytes.length > 64 * 1024 * 1024)
            throw new Error('结果超过 64 MB');
        if (options.signal?.aborted || (await bridge.get(task.id)).status === 'cancelled')
            throw new Error('任务已取消，未回填');
        const result = await bridge.complete(task.id, bytes), mime = result.result.endsWith('.jpg') ? 'image/jpeg' : result.result.endsWith('.webp') ? 'image/webp' : 'image/png';
        const asset = await saveAsset(assetsDir, { name: 'chatgpt-' + task.id.slice(0, 8), data: `data:${mime};base64,` + bytes.toString('base64') });
        await writeFile(join(key, 'auto-receipt.json'), JSON.stringify({ taskId: task.id, threadId, turnId, imageItemId: imageItem.id, file: asset.path }, null, 2));
        return { taskId: task.id, ok: true, file: asset.path, threadId, turnId };
    }
    catch (error) {
        await bridge.updateAutomation(task.id, { stage: 'failed', message: String(error.message).slice(0, 500), threadId }).catch(() => { });
        throw error;
    }
    finally {
        if (threadId && !ended && turnId)
            await rpc.request('turn/interrupt', { threadId, turnId }, 2000).catch(() => { });
        rpc.close();
        locks.delete(key);
    }
}
export async function autoGenerateTasks(options, tasks, onProgress) {
    const executable = detectCodex();
    if (!executable)
        throw new Error('未找到 Codex，请先安装并登录 ChatGPT');
    const results = [];
    for (const task of tasks) {
        if (options.signal?.aborted)
            break;
        try {
            results.push(await autoGenerateTask(options, task, executable));
        }
        catch (error) {
            results.push({ taskId: task.id, ok: false, error: error.message });
            if (/用量|usageLimit|审批|提供方|登录/.test(error.message)) {
                onProgress({ done: results.length, message: error.message });
                break;
            }
        }
        onProgress({ done: results.length, message: `已处理 ${results.length}/${tasks.length}` });
    }
    return results;
}
