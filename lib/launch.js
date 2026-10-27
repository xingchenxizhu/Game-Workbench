/**
 * 启动器：固定 4173 端口。
 *
 * - 4173 上已经是当前版本：直接打开浏览器。
 * - 4173 被旧版占用：明确提示关闭旧工作台；不自动结束占用端口的其他进程。
 * - 启动后等 /api/health 就绪再打开浏览器。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const port = Number(process.env.WORKBENCH_PORT || 4173);
function isFree(target) {
    return new Promise((resolve) => {
        const probe = createServer();
        probe.once('error', () => resolve(false));
        probe.once('listening', () => probe.close(() => resolve(true)));
        probe.listen(target, '127.0.0.1');
    });
}
async function health(target) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 800);
        const response = await fetch(`http://127.0.0.1:${target}/api/health`, { signal: controller.signal });
        clearTimeout(timer);
        return response.ok ? await response.json() : null;
    }
    catch {
        return null;
    }
}
function listenerPid(target) {
    try {
        const file = join(tmpdir(), `wb-netstat-${process.pid}.txt`);
        spawnSync('cmd', ['/c', `netstat -ano > "${file}"`], { stdio: 'ignore' });
        const text = readFileSync(file, 'utf8');
        unlinkSync(file);
        const line = text.split(/\r?\n/).find((row) => row.includes(`:${target}`) && row.includes('LISTENING'));
        if (!line)
            return null;
        const pid = Number(line.trim().split(/\s+/).pop());
        return Number.isFinite(pid) && pid > 0 ? pid : null;
    }
    catch {
        return null;
    }
}
function openBrowser(url) {
    if (process.platform === 'win32')
        spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    else if (process.platform === 'darwin')
        spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    else
        spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
}
const url = `http://127.0.0.1:${port}`;
const current = await health(port);
if (current?.ok && current.version === pkg.version) {
    console.log(`游戏工作台已在 ${url} 运行（v${current.version}），直接打开浏览器。`);
    openBrowser(url);
    process.exit(0);
}
if (!(await isFree(port))) {
    const pid = listenerPid(port);
    console.log(`端口 ${port} 被占用${current?.version ? `（旧版 v${current.version}）` : ''}${pid ? `，PID ${pid}` : ''}，请先关闭对应的旧工作台服务。`);
    if (!(await isFree(port))) {
        console.error('');
        console.error(`[ERROR] 端口 ${port} 仍被占用。`);
        console.error('请任选一种方式：');
        console.error('  1. 关闭之前打开的那个工作台 cmd 窗口；');
        console.error('  2. 运行「停止旧服务.cmd」，核对服务身份与待处理任务后停止。');
        console.error('处理完后重新双击 启动工作台.cmd。');
        process.exit(1);
    }
}
process.env.WORKBENCH_PORT = String(port);
await import('./standalone.js');
let ready = false;
for (let i = 0; i < 80; i++) {
    const value = await health(port);
    if (value?.ok) {
        ready = true;
        break;
    }
    await delay(250);
}
if (ready)
    openBrowser(url);
else
    console.error('服务启动超时，请查看上方日志');
