/** Explicit stop command: verify this project's service before touching a PID. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
const port = Number(process.env.WORKBENCH_PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('工作台端口无效');
const expected = resolve(process.env.WORKBENCH_DATA || join(fileURLToPath(new URL('..', import.meta.url)), 'data'));
async function stop() {
    let info;
    try {
        info = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2500) }).then(r => r.json());
    }
    catch {
        throw new Error('端口上没有可验证的游戏工作台；请自行检查并关闭旧窗口。');
    }
    if (!info.ok || info.bridge !== 'chatgpt-imagegen-skill' || typeof info.dataRoot !== 'string' || resolve(info.dataRoot).toLowerCase() !== expected.toLowerCase())
        throw new Error('该端口不属于当前目录的工作台，未结束任何进程。');
    const tasks = await fetch(`http://127.0.0.1:${port}/api/chatgpt/tasks`).then(r => r.json());
    if (!Array.isArray(tasks))
        throw new Error('无法确认任务状态，未执行停止。');
    if (tasks.some((t) => t.status === 'waiting') && !process.argv.includes('--interrupt-waiting'))
        throw new Error('还有等待生图的任务，请完成或取消后再停止。');
    if (process.platform !== 'win32')
        throw new Error('请在启动工作台的终端按 Ctrl+C 停止。');
    const output = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
    if (output.status !== 0)
        throw new Error('无法确认监听进程，未执行停止。');
    const pids = new Set();
    for (const line of output.stdout.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === 'TCP' && parts[1]?.endsWith(':' + port) && parts[3] === 'LISTENING') {
            const pid = Number(parts[4]);
            if (Number.isInteger(pid) && pid > 0)
                pids.add(pid);
        }
    }
    if (pids.size !== 1)
        throw new Error('无法唯一确认工作台进程，未执行停止。');
    const pid = [...pids][0];
    process.kill(pid);
    console.log(`已停止当前目录的工作台服务，PID ${pid}。`);
}
stop().catch((error) => { console.error(error.message); process.exitCode = 1; });
