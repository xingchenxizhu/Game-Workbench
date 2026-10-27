import { parentPort, workerData } from 'node:worker_threads';
import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
async function boot() {
    const material = await import(new URL('../modules/material/lib/index.js', import.meta.url).href);
    const wire = await import(new URL('../modules/material/lib/wire.js', import.meta.url).href);
    const config = await import(new URL('../modules/material/lib/config.js', import.meta.url).href);
    const methods = new Map(wire.METHODS.map(spec => [spec.method, spec]));
    const ctx = new Context(), routes = [];
    let tool, promptText = '';
    ctx.provide('tools', { register: (definition) => { tool = definition; return () => { }; } });
    ctx.provide('systemPrompt', { section: (section) => { promptText = section.text; return () => { }; } });
    ctx.provide('typert', { register: () => () => { } });
    ctx.provide('webServer', { register: route => { routes.push(route); return () => { }; } });
    material.apply(ctx);
    const studio = ctx.get('gameStudio');
    if (workerData.presetBaseUrl) {
        try {
            await stat(config.configPath());
        }
        catch {
            await config.saveConfig({ imageProvider: 'custom', customProtocol: 'openai', customBaseUrl: workerData.presetBaseUrl + '/api/chatgpt/v1', customApiKey: '', customModel: 'chatgpt-imagegen-skill', customSize: '1024x1024', customTimeoutMs: 1800000 });
        }
    }
    const running = (value) => value && typeof value === 'object' && (value.busy === true || value.status === 'running' || !!value.running || Object.values(value).some(item => typeof item === 'object' && running(item)));
    const pairs = [['listProjects', 'getProject', 'projectId'], ['listImageJobs', 'getImageJob', 'jobId'], ['listSequenceJobs', 'getSequenceJob', 'jobId'], ['listRigJobs', 'getRigJob', 'jobId'], ['listTileProjects', 'getTileProject', 'projectId'], ['listMapProjects', 'getMapProject', 'projectId'], ['listMusicJobs', 'getMusicJob', 'jobId'], ['listSfxJobs', 'getSfxJob', 'jobId']];
    const server = createServer(async (req, res) => {
        const reply = (ok, value, status = 200) => {
            if (res.destroyed)
                return;
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(ok ? { ok, value } : { ok, error: String(value) }));
        };
        if (req.headers['x-engine-token'] !== workerData.token)
            return reply(false, 'Forbidden', 403);
        try {
            if (req.method === 'POST') {
                const chunks = [];
                let size = 0;
                for await (const chunk of req) {
                    size += chunk.length;
                    if (size > 145 * 1024 * 1024)
                        throw Error('请求过大');
                    chunks.push(chunk);
                }
                const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                if (req.url === '/tool-definition')
                    return reply(true, { description: tool.description, parameters: tool.parameters, schema: tool.output.schema, prompt: promptText });
                if (req.url === '/tool') {
                    const controller = new AbortController();
                    res.once('close', () => {
                        if (!res.writableEnded)
                            controller.abort();
                    });
                    return reply(true, await tool.execute(input.args, { signal: controller.signal }));
                }
                if (req.url === '/busy') {
                    for (const [list, get, key] of pairs) {
                        const result = await studio[list]();
                        for (const item of (result.jobs || result.projects || [])) {
                            if (running(await studio[get]({ [key]: item.id })))
                                return reply(true, { busy: true });
                        }
                    }
                    return reply(true, { busy: false });
                }
                const spec = methods.get(input.method);
                if (!spec)
                    throw Error('未知方法');
                const payload = spec.payload ? spec.payload.parse(input.payload ?? {}) : undefined;
                return reply(true, await studio[input.method](payload));
            }
            const path = new URL(req.url || '/', 'http://localhost').pathname;
            const route = routes.find(r => path === r.path || path.startsWith(r.path + '/'));
            if (route)
                return await route.handler(req, res);
            return reply(false, '资源不存在', 404);
        }
        catch (error) {
            if (!res.headersSent)
                reply(false, error.message, 400);
            else
                res.destroy();
        }
    });
    server.requestTimeout = 0;
    server.listen(0, '127.0.0.1', () => parentPort.postMessage({ port: server.address().port }));
}
boot().catch(error => { parentPort.postMessage({ error: error.message }); process.exitCode = 1; });
