import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkbenchHost } from './host.js';
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const dataRoot = process.env.WORKBENCH_DATA || join(packageRoot, 'data');
const port = Number(process.env.WORKBENCH_PORT || 4173);
const mountPath = process.env.WORKBENCH_MOUNT || '';
const host = await createWorkbenchHost({
    dataRoot,
    mountPath,
    dshHome: join(dataRoot, 'dsh'),
    presetBaseUrl: `http://127.0.0.1:${port}`,
    allowHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
    allowOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
});
const server = createServer((req, res) => { void host.handler(req, res); });
server.requestTimeout = 0;
server.listen(port, '127.0.0.1', () => {
    console.log(`游戏工作台 V3：http://127.0.0.1:${port}${mountPath || ''}/\n数据：${dataRoot}`);
});
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
