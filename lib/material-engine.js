/** One material engine per workspace. Worker environments isolate DSH_HOME,
 * configuration caches and all original module task registries. HTTP is private
 * to this process; asset streams retain Range support and backpressure. */
import { Worker } from 'node:worker_threads';
import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
export class MaterialEngine {
    worker;
    token = randomBytes(24).toString('hex');
    port;
    calls = 0;
    constructor(home, presetBaseUrl) {
        this.worker = new Worker(new URL('./material-worker.js', import.meta.url), {
            workerData: { token: this.token, presetBaseUrl }, env: { ...process.env, DSH_HOME: home }
        });
        this.port = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('素材引擎启动超时')), 30000);
            this.worker.once('message', message => { clearTimeout(timeout); message.error ? reject(new Error(message.error)) : resolve(message.port); });
            this.worker.once('error', error => { clearTimeout(timeout); reject(error); });
            this.worker.once('exit', code => {
                clearTimeout(timeout);
                if (code)
                    reject(new Error(`素材引擎退出 (${code})`));
            });
        });
        this.worker.unref();
    }
    async call(method, payload) {
        this.calls++;
        try {
            return await this.json('/rpc', { method, payload });
        }
        finally {
            this.calls--;
        }
    }
    async busy() { return this.calls > 0 || !!(await this.json('/busy', {})).busy; }
    async toolDefinition() { return this.json('/tool-definition', {}); }
    async executeTool(args, signal) {
        this.calls++;
        try {
            return await this.json('/tool', { args }, signal);
        }
        finally {
            this.calls--;
        }
    }
    async json(path, payload, signal) {
        const port = await this.port;
        return new Promise((resolve, reject) => {
            const req = request({ hostname: '127.0.0.1', port, path, method: 'POST', agent: false, signal,
                headers: { 'Content-Type': 'application/json', 'x-engine-token': this.token } }, response => {
                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('error', reject);
                response.on('end', () => {
                    try {
                        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                        value.ok ? resolve(value.value) : reject(new Error(value.error));
                    }
                    catch (error) {
                        reject(error);
                    }
                });
            });
            req.on('error', reject);
            req.end(JSON.stringify(payload));
        });
    }
    async asset(req, res, path) {
        const port = await this.port;
        this.calls++;
        try {
            await new Promise((resolve, reject) => {
                const upstream = request({ hostname: '127.0.0.1', port, path, method: req.method, agent: false,
                    headers: { ...req.headers, 'x-engine-token': this.token } }, response => {
                    res.writeHead(response.statusCode || 500, response.headers);
                    response.pipe(res);
                    response.on('end', resolve);
                    response.on('error', reject);
                });
                upstream.on('error', reject);
                res.once('close', () => { upstream.destroy(); resolve(); });
                upstream.end();
            });
        }
        finally {
            this.calls--;
        }
    }
    async close() { await this.worker.terminate(); }
}
