/** Official local app-server stdio transport. No credential access or UI automation. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
export class CodexRpc {
    child;
    seq = 0;
    pending = new Map();
    listeners = new Set();
    lastError = '';
    constructor(executable, cwd) {
        this.child = spawn(executable, ['app-server', '--listen', 'stdio://'], { cwd, stdio: 'pipe', windowsHide: true });
        this.child.stderr.on('data', chunk => { this.lastError = (this.lastError + String(chunk)).slice(-1500); });
        const lines = createInterface({ input: this.child.stdout });
        lines.on('line', line => {
            try {
                const message = JSON.parse(line);
                if (message.id !== undefined && !message.method) {
                    const p = this.pending.get(message.id);
                    if (p) {
                        clearTimeout(p.timer);
                        this.pending.delete(message.id);
                        message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result);
                    }
                    return;
                }
                if (message.id !== undefined && message.method) {
                    // This background image worker has no approval UI. Never silently approve actions.
                    this.child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32000, message: '工作台后台生图不允许额外工具审批，请在当前聊天处理。' } }) + '\n');
                }
                for (const fn of this.listeners)
                    fn(message);
            }
            catch (error) {
                this.fail(error instanceof Error ? error : new Error(String(error)));
            }
        });
        this.child.on('error', error => this.fail(error));
        this.child.stdin.on('error', error => this.fail(error));
        this.child.on('exit', code => this.fail(new Error('Codex 会话服务已退出：' + code)));
    }
    fail(error) {
        for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(error);
        }
        this.pending.clear();
        for (const fn of this.listeners)
            fn({ method: 'transport/closed', params: {} });
    }
    request(method, params = {}, timeout = 30000) {
        const id = ++this.seq;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex 协议请求超时：' + method)); }, timeout);
            this.pending.set(id, { resolve, reject, timer });
            this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => {
                if (error) {
                    clearTimeout(timer);
                    this.pending.delete(id);
                    reject(error);
                }
            });
        });
    }
    async initialize() { await this.request('initialize', { clientInfo: { name: 'game_workbench', title: '游戏工作台', version: '3.6.0' }, capabilities: { experimentalApi: true, requestAttestation: false } }); this.child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n'); }
    close() { this.child.stdin.end(); this.child.kill(); this.fail(new Error('Codex 连接已关闭')); }
}
