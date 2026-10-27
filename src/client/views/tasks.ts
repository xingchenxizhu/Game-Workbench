/** 任务中心：所有生图任务、交接指令、回填与结果下载。 */
import { h, clear, formatDate, toast, copyText, baseName, download, emptyState } from '../lib/dom.js';
import { api, taskStore, statusOf, fileToDataURL, taskFolder, withBase } from '../lib/api.js';
import { exportBlob } from '../lib/export.js';
import { sendTaskToRig, rigDeepLink } from '../lib/rig.js';
import { btn, badge, actionRow } from './kit.js';
import { FLOWS } from '../flows.js';
const FILTERS = [
    { id: 'all', label: '全部任务' },
    { id: 'waiting', label: '等待回填' },
    { id: 'completed', label: '已完成' },
    { id: 'done', label: '已结束 / 异常' }
];
function sourceLabel(task) {
    const source = String(task.source || '');
    if(source.startsWith('asset-pack:'))return '成套素材 · '+source.split(':').slice(2).join(':');
    if(source.startsWith('stitch:'))return '地图扩图';
    if(source==='native-image-live-acceptance')return 'ChatGPT 自动生图';
    if (source.startsWith('flow:')) {
        const flow = FLOWS[source.slice(5)];
        return flow ? `${flow.title} · 流程` : 'AI 流程';
    }
    if (source === 'material-provider')
        return '图片制作 · 模块';
    if (source === 'workbench')
        return '工作台';
    return source || '未标注来源';
}
export function mountTasks(container: any, { toast: notify, openDeepLink }: any = {}) {
    let filter = 'all';
    let query = '';
    let autoBusy = false;
    let alive=true;
    const autoHint = h('span', { class: 'muted small' }, '自动生成：检查中…');
    const toolbar = h('div', { class: 'tasks-toolbar' }, h('div', { class: 'chips', role: 'group', 'aria-label': '筛选任务' }), h('label', { class: 'inline-search' }, h('span', null, '⌕'), h('input', { type: 'search', placeholder: '搜索任务描述…', oninput: (event) => { query = event.target.value.trim(); paint(); } })), btn('自动生成待回填', { kind: 'primary', onclick: async () => {
            if (autoBusy)
                return;
            autoBusy = true;
            autoHint.textContent = '自动生成：启动中…';
            try {
                const job: any = await api.autoRun([]);
                notify(`已启动 Codex，共 ${job.total} 项`);
                while (alive) {
                    await new Promise(resolve => setTimeout(resolve, 2500));
                    const state: any = await api.autoJob(job.id);
                    if (state.status === 'failed')
                        throw new Error(state.message);
                    autoHint.textContent = `自动生成：${state.status === 'running' ? `${state.done}/${state.total}` : state.message}`;
                    if (['done','partial','cancelled','interrupted'].includes(state.status)) {
                        notify(state.message);
                        await taskStore.load(true);
                        break;
                    }
                }
            }
            catch (error: any) {
                const message = /404/.test(String(error.message)) ? '服务端未加载自动生成接口，请重启工作台' : error.message;
                autoHint.textContent = `自动生成：${message}`;
                notify(message, 'error');
            }
            finally { autoBusy = false; }
        } }), autoHint, btn('刷新', { kind: 'quiet', onclick: () => taskStore.load(true) }));
    toolbar.append(btn('停止自动生图',{kind:'quiet',onclick:async()=>{try{await api.autoStop();notify('已停止后续生图，已完成结果保留');}catch(error:any){notify(error.message,'error');}}}));
    const chips = toolbar.querySelector('.chips');
    for (const item of FILTERS) {
        chips.append(h('button', {
            class: 'chip', type: 'button', dataset: { filter: item.id }, onclick: () => { filter = item.id; paint(); }
        }, item.label));
    }
    const list = h('div', { class: 'task-list' });
    const summary = h('p', { class: 'tasks-summary' });
    container.append(h('header', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'TASK CENTER'), h('h1', null, '任务中心'), h('p', { class: 'page-sub' }, '开启自动生图后，工作台会整理描述与参考图，调用本机 ChatGPT 内置图片工具，自动回填原任务并显示成品。失败原因会保留，也可手动交接或导入。')), toolbar, summary, list);
    function paint() {
        for (const chip of chips.children)
            chip.classList.toggle('on', chip.dataset.filter === filter);
        const tasks = taskStore.tasks;
        const waiting = tasks.filter((task) => task.status === 'waiting').length;
        summary.textContent = taskStore.error
            ? `本地服务异常：${taskStore.error}`
            : `共 ${tasks.length} 个任务 · ${waiting} 个等待回填 · 任务目录 ${taskStore.root || 'data/chatgpt-images'}`;
        clear(list);
        const filtered = tasks.filter((task) => {
            if (filter === 'waiting' && task.status !== 'waiting')
                return false;
            if (filter === 'completed' && task.status !== 'completed')
                return false;
            if (filter === 'done' && ['waiting', 'completed'].includes(task.status))
                return false;
            if (query && !`${task.prompt} ${sourceLabel(task)}`.toLowerCase().includes(query.toLowerCase()))
                return false;
            return true;
        });
        if (!filtered.length) {
            list.append(emptyState('☰', tasks.length ? '这个筛选下没有任务' : '还没有任务', tasks.length ? '换一个筛选条件看看。' : '从素材工坊的任一流程，或在「图片制作」里提交生成后，任务会出现在这里。'));
            return;
        }
        for (const task of filtered)
            list.append(taskCard(task));
    }
    function taskCard(task) {
        const status = statusOf(task);
        const firstLine = String(task.prompt || '').split('\n')[0];
        const card = h('article', { class: 'task-card' }, h('div', { class: 'task-head' }, badge(status.label, status.tone), h('span', { class: 'task-source' }, sourceLabel(task)), h('time', { datetime: task.createdAt }, formatDate(task.createdAt)), h('code', { class: 'task-id', title: '任务编号' }, task.id.slice(0, 8))), h('p', { class: 'task-prompt' }, firstLine), task.prompt.includes('\n') ? h('details', { class: 'task-detail' }, h('summary', null, '完整提示词'), h('pre', null, task.prompt)) : null, task.references?.length ? h('div', { class: 'task-refs' }, ...task.references.map((file, index) => h('a', { href: api.referenceUrl(task, index), target: '_blank', rel: 'noopener' }, h('img', { src: api.referenceUrl(task, index), alt: `参考图 ${index + 1}`, loading: 'lazy' })))) : null);
        card.dataset.taskId=task.id;
        if(task.automation){const stage=task.status==='completed'?'completed':task.automation.stage,labels={starting:'连接 ChatGPT',generating:'ChatGPT 正在生成图片',backfilling:'正在自动回填',completed:'已自动回填',failed:'自动生成失败'};card.append(h('p',{class:stage==='failed'?'warn-text':'muted small'},labels[stage]||stage,task.automation.message?'：'+task.automation.message:''));}
        if (task.status === 'completed' && task.result) {
            const url = api.resultUrl(task);
            card.append(h('div', { class: 'task-result' }, h('a', { href: url, target: '_blank', rel: 'noopener' }, h('img', { src: url, alt: '生成结果', loading: 'lazy' }))));
            const actions = actionRow(h('a', { class: 'btn btn-small', href: url, target: '_blank', rel: 'noopener' }, '查看原图'), btn('下载图片', { kind: 'primary', onclick: async (event: Event) => {
                    const button = event.currentTarget as HTMLButtonElement;
                    button.disabled = true;
                    try {
                        const response = await fetch(url);
                        if (!response.ok)
                            throw new Error('结果读取失败');
                        await exportBlob(await response.blob(), `task-${task.id.slice(0, 8)}-${task.result}`);
                    }
                    catch (error: any) {
                        toast(error.message, 'error');
                    }
                    finally {
                        button.disabled = false;
                    }
                } }), btn('复制提示词', { kind: 'quiet', onclick: () => copyText(task.prompt).then(() => toast('提示词已复制')) }));
            if (String(task.source) === 'flow:split') {
                actions.append(btn('送入骨骼装配', { kind: 'primary', onclick: () => toRig(task) }));
            }
            card.append(actions);
        }
        else {
            const actions = actionRow(btn('复制交接指令', { kind: 'primary', onclick: () => copyInstruction(task) }), h('a', { class: 'btn btn-small', href: withBase(`/api/chatgpt/tasks/${task.id}/交给ChatGPT生图.md`), target: '_blank', rel: 'noopener' }, '查看指令文件'), task.status === 'waiting' ? backfillButton(task) : null, task.status !== 'cancelled' ? btn('取消任务', { kind: 'danger-quiet', onclick: () => cancel(task) }) : null);
            if(task.status!=='cancelled')actions.prepend(btn('ChatGPT 自动生成',{onclick:async()=>{try{await api.autoRun([task.id]);notify('已提交 ChatGPT 生图，完成后自动显示');await taskStore.load(true);}catch(error:any){notify(error.message,'error');}}}));
            card.append(actions);
            card.append(h('details', { class: 'task-detail' }, h('summary', null, '本地任务文件'), h('pre', null, `${taskFolder(task, taskStore.root)}\\交给ChatGPT生图.md`)));
        }
        return card;
    }
    async function copyInstruction(task) {
        try {
            const text = await api.instruction(task.id);
            await copyText(text);
            toast('交接指令已复制，粘贴到当前聊天即可请求生成。');
        }
        catch (error) {
            toast(error.message, 'error');
        }
    }
    function backfillButton(task) {
        const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
        const button = btn('回填生成结果', {
            onclick: () => input.click()
        });
        input.addEventListener('change', async () => {
            if (!input.files[0])
                return;
            button.disabled = true;
            try {
                const dataUrl = await fileToDataURL(input.files[0]);
                await api.completeTask(task.id, dataUrl);
                toast('回填完成，原流程会继续。');
                taskStore.load(true);
            }
            catch (error) {
                toast(error.message, 'error');
            }
            finally {
                button.disabled = false;
                input.value = '';
            }
        });
        return h('span', { class: 'inline-upload' }, input, button);
    }
    async function cancel(task) {
        try {
            await api.cancelTask(task.id);
            toast('任务已取消');
            taskStore.load(true);
        }
        catch (error) {
            toast(error.message, 'error');
        }
    }
    async function toRig(task) {
        try {
            toast('正在创建骨骼任务并导入拆件图…');
            const jobId = await sendTaskToRig(task);
            if (typeof openDeepLink === 'function')
                openDeepLink(rigDeepLink(jobId));
            else
                location.hash = '/tool/rig';
            toast('已送入骨骼装配，正在打开拆件阶段。');
        }
        catch (error) {
            toast(error.message, 'error');
        }
    }
    const unsubscribe = taskStore.subscribe(paint);
    void api.autoStatus().then((status: any) => {
        autoHint.textContent = status.available?`ChatGPT 生图已连接 · 创建后自动生成${status.enabled?'已开启':'未开启'}`:status.message||'未找到 Codex，请安装并登录 ChatGPT';
    }).catch(() => {
        autoHint.textContent = '自动生成：服务端未加载，请重启工作台';
    });
    void api.autoLatest().then(async (job: any) => {
        if (!job)
            return;
        autoHint.textContent = `自动生成：${job.message || job.status}`;
        if (job.status !== 'running')
            return;
        autoHint.textContent = `自动生成：续接 ${job.done}/${job.total}`;
        while (alive) {
            await new Promise(resolve => setTimeout(resolve, 2500));
            const state: any = await api.autoJob(job.id);
            autoHint.textContent = `自动生成：${state.status === 'running' ? `${state.done}/${state.total}` : state.message}`;
            if (['done','partial','failed','interrupted','cancelled'].includes(state.status))
                break;
        }
    }).catch(() => { });
    const unsubscribeError = (() => {
        const timer = setInterval(() => { if (taskStore.error)
            paint(); }, 4000);
        return () => clearInterval(timer);
    })();
    return () => { alive=false;unsubscribe(); unsubscribeError(); };
}
