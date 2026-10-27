import { createReadStream } from 'node:fs';
import { mkdir, writeFile, stat, appendFile, readFile } from 'node:fs/promises';
import { join, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { MaterialEngine } from './material-engine.js';
import { ImageBridge } from './bridge.js';
import { createVideoTools } from './video.js';
import { listMapProjects, loadMapProject, saveMapProject } from './map-projects.js';
import { WorkspaceStore } from './settings.js';
import { saveAsset, encodeGif } from './assets.js';
import { randomUUID } from 'node:crypto';
import { detectCodex, detectCodexHost, autoGenerateTasks, autoCapability } from './autoimage.js';
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const publicRoot = join(packageRoot, 'public');
const packageVersion = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')).version;
const mime = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska', '.zip': 'application/zip', '.md': 'text/plain; charset=utf-8', '.cs': 'text/plain; charset=utf-8'
};
const vendor = {
    '/vendor/react.js': 'node_modules/react/umd/react.production.min.js',
    '/vendor/react-dom.js': 'node_modules/react-dom/umd/react-dom.production.min.js',
    '/vendor/jszip.js': 'node_modules/jszip/dist/jszip.min.js',
    '/vendor/ag-psd.js': 'node_modules/ag-psd/dist/bundle.js',
    '/material-client.js': 'modules/material/lib/client.js',
    '/mapstitch': 'modules/mapstitch/edit.html',
    '/MapChunkManager.cs': 'modules/mapstitch/MapChunkManager.cs'
};
function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
}
function readBytes(req, limit = 145 * 1024 * 1024) {
    return new Promise((resolvePromise, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limit) {
                reject(Object.assign(new Error(`上传超过 ${Math.round(limit / 1024 / 1024)} MB`), { status: 413 }));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolvePromise(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}
async function readJson(req) {
    return JSON.parse((await readBytes(req)).toString('utf8') || '{}');
}
async function sendFile(req, res, path) {
    const info = await stat(path);
    if (!info.isFile()) {
        json(res, 404, { error: '文件不存在' });
        return;
    }
    res.writeHead(200, {
        'Content-Type': mime[extname(path).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD')
        res.end();
    else
        createReadStream(path).pipe(res);
}
export async function createWorkbenchHost(options) {
    const mountPath = options.mountPath ?? '';
    const dataRoot = options.dataRoot;
    const workspaces = await WorkspaceStore.load(dataRoot);
    const bridge = new ImageBridge(join(workspaces.activeDir(), 'chatgpt-images'));
    await bridge.recover();
    const wireModule = await import(new URL('../modules/material/lib/wire.js', import.meta.url).href);
    const methods = new Map(wireModule.METHODS.map((item) => [item.method, item]));
    let engine = new MaterialEngine(join(workspaces.activeDir(), 'dsh'), options.presetBaseUrl ? options.presetBaseUrl + mountPath : undefined);
    await engine.call('getConfig');
    const studio = new Proxy({}, { get: (_target, method) => (payload) => engine.call(String(method), payload) });
    let switching = false;
    let videoCalls = 0;
    let activeRequests = 0;
    let reportedOrigin = '';
    let video = createVideoTools({ root: join(workspaces.activeDir(), 'video'), mountPath });
    const autoJobs = new Map();
    const autoFile = join(dataRoot, 'auto-jobs.json');
    try {
        const saved = JSON.parse(await readFile(autoFile, 'utf8'));
        for (const job of Array.isArray(saved) ? saved : []) {
            if (job.status === 'running') {
                job.status = 'interrupted';
                job.message = '服务重启，任务已中断';
            }
            autoJobs.set(job.id, job);
        }
    }
    catch { /* 首次运行 */ }
    const saveAutoJobs = () => writeFile(autoFile, JSON.stringify([...autoJobs.values()].slice(-8), null, 2)).catch(() => { });
    let runningAuto = null;
    let autoScheduling = 0;
    let autoAbort = null;
    const startAuto = async (taskIds) => {
        const codex = detectCodex();
        if (!codex && !options.imageRunner)
            throw Object.assign(new Error('没有找到 Codex CLI，可设置 CODEX_PATH 指向 codex.exe'), { status: 400 });
        const all = await bridge.list();
        const retryable = ['waiting', 'interrupted', 'expired'];
        const tasks = all.filter((task) => retryable.includes(task.status) && (!taskIds.length || taskIds.includes(task.id))).slice(0, 32);
        if (!tasks.length)
            throw Object.assign(new Error('当前没有待回填任务'), { status: 400 });
        if (runningAuto) {
            if (runningAuto.job.status !== 'running')
                throw new Error('自动生图正在停止，请稍后重试');
            const known = new Set(runningAuto.tasks.map(t => t.id));
            const added = tasks.filter(t => !known.has(t.id));
            if (runningAuto.tasks.length + added.length > 32)
                throw new Error('自动生图队列最多 32 项，请待当前队列完成后重试');
            runningAuto.tasks.push(...added);
            runningAuto.job.total = runningAuto.tasks.length;
            return runningAuto.job;
        }
        const id = randomUUID(), workspaceId = workspaces.activeId(), assetDirectory = workspaces.assetsDir();
        const job = { id, workspaceId, status: 'running', total: tasks.length, done: 0, results: [], message: '连接 ChatGPT 内置生图', startedAt: new Date().toISOString() };
        runningAuto = { job, tasks };
        autoAbort = new AbortController();
        autoJobs.set(id, job);
        void saveAutoJobs();
        void (options.imageRunner || autoGenerateTasks)({ bridge, assetsDir: () => assetDirectory, timeoutSec: 1200, signal: autoAbort.signal, onStage: stage => { job.message = `${stage.stage} · ${stage.taskId.slice(0, 8)}`; void saveAutoJobs(); } }, tasks, (progress) => {
            job.done = progress.done;
            job.message = progress.message;
            void saveAutoJobs();
        }).then((results) => {
            job.results = results;
            if (job.status === 'cancelled')
                return;
            job.status = results.every((item) => item.ok) ? 'done' : 'partial';
            job.message = `完成 ${results.filter((item) => item.ok).length}/${results.length}`;
            void saveAutoJobs();
        }).catch((error) => {
            if (job.status === 'cancelled')
                return;
            job.status = 'failed';
            job.message = error.message;
            void saveAutoJobs();
        }).finally(() => { if (runningAuto?.job === job) {
            runningAuto = null;
            autoAbort = null;
        } });
        return job;
    };
    bridge.onCreated = task => { if (workspaces.settings().autoGenerateImages !== true)
        return; autoScheduling++; setImmediate(() => void startAuto([task.id]).catch(error => bridge.updateAutomation(task.id, { stage: 'failed', message: error.message })).finally(() => autoScheduling--).catch(() => { })); };
    async function switchWorkspace(id) {
        if (switching)
            throw new Error('工作区正在切换');
        if (!workspaces.shape.workspaces[id])
            throw new Error('工作区不存在');
        if (id === workspaces.activeId())
            return;
        switching = true;
        let next;
        try {
            if (activeRequests || runningAuto || autoScheduling || bridge.waiters.size || videoCalls || await engine.busy())
                throw new Error('当前工作区还有生成、装配、上传或视频任务正在运行，请完成或取消后切换。');
            next = new MaterialEngine(join(workspaces.dir(id), 'dsh'), options.presetBaseUrl ? options.presetBaseUrl + mountPath : undefined);
            await next.call('getConfig');
            await workspaces.activate(id);
            reportedOrigin = '';
            const previous = engine;
            engine = next;
            next = undefined;
            bridge.root = join(workspaces.activeDir(), 'chatgpt-images');
            await mkdir(bridge.root, { recursive: true });
            video = createVideoTools({ root: join(workspaces.activeDir(), 'video'), mountPath });
            await previous.close();
        }
        finally {
            if (next)
                await next.close();
            switching = false;
        }
    }
    async function openFolder(kind) {
        const target = kind === 'assets' ? workspaces.assetsDir() : workspaces.activeDir();
        await mkdir(target, { recursive: true });
        if (process.platform === 'win32')
            spawn('explorer.exe', [target], { stdio: 'ignore' });
        else if (process.platform === 'darwin')
            spawn('open', [target], { stdio: 'ignore' });
        else
            spawn('xdg-open', [target], { stdio: 'ignore' });
        return target;
    }
    async function handler(req, res) {
        let requestLock = false;
        try {
            const host = String(req.headers.host || '');
            if (options.allowHosts && !options.allowHosts.includes(host))
                return json(res, 403, { error: '只接受本机访问' });
            const originHeader = req.headers.origin;
            if (options.allowOrigins && originHeader && !options.allowOrigins.includes(originHeader)) {
                return json(res, 403, { error: '来源不匹配' });
            }
            const url = new URL(req.url || '/', `http://${host || '127.0.0.1'}`);
            let path = decodeURIComponent(url.pathname);
            if (mountPath) {
                if (path === mountPath) {
                    res.writeHead(302, { Location: `${mountPath}/` });
                    res.end();
                    return;
                }
                if (!path.startsWith(`${mountPath}/`))
                    return json(res, 404, { error: '未知接口' });
                path = path.slice(mountPath.length);
            }
            if (!path)
                path = '/';
            if (switching)
                return json(res, 409, { error: '工作区正在切换，请稍后重试' });
            if (host && reportedOrigin !== host) {
                await engine.call('reportClientOrigin', { origin: 'http://' + host, path: mountPath || '/' });
                reportedOrigin = host;
                bridge.baseUrl = `${options.presetBaseUrl || ('http://' + host)}${mountPath}`;
            }
            if (switching)
                return json(res, 409, { error: '工作区正在切换，请稍后重试' });
            if (req.method === 'POST' && path !== '/api/workspaces') {
                requestLock = true;
                activeRequests++;
            }
            if (req.method === 'POST') {
                if (!['/api/client-error', '/api/video/upload'].includes(path) && !String(req.headers['content-type'] || '').startsWith('application/json'))
                    return json(res, 415, { error: '需要 JSON 请求' });
                if (path === '/api/client-error') {
                    const text = (await readBytes(req)).toString('utf8').slice(0, 20000);
                    await mkdir(join(dataRoot, 'logs'), { recursive: true });
                    await appendFile(join(dataRoot, 'logs', 'client-errors.log'), `${new Date().toISOString()} ${text}\n`);
                    return json(res, 200, { ok: true });
                }
                if (path === '/api/asset-recipes')
                    return json(res, 200, await workspaces.recipeAction(await readJson(req)));
                if (path === '/api/workspaces') {
                    const input = await readJson(req);
                    const action = String(input.action || '');
                    if (action === 'create')
                        await workspaces.create(String(input.name || ''));
                    else if (action === 'rename')
                        await workspaces.rename(String(input.id || ''), String(input.name || ''));
                    else if (action === 'delete')
                        await workspaces.remove(String(input.id || ''));
                    else if (action === 'activate')
                        await switchWorkspace(String(input.id || ''));
                    else
                        return json(res, 400, { error: '未知的工作区操作' });
                    return json(res, 200, { ok: true, active: workspaces.activeId(), workspaces: await workspaces.list(), settings: workspaces.settings(), assetsDir: workspaces.assetsDir() });
                }
                if (path === '/api/settings') {
                    const input = await readJson(req);
                    await workspaces.updateSettings(input);
                    return json(res, 200, { ok: true, settings: workspaces.settings(), assetsDir: workspaces.assetsDir() });
                }
                if (path === '/api/settings/open') {
                    const input = await readJson(req);
                    const target = await openFolder(String(input.kind || 'data'));
                    return json(res, 200, { ok: true, path: target });
                }
                if (path === '/api/auto/run') {
                    const input = await readJson(req);
                    const taskIds = Array.isArray(input.taskIds) ? input.taskIds.map(String) : [];
                    return json(res, 200, await startAuto(taskIds));
                }
                if (path === '/api/auto/stop') {
                    autoAbort?.abort();
                    if (runningAuto) {
                        runningAuto.job.status = 'cancelled';
                        runningAuto.job.message = '自动生图已停止，任务与已生成结果保留';
                        await Promise.all(runningAuto.tasks.map(t => bridge.interrupt(t.id)));
                        void saveAutoJobs();
                    }
                    return json(res, 200, { ok: true });
                }
                if (path === '/api/video/upload') {
                    return json(res, 200, await video.upload(req, url, readBytes));
                }
                if (path === '/api/chatgpt/v1/images/edits')
                    return json(res, 404, { error: '使用 generations 传递参考图' });
                if (!String(req.headers['content-type'] || '').startsWith('application/json'))
                    return json(res, 415, { error: '需要 JSON 请求' });
                const input = await readJson(req);
                if (input.workspaceId && input.workspaceId !== workspaces.activeId())
                    return json(res, 409, { error: '工作区已切换，请返回任务所属工作区' });
                if (path === '/api/map-projects')
                    return json(res, 200, await saveMapProject(workspaces.activeDir(), input));
                if (path === '/api/assets/save')
                    return json(res, 200, { ok: true, ...await saveAsset(workspaces.assetsDir(), input) });
                if (path === '/api/images/gif') {
                    videoCalls++;
                    try {
                        const bytes = await encodeGif(workspaces.activeDir(), input);
                        await saveAsset(workspaces.assetsDir(), { name: 'animation', data: 'data:image/gif;base64,' + bytes.toString('base64') });
                        res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Disposition': 'attachment; filename="animation.gif"', 'Cache-Control': 'no-store' });
                        res.end(bytes);
                    }
                    finally {
                        videoCalls--;
                    }
                    return;
                }
                if (path.startsWith('/api/video/')) {
                    videoCalls++;
                    try {
                        if (path === '/api/video/frames')
                            return json(res, 200, await video.frames(input));
                        if (path === '/api/video/trim')
                            return json(res, 200, await video.trim(input));
                        if (path === '/api/video/concat')
                            return json(res, 200, await video.concat(input));
                    }
                    finally {
                        videoCalls--;
                    }
                    return json(res, 404, { error: '未知的视频接口' });
                }
                if (path === '/api/chatgpt/v1/images/generations') {
                    const task = await bridge.create({
                        ...input,
                        images: input.image ? (Array.isArray(input.image) ? input.image : [input.image]) : [],
                        source: 'material-provider'
                    });
                    res.on('close', () => {
                        if (!res.writableEnded && bridge.waiters.has(task.id))
                            void bridge.cancel(task.id).catch(() => { });
                    });
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
                    res.write(' ');
                    const heartbeat = setInterval(() => {
                        if (!res.destroyed)
                            res.write('\n');
                    }, Math.max(20, Number(process.env.WORKBENCH_HEARTBEAT_MS) || 15000));
                    try {
                        const image = await bridge.wait(task, workspaces.settings().autoGenerateImages ? 3600000 : 1800000);
                        res.end(JSON.stringify({ data: [{ b64_json: image.toString('base64') }] }));
                    }
                    catch (error) {
                        if (!res.destroyed)
                            res.end(JSON.stringify({ error: { message: `ChatGPT 生图任务：${error.message}` } }));
                    }
                    finally {
                        clearInterval(heartbeat);
                    }
                    return;
                }
                if (path === '/api/chatgpt/preset') {
                    const preset = () => ({
                        imageProvider: 'custom', customProtocol: 'openai', customBaseUrl: `${options.presetBaseUrl || ('http://' + host)}${mountPath}/api/chatgpt/v1`,
                        customApiKey: '', customModel: 'chatgpt-imagegen-skill', customSize: '1024x1024', customTimeoutMs: 3600000
                    });
                    await studio.saveConfig(preset());
                    return json(res, 200, { ok: true });
                }
                if (path === '/api/chatgpt/tasks')
                    return json(res, 200, await bridge.create(input));
                const taskAction = /^\/api\/chatgpt\/tasks\/([a-f0-9-]+)\/(complete|cancel)$/.exec(path);
                if (taskAction) {
                    return json(res, 200, taskAction[2] === 'cancel'
                        ? await bridge.cancel(taskAction[1])
                        : await bridge.complete(taskAction[1], Buffer.from(input.data || '', 'base64')));
                }
                if (path === '/api/handoff') {
                    const folder = join(workspaces.activeDir(), 'handoffs');
                    await mkdir(folder, { recursive: true });
                    const file = `request-${Date.now()}.md`;
                    await writeFile(join(folder, file), String(input.text || ''));
                    return json(res, 200, { ok: true, file: join(folder, file) });
                }
                if (path === '/api/rpc') {
                    const spec = methods.get(input.method);
                    if (!spec)
                        return json(res, 404, { ok: false, error: { message: '未知方法' } });
                    const payload = spec.payload ? spec.payload.parse(input.payload ?? {}) : undefined;
                    if (input.method === 'reportClientOrigin') {
                        payload.path = mountPath || '/';
                        payload.origin = `http://${host}`;
                    }
                    const value = await studio[input.method](payload);
                    return json(res, 200, { ok: true, value });
                }
                return json(res, 404, { error: '未知接口' });
            }
            if (req.method !== 'GET' && req.method !== 'HEAD')
                return json(res, 405, { error: '不支持的方法' });
            if (path === '/api/workspaces') {
                return json(res, 200, {
                    ok: true, active: workspaces.activeId(), workspaces: await workspaces.list(),
                    settings: workspaces.settings(), assetsDir: workspaces.assetsDir()
                });
            }
            if (path === '/api/settings') {
                return json(res, 200, { ok: true, settings: workspaces.settings(), assetsDir: workspaces.assetsDir() });
            }
            if (path.startsWith('/api/map-projects') && url.searchParams.get('workspaceId') && url.searchParams.get('workspaceId') !== workspaces.activeId())
                return json(res, 409, { error: '工作区已切换' });
            if (path === '/api/map-projects')
                return json(res, 200, await listMapProjects(workspaces.activeDir()));
            if (path.startsWith('/api/map-projects/'))
                return json(res, 200, await loadMapProject(workspaces.activeDir(), decodeURIComponent(path.slice('/api/map-projects/'.length))));
            if (path === '/api/asset-recipes')
                return json(res, 200, workspaces.recipes());
            if (path === '/api/auto/status') {
                const codex = detectCodex();
                const capability = await autoCapability().catch(error => ({ available: false, message: error.message }));
                return json(res, 200, { ok: true, codex, host: detectCodexHost(codex), ...capability, enabled: workspaces.settings().autoGenerateImages === true, assetsDir: workspaces.assetsDir() });
            }
            if (path === '/api/auto/job') {
                if (url.searchParams.get('latest')) {
                    const list = [...autoJobs.values()].filter(j => j.workspaceId === workspaces.activeId()).sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
                    return json(res, 200, list[list.length - 1] || null);
                }
                const job = autoJobs.get(String(url.searchParams.get('id') || ''));
                if (job && job.workspaceId !== workspaces.activeId())
                    return json(res, 404, { error: '任务不属于当前工作区' });
                return json(res, job ? 200 : 404, job || { error: '任务不存在' });
            }
            if (path === '/api/health') {
                return json(res, 200, {
                    ok: true, version: packageVersion, methods: methods.size, bridge: 'chatgpt-imagegen-skill',
                    dataRoot, mountPath, video: video.status, node: process.version,
                    workspace: {
                        id: workspaces.activeId(), name: workspaces.name(workspaces.activeId()),
                        dir: workspaces.activeDir(), assetsDir: workspaces.assetsDir()
                    }
                });
            }
            if (path === '/api/video/zip') {
                const archive = await video.zip(url);
                res.writeHead(200, {
                    'Content-Type': 'application/zip',
                    'Content-Disposition': `attachment; filename="${archive.filename}"`,
                    'Cache-Control': 'no-store'
                });
                res.end(archive.buffer);
                return;
            }
            if (path.startsWith('/video-assets/')) {
                return await sendFile(req, res, video.asset(path));
            }
            if (path === '/api/chatgpt/tasks')
                return json(res, 200, await bridge.list());
            if (path === '/api/chatgpt/tasks/root')
                return json(res, 200, { path: bridge.root });
            const taskFile = /^\/api\/chatgpt\/tasks\/([a-f0-9-]+)\/(result\.(?:png|jpg|webp)|reference-\d+\.(?:png|jpg|webp)|交给ChatGPT生图\.md)$/.exec(path);
            if (taskFile)
                return await sendFile(req, res, join(bridge.path(taskFile[1]), taskFile[2]));
            if (path.startsWith('/dsh-game-material-master/')) {
                await engine.asset(req, res, path.split('/').map(encodeURIComponent).join('/') + (url.search || ''));
                return;
            }
            if (vendor[path])
                return await sendFile(req, res, join(packageRoot, vendor[path]));
            const publicPath = resolve(publicRoot, path === '/' ? 'index.html' : `.${path}`);
            if (!publicPath.startsWith(publicRoot + sep))
                return json(res, 403, { error: '禁止访问' });
            await sendFile(req, res, publicPath);
        }
        catch (error) {
            const status = error?.status || (error?.code === 'ENOENT' ? 404 : 400);
            if (!res.headersSent)
                json(res, status, { ok: false, error: { message: error?.message || String(error) } });
            else
                res.end();
        }
        finally {
            if (requestLock)
                activeRequests--;
        }
    }
    return { handler, bridge, studio, methods, video, dataRoot, mountPath, dispose: () => { autoAbort?.abort(); return engine.close(); },
        workspaceInfo: () => ({ active: workspaces.activeId(), workspaces: Object.entries(workspaces.shape.workspaces).map(([id, value]) => ({ id, name: value.name })) }),
        toolDefinition: () => engine.toolDefinition(), executeTool: (args, signal) => {
            if (args.workspaceId !== workspaces.activeId())
                throw new Error('任务工作区与当前工作区不一致，请先切换到任务所属工作区再执行。');
            const { workspaceId, ...input } = args;
            return engine.executeTool(input, signal);
        } };
}
