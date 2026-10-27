/**
 * DSH 浏览器半区（经典脚本，由宿主直接加载）。
 *
 * 只做三件事：侧栏入口、主面板（iframe 嵌入 /game-workbench/）、设置分区。
 * 具体工作台界面由插件路由提供，便于和浏览器网页模式共用同一份代码。
 */
window.__ModuleLoader__.load({
    id: 'ai-game-workbench',
    factory: (require) => {
        const bundleModule = { exports: {} };
        const React = require('react');
        const h = React.createElement;
        const PANEL_ID = 'gameWorkbench';
        const TITLE = '游戏工作台';
        const pageUrl = () => `${location.origin}/game-workbench/`;
        let pluginCtx;
        async function openNativeSession(ctx, originalText) {
            if (typeof originalText !== 'string' || !originalText.trim() || originalText.length > 1000000)
                throw new Error('对话任务文本无效');
            const sessions = ctx.get('sessions'), workspace = ctx.get('uiWorkspace');
            if (!sessions || !workspace)
                throw new Error('DSH 会话服务尚未就绪');
            const text = originalText.replace(/\bgame_material(?=\s*\()/g, 'game_workbench');
            const sessionId = await sessions.create({});
            workspace.openSession(sessionId);
            const reference = sessions.retain(sessionId, { source: 'gameWorkbenchTask' });
            try {
                await reference.ready;
                const session = reference.binding.session;
                const submission = session.beginSubmission({ mode: 'queue', text, attachments: [] });
                const result = await session.prompt([{ type: 'text', text }], 'queue', undefined, submission.requestId);
                if (result?.ok !== true) {
                    submission.abandon();
                    throw new Error(result?.error?.message || '提示词未提交');
                }
            }
            finally {
                reference.release();
            }
            return sessionId;
        }
        function Glyph() {
            return h('span', { title: TITLE, 'aria-label': TITLE, style: { fontSize: 18, lineHeight: 1 } }, '◈');
        }
        function Panel() {
            const frame = React.useRef(null);
            const sendReady = () => frame.current?.contentWindow?.postMessage({ type: 'game-workbench-ready', sessions: !!pluginCtx?.get('sessions') && !!pluginCtx?.get('uiWorkspace') }, location.origin);
            React.useEffect(() => {
                const listener = async (event) => {
                    if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.type !== 'game-workbench-session-request' || typeof event.data.id !== 'string')
                        return;
                    const target = event.source;
                    const reply = (payload) => {
                        try {
                            target.postMessage({ type: 'game-workbench-session-result', id: event.data.id, ...payload }, location.origin);
                        }
                        catch { }
                    };
                    try {
                        reply({ ok: true, sessionId: await openNativeSession(pluginCtx, event.data.text) });
                    }
                    catch (error) {
                        reply({ ok: false, error: error.message });
                    }
                };
                window.addEventListener('message', listener);
                return () => window.removeEventListener('message', listener);
            }, []);
            return h('div', { style: { display: 'flex', height: '100%', minHeight: 0, background: '#0e1116' } }, h('iframe', {
                ref: frame, onLoad: sendReady,
                title: TITLE,
                src: pageUrl(),
                style: { width: '100%', height: '100%', border: 0, display: 'block', background: '#0e1116' }
            }));
        }
        function Section() {
            return h('div', { style: { padding: '18px 20px', lineHeight: 1.8, fontSize: 13 } }, h('p', { style: { margin: '0 0 10px', opacity: 0.75 } }, '素材生成、抠图/调色/放大、角色动画、地图场景、音频、视频与策划文档都在同一个工作台里；AI 生图仍走「任务 → 交接指令 → 回填」。'), h('a', { href: pageUrl(), target: '_blank', rel: 'noopener', style: { color: '#7c9cff' } }, '在新窗口打开游戏工作台 ↗'));
        }
        function apply(ctx) {
            pluginCtx = ctx;
            const slots = ctx?.slots;
            if (!slots?.inject) {
                console.warn('[game-workbench] slots 服务不可用，界面未注册');
                return;
            }
            slots.inject('sidebar.panellist', () => slots.register({
                name: 'sidebar.panellist', id: PANEL_ID, order: 41, label: () => TITLE
            }, Glyph));
            slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, Panel));
            slots.inject('settings.section', () => slots.register({
                name: 'settings.section', id: PANEL_ID, order: 19, label: () => TITLE
            }, Section));
        }
        bundleModule.exports.apply = apply;
        bundleModule.exports.openNativeSession = openNativeSession;
        return bundleModule.exports;
    }
});
