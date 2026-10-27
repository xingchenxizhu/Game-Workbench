import { join } from 'node:path';
import { createWorkbenchHost } from './host.js';
/**
 * DSH 插件入口。
 *
 * 浏览器网页模式走 `lib/standalone.js`（同一个 host，只是自起 HTTP 服务）；
 * DSH 插件模式把同一套路由注册到宿主的 webServer 前缀下，并额外提供
 * 浏览器半区（lib/client.js）的侧栏 / 主面板 / 设置分区。
 */
export const name = 'ai-game-workbench';
export const inject = ['webServer'];
export const MOUNT_PATH = '/game-workbench';
export function apply(ctx) {
    const dshHome = process.env.DSH_HOME || process.cwd();
    const dataRoot = process.env.GW_DATA || join(dshHome, 'game-workbench');
    const ready = createWorkbenchHost({ dataRoot, mountPath: MOUNT_PATH }).catch((error) => {
        process.stderr.write(`[game-workbench] 初始化失败：${error?.message || error}\n`);
        throw error;
    });
    const handler = async (req, res) => {
        try {
            const host = await ready;
            await host.handler(req, res);
        }
        catch (error) {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ ok: false, error: { message: error?.message || String(error) } }));
            }
            else
                res.end();
        }
    };
    const webServer = ctx.get?.('webServer');
    if (!webServer) {
        process.stderr.write('[game-workbench] webServer 服务不可用，页面路由未注册\n');
        return;
    }
    ctx.effect(() => webServer.register({ kind: 'prefix', path: MOUNT_PATH, handler }), 'game-workbench: routes');
    ctx.effect(() => () => { void ready.then(host => host.dispose()).catch(() => { }); }, 'game-workbench: engine disposal');
    ctx.effect(() => {
        let disposed = false;
        const cleanup = [];
        const tools = ctx.get?.('tools'), prompts = ctx.get?.('systemPrompt');
        if (tools)
            void ready.then(async (host) => {
                const definition = await host.toolDefinition();
                if (disposed)
                    return;
                const rename = (text) => String(text || '').replaceAll('game_material', 'game_workbench');
                const parameters = structuredClone(definition.parameters);
                parameters.properties.action.enum.push('workspace');
                parameters.properties.workspaceId = { type: 'string', description: '任务所属工作区 ID。先 action:workspace 查询；除查询工作区外每次都必须传入。' };
                const scopeRule = '先调用 game_workbench({action:"workspace"}) 查询工作区。其余所有调用必须显式带 workspaceId；不得切换到其他工作区处理当前任务。';
                cleanup.push(tools.register({
                    name: 'game_workbench', description: scopeRule + '\n' + rename(definition.description), parameters,
                    output: { schema: definition.schema, render: (_args, value) => [{ type: 'text', text: (value?.text || JSON.stringify(value, null, 2)) + (value?.openUrl ? '\n\n[打开工作台验收](' + value.openUrl + ')' : '') }] },
                    execute: async (args, exec) => {
                        if (args.action === 'workspace')
                            return host.workspaceInfo();
                        const result = await host.executeTool(args, exec?.signal);
                        if (args.action === 'guide' && typeof result.text === 'string')
                            result.text = rename(result.text);
                        if (Array.isArray(result.nextActions))
                            result.nextActions = result.nextActions.map(rename);
                        return result;
                    }
                }));
                if (prompts)
                    cleanup.push(prompts.section({ name: 'game-workbench', order: 8601, text: scopeRule + '\n' + rename(definition.prompt) }));
            }).catch(error => process.stderr.write('[game-workbench] 工具注册失败：' + error.message + '\n'));
        return () => {
            disposed = true;
            for (const dispose of cleanup)
                dispose();
        };
    }, 'game-workbench: native conversation tool');
}
