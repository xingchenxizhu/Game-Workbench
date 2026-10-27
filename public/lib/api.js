/** 本地服务 API 封装 + 全应用共享的任务轮询。 */
const JSON_HEADERS = { 'Content-Type': 'application/json' };
/** 页面所在目录；standalone 是 ''，DSH 插件挂在 /game-workbench 下。 */
export function basePath() {
    const scope = typeof window !== 'undefined' ? window : globalThis;
    const value = scope.__GW_BASE__;
    return typeof value === 'string' ? value : '';
}
export function withBase(path) {
    return path.startsWith('/') ? `${basePath()}${path}` : path;
}
async function request(path, { body, method } = {}) {
    const init = body === undefined
        ? { method: method || 'GET' }
        : { method: method || 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) };
    const response = await fetch(withBase(path), init);
    const type = response.headers.get('content-type') || '';
    const value = type.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
        const message = value?.error?.message || value?.error || `请求失败（${response.status}）`;
        throw new Error(message);
    }
    return value;
}
export const api = {
    health: () => request('/api/health'),
    rpc: (method, payload = {}) => request('/api/rpc', { body: { method, payload } }),
    workspaces: () => request('/api/workspaces'),
    workspaceAction: async (payload) => {
        const result = await request('/api/workspaces', { body: payload });
        if (payload.action === 'activate') {
            taskStore.epoch++;
            taskStore.tasks = [];
            taskStore.root = '';
            taskStore.loaded = false;
            taskStore.emit();
            window.dispatchEvent(new CustomEvent('workbench-workspace-changed', { detail: { id: result.active } }));
        }
        return result;
    },
    settings: () => request('/api/settings'),
    autoStatus: () => request('/api/auto/status'),
    autoRun: (taskIds) => request('/api/auto/run', { body: { taskIds } }),
    autoStop: () => request('/api/auto/stop', { body: {} }),
    autoJob: (id) => request(`/api/auto/job?id=${encodeURIComponent(id)}`),
    autoLatest: () => request('/api/auto/job?latest=1'),
    saveSettings: (patch) => request('/api/settings', { body: patch }),
    openFolder: (kind) => request('/api/settings/open', { body: { kind } }),
    tasks: () => request('/api/chatgpt/tasks'),
    taskRoot: () => request('/api/chatgpt/tasks/root'),
    createTask: (payload) => request('/api/chatgpt/tasks', { body: payload }),
    completeTask: (id, dataUrl) => request(`/api/chatgpt/tasks/${id}/complete`, {
        body: { data: String(dataUrl).split(',')[1] || dataUrl }
    }),
    cancelTask: (id) => request(`/api/chatgpt/tasks/${id}/cancel`, { body: {} }),
    preset: () => request('/api/chatgpt/preset', { body: {} }),
    handoff: (text) => request('/api/handoff', { body: { text } }),
    instruction: (id) => fetch(withBase(`/api/chatgpt/tasks/${id}/交给ChatGPT生图.md`)).then((r) => r.text()),
    resultUrl: (task) => withBase(`/api/chatgpt/tasks/${task.id}/${task.result}`),
    referenceUrl: (task, index) => withBase(`/api/chatgpt/tasks/${task.id}/${task.references?.[index] || `reference-${index + 1}.png`}`)
};
export const STATUS = {
    waiting: { label: '等待回填', tone: 'waiting' },
    completed: { label: '已完成', tone: 'done' },
    expired: { label: '等待超时', tone: 'warn' },
    interrupted: { label: '已中断', tone: 'warn' },
    cancelled: { label: '已取消', tone: 'muted' }
};
export function statusOf(task) {
    if (task?.status === 'waiting' && task.automation) {
        const stage = task.automation.stage;
        const labels = { starting: '连接 ChatGPT', generating: '正在生图', backfilling: '自动回填中', failed: '自动生图失败' };
        if (labels[stage])
            return { label: labels[stage], tone: stage === 'failed' ? 'warn' : 'waiting' };
    }
    return STATUS[task?.status] || { label: task?.status || '未知', tone: 'muted' };
}
/* ── 共享任务仓 ─────────────────────────────────────────────
 * 一处轮询，多处订阅。页面切换不会重置定时器，任务角标也走同一份数据。
 */
const taskStore = {
    tasks: [],
    root: '',
    loaded: false,
    error: '',
    listeners: new Set(),
    timer: 0,
    pending: null,
    epoch: 0,
    async load(force = false) {
        if (this.pending && !force)
            return this.pending;
        const epoch = this.epoch;
        this.pending = (async () => {
            try {
                const tasks = await api.tasks();
                if (epoch !== this.epoch)
                    return;
                if (!this.root) {
                    try {
                        this.root = (await api.taskRoot()).path || '';
                    }
                    catch { /* 目录接口失败不影响任务列表 */ }
                }
                const snapshot = JSON.stringify(tasks);
                this.error = '';
                if (snapshot !== JSON.stringify(this.tasks) || !this.loaded) {
                    this.tasks = tasks;
                    this.emit();
                }
                this.loaded = true;
            }
            catch (error) {
                this.error = error.message;
                this.emit();
            }
            finally {
                if (epoch === this.epoch)
                    this.pending = null;
            }
        })();
        return this.pending;
    },
    emit() {
        for (const listener of this.listeners)
            listener(this);
    },
    subscribe(listener) {
        this.listeners.add(listener);
        if (!this.timer) {
            this.load();
            this.timer = setInterval(() => this.load(), 6000);
        }
        listener(this);
        return () => {
            this.listeners.delete(listener);
            if (!this.listeners.size) {
                clearInterval(this.timer);
                this.timer = 0;
            }
        };
    },
    pendingCount() {
        return this.tasks.filter((task) => task.status === 'waiting').length;
    },
    bySource(prefix) {
        return this.tasks.filter((task) => String(task.source || '').startsWith(prefix));
    }
};
export { taskStore };
/** 文件 → data URL（工作台的任务接口只接受 data URL 参考图）。 */
export function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.readAsDataURL(file);
    });
}
/** 读取本地任务目录里的交接文件路径。 */
export function taskFolder(task, root) {
    return root ? `${root}\\${task.id}` : `data/chatgpt-images/${task.id}`;
}
