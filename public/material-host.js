(() => {
    const w = window;
    let nativeSessions = false;
    const sessionRequests = new Map();
    window.addEventListener('message', (event) => {
        if (event.origin !== location.origin || event.source !== parent)
            return;
        if (event.data?.type === 'workbench-host-capabilities')
            nativeSessions = event.data.sessions === true;
        if (event.data?.type === 'workbench-session-result') {
            const pending = sessionRequests.get(event.data.id);
            if (!pending)
                return;
            clearTimeout(pending.timer);
            sessionRequests.delete(event.data.id);
            event.data.ok ? pending.resolve({ ok: true }) : pending.reject(new Error(event.data.error || 'DSH 会话创建失败'));
        }
    });
    w.__ModuleLoader__ = {
        load(registration) {
            try {
                const plugin = registration.factory((name) => {
                    if (name === 'react')
                        return React;
                    throw new Error(`未知客户端依赖 ${name}`);
                });
                const root = ReactDOM.createRoot(document.querySelector('#root'));
                const slots = new Map();
                const remote = new Proxy({}, {
                    get: (_target, method) => async (payload) => {
                        if (method === 'reportClientOrigin')
                            payload = { ...payload, path: '/' };
                        const result = await fetch(`${window.__GW_BASE__ || ''}/api/rpc`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ method, payload })
                        });
                        return result.json();
                    }
                });
                const services = {
                    'remote.gameStudio': remote,
                    layout: { selectPanel() { render(); } },
                    sessions: {
                        async create() { return 'local-handoff'; },
                        retain() {
                            return {
                                ready: Promise.resolve(),
                                release() { },
                                binding: {
                                    session: {
                                        beginSubmission() {
                                            return { requestId: 'local', abandon() { } };
                                        },
                                        async prompt(parts) {
                                            const text = parts.filter((x) => x.type === 'text').map((x) => x.text).join('\n');
                                            const result = await fetch(`${window.__GW_BASE__ || ''}/api/handoff`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ text })
                                            }).then((x) => x.json());
                                            if (!result.ok)
                                                throw new Error('交接文件保存失败');
                                            if (nativeSessions)
                                                return await new Promise((resolve, reject) => {
                                                    const id = crypto.randomUUID();
                                                    const timer = setTimeout(() => { sessionRequests.delete(id); reject(new Error('DSH 会话创建超时，交接文件已保留：' + result.file)); }, 60000);
                                                    sessionRequests.set(id, { resolve, reject, timer });
                                                    parent.postMessage({ type: 'workbench-session-request', id, text }, location.origin);
                                                });
                                            parent.postMessage({ type: 'handoff', file: result.file }, location.origin);
                                            return { ok: true };
                                        }
                                    }
                                }
                            };
                        }
                    },
                    uiWorkspace: { openSession() { } }
                };
                const ctx = {
                    get: (name) => services[name],
                    remote: { $mount: () => Promise.resolve() },
                    effect: (fn) => fn(),
                    inject: (_deps, fn) => fn(ctx),
                    slots: {
                        inject: (_name, fn) => fn(),
                        register(spec, component) {
                            slots.set(spec.name, { spec, component });
                            return () => { };
                        }
                    }
                };
                class ErrorBoundary extends React.Component {
                    constructor(props) { super(props); this.state = { error: null }; }
                    static getDerivedStateFromError(error) { return { error }; }
                    render() {
                        return this.state.error
                            ? React.createElement('div', { id: 'boot-error' }, `界面加载失败：${this.state.error.message}`)
                            : this.props.children;
                    }
                }
                const params = new URLSearchParams(location.search);
                if (params.has('embedded'))
                    document.documentElement.classList.add('workbench-embedded');
                if (params.has('embedded')) {
                    document.addEventListener('click', (event) => {
                        const anchor = event.target?.closest?.('a[href]');
                        if (!anchor || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
                            return;
                        const url = new URL(anchor.href, location.href);
                        if (url.origin === location.origin && url.searchParams.has('dsh-gmm') && (url.searchParams.get('module') || 'sprite') !== params.get('tool')) {
                            event.preventDefault();
                            event.stopImmediatePropagation();
                            parent.postMessage({ type: 'workbench-open-link', search: url.search }, location.origin);
                        }
                    }, true);
                    window.addEventListener('message', (event) => {
                        if (event.origin === location.origin && event.source === parent && event.data?.type === 'workbench-intent' && typeof event.data.search === 'string') {
                            plugin.openWorkspace(ctx, event.data.search);
                        }
                    });
                }
                function render() {
                    const slot = slots.get(params.has('settings') ? 'settings.section' : 'main');
                    if (!slot)
                        return;
                    const View = params.has('embedded') && !params.has('settings') ? plugin.WorkspacePanel : slot.component;
                    root.render(React.createElement(ErrorBoundary, null, React.createElement(View, {
                        ...slot.spec.inject?.(),
                        workspaceModule: params.get('tool') || params.get('module'),
                        embedded: params.has('embedded')
                    })));
                }
                plugin.apply(ctx);
                render();
            }
            catch (error) {
                document.querySelector('#root').textContent = `工作台加载失败：${error.message}`;
                console.error(error);
            }
        }
    };
})();
