import { SPACES, TOOLS, SPECIAL, PIPELINES, getTool, getSpace, toolsOf, spaceOf, groupByStage, searchTools } from './registry.js';
import { FLOWS } from './flows.js';
import { h, clear, qs, formatDate, toast, copyText } from './lib/dom.js';
import { api, taskStore } from './lib/api.js';
import { resolveDeepLink } from './lib/deeplink.js';
import { mountTasks } from './views/tasks.js';
import { mountMatte } from './views/matte.js';
import { mountAdjust } from './views/adjust.js';
import { mountUpscale } from './views/upscale.js';
import { mountGdd } from './views/gdd.js';
import { mountLibrary } from './views/library.js';
import { mountVideo } from './views/video.js';
import { mountPixel } from './views/pixel.js';
import { mountStory } from './views/story.js';
import { mountSidescroll } from './views/sidescroll.js';
import { mountSettings } from './views/settings.js';
import { mountFlow } from './views/flow.js';
import { mountSprites } from './views/sprites.js';
import { mountLayers } from './views/layers.js';
import { mountAssetPack } from './views/asset-pack.js';
import { mountStitch } from './views/stitch.js';
const VIEWS = { stitch: mountStitch, sprites: mountSprites, layers: mountLayers, 'asset-pack': mountAssetPack, tasks: mountTasks, matte: mountMatte, adjust: mountAdjust, upscale: mountUpscale, gdd: mountGdd, library: mountLibrary, video: mountVideo, pixel: mountPixel, story: mountStory, sidescroll: mountSidescroll, settings: mountSettings };
const STORE = {
    get(key, fallback) {
        try {
            return JSON.parse(localStorage.getItem(`wb3.${key}`)) ?? fallback;
        }
        catch {
            return fallback;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(`wb3.${key}`, JSON.stringify(value));
        }
        catch { /* 隐私模式下忽略 */ }
    }
};
const state = {
    nativeSessions: false,
    sessionRequests: new Map(),
    route: { name: 'home' },
    recent: (STORE.get('recent', []) || []).filter((id) => getTool(id)),
    favorites: STORE.get('favorite', []) || [],
    theme: STORE.get('theme', 'dark'),
    rail: !!STORE.get('rail', false),
    health: 'connecting',
    cleanup: null,
    framePool: new Map(),
    nativePool: new Map(),
    openQuery: {},
    currentTool: ''
};
const root = document.querySelector('#app');
const palette = { open: false, index: 0, items: [] };
/* ── 布局 ─────────────────────────────────────────────────── */
function buildShell() {
    root.replaceChildren();
    const sidebar = h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': '主导航' });
    const brand = h('a', { class: 'brand', href: '#/home' }, h('span', { class: 'brand-mark' }, '◈'), h('span', { class: 'brand-text' }, h('strong', null, '游戏工作台'), h('small', null, 'GAME WORKBENCH · V3.6')), h('span', { class: 'brand-ver' }, 'V3.6'));
    const mainNav = h('nav', { class: 'nav nav-main', 'aria-label': '工作台' }, navItem('home', '◆', '工作台概览'), navItem('tasks', '☰', '任务中心', h('span', { class: 'nav-count', id: 'nav-count' }, '0')));
    const spaceNav = h('nav', { class: 'nav nav-spaces', 'aria-label': '创作空间' });
    for (const space of SPACES) {
        const item = h('a', {
            class: 'nav-space', href: `#/space/${space.id}`, dataset: { space: space.id },
            style: { '--accent': space.accent }, title: space.description
        }, h('span', { class: 'nav-icon' }, space.icon), h('span', { class: 'nav-title' }, space.title), h('span', { class: 'nav-count' }, String(toolsOf(space.id).length)));
        spaceNav.append(item);
    }
    const foot = h('div', { class: 'sidebar-foot' }, h('div', { class: 'health', id: 'health' }, h('span', { class: 'dot' }), h('span', null, '正在连接本地服务')), h('a', { class: 'foot-link', href: '#/settings' }, h('span', null, '⚙'), h('span', null, '模型与设置'), h('span', { class: 'foot-arrow' }, '↗')), h('p', { class: 'foot-note' }, '素材与项目保存在本机'));
    sidebar.append(brand, mainNav, h('div', { class: 'nav-label' }, '创作空间'), spaceNav, foot);
    const topbar = h('header', { class: 'topbar' }, h('button', { class: 'icon-btn menu-btn', id: 'menu', 'aria-label': '打开导航', 'aria-expanded': 'false', onclick: () => { document.body.classList.toggle('nav-open'); syncRail(); } }, '☰'), h('div', { class: 'crumbs', id: 'crumbs' }), h('div', { class: 'topbar-actions' }, h('button', { class: 'search-btn', id: 'open-search', onclick: openPalette }, h('span', { class: 'search-icon' }, '⌕'), h('span', { class: 'search-label' }, '搜索功能'), h('kbd', null, 'Ctrl K')), h('a', { class: 'task-btn', id: 'task-btn', href: '#/tasks' }, h('span', null, '任务'), h('span', { class: 'task-pill', id: 'task-pill' }, '0')), h('button', { class: 'icon-btn', id: 'theme', 'aria-label': '切换主题', onclick: toggleTheme }, '◐')));
    const view = h('main', { class: 'view', id: 'view', tabindex: '-1' });
    const scrollByPage = (direction) => {
        view.scrollTop += direction * Math.max(240, view.clientHeight * 0.82);
    };
    const scrollPad = h('div', { class: 'scroll-pad' }, h('button', { class: 'scroll-btn', type: 'button', title: '上一屏（PageUp）', onclick: () => scrollByPage(-1) }, '↑'), h('button', { class: 'scroll-btn', type: 'button', title: '下一屏（PageDown）', onclick: () => scrollByPage(1) }, '↓'));
    // 兜底：某些内嵌浏览器（DSH 面板里的 Chromium 视图）不把滚轮事件交给页面，这里提供键盘、拖动与按钮三种滚动方式。
    document.addEventListener('keydown', (event) => {
        const active = document.activeElement;
        if (active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable))
            return;
        if (event.key === 'PageDown') {
            event.preventDefault();
            scrollByPage(1);
        }
        else if (event.key === 'PageUp') {
            event.preventDefault();
            scrollByPage(-1);
        }
        else if (event.key === 'Home') {
            event.preventDefault();
            view.scrollTop = 0;
        }
        else if (event.key === 'End') {
            event.preventDefault();
            view.scrollTop = view.scrollHeight;
        }
    });
    let drag = null;
    view.addEventListener('pointerdown', (event) => {
        if (event.button !== 0)
            return;
        const target = event.target;
        if (target.closest('button,a,input,textarea,select,canvas,label,[role="button"],.tool-card,.task-card,.workspace-card'))
            return;
        drag = { y: event.clientY, top: view.scrollTop };
        view.classList.add('dragging');
    });
    view.addEventListener('pointermove', (event) => {
        if (!drag)
            return;
        const delta = event.clientY - drag.y;
        if (Math.abs(delta) > 3)
            view.scrollTop = drag.top - delta;
    });
    const endDrag = () => { drag = null; view.classList.remove('dragging'); };
    view.addEventListener('pointerup', endDrag);
    view.addEventListener('pointercancel', endDrag);
    view.addEventListener('wheel', (event) => {
        if (event.ctrlKey)
            return;
        let node = event.target;
        while (node && node !== view) {
            const style = getComputedStyle(node);
            if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight)
                return;
            node = node.parentElement;
        }
        if (view.scrollHeight <= view.clientHeight)
            return;
        view.scrollTop += event.deltaY;
        event.preventDefault();
    }, { passive: false });
    const frameView = h('main', { class: 'view view-frame', id: 'frame-view', hidden: true }, h('div', { id: 'frame-heading' }), h('div', { id: 'persistent-frames', class: 'tool-body is-frame' }));
    const appBody = h('div', { class: 'app-body' }, topbar, view, frameView, scrollPad);
    root.append(h('div', { class: 'app' }, sidebar, appBody, h('div', { class: 'frame-pool', id: 'frame-pool', 'aria-hidden': 'true' })));
    root.append(buildPalette());
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.dataset.rail = String(state.rail);
    syncRail();
}
function navItem(route, icon, label, extra = null) {
    return h('a', { class: 'nav-item', href: `#/${route}`, dataset: { route } }, h('span', { class: 'nav-icon' }, icon), h('span', { class: 'nav-title' }, label), extra || null);
}
function syncRail() {
    const sidebar = qs('#sidebar');
    if (!sidebar)
        return;
    sidebar.inert = window.matchMedia('(max-width: 760px)').matches && !document.body.classList.contains('nav-open');
    qs('#menu')?.setAttribute('aria-expanded', String(document.body.classList.contains('nav-open')));
    document.documentElement.dataset.rail = String(state.rail);
}
/* ── 路由 ─────────────────────────────────────────────────── */
function parseHash() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [name, id] = hash.split('/');
    if (!name)
        return { name: 'home' };
    if (name === 'space' && getSpace(id))
        return { name: 'space', id };
    if (name === 'tool' && getTool(id))
        return { name: 'tool', id };
    if (name === 'flow' && FLOWS[id])
        return { name: 'tool', id: FLOWS[id].tool };
    if (name === 'tasks')
        return { name: 'tasks' };
    if (name === 'settings')
        return { name: 'settings' };
    return { name: 'home' };
}
function navigate(hash) {
    if (location.hash === `#/${hash}`)
        render();
    else
        location.hash = `/${hash}`;
}
function render() {
    if (state.cleanup) {
        try {
            state.cleanup();
        }
        catch (error) {
            console.error(error);
        }
        state.cleanup = null;
    }
    hidePools();
    state.route = parseHash();
    const view = qs('#view');
    view.hidden = false;
    qs('#frame-view').hidden = true;
    clear(view);
    view.classList.remove('view-frame');
    document.body.classList.remove('nav-open');
    syncRail();
    const route = state.route;
    document.querySelectorAll('.nav-item,.nav-space').forEach((node) => {
        const space = route.name === 'tool' ? spaceOf(getTool(route.id)) : route.name === 'space' ? getSpace(route.id) : null;
        const active = route.name === 'home' ? node.dataset.route === 'home'
            : route.name === 'tasks' ? node.dataset.route === 'tasks'
                : route.name === 'settings' ? node.dataset.route === 'settings'
                    : space && node.dataset.space === space.id;
        node.classList.toggle('active', !!active);
        if (active)
            node.setAttribute('aria-current', 'page');
        else
            node.removeAttribute('aria-current');
    });
    if (route.name === 'home')
        renderHome(view);
    else if (route.name === 'space')
        renderSpace(view, getSpace(route.id));
    else if (route.name === 'tool')
        renderTool(view, getTool(route.id));
    else if (route.name === 'tasks') {
        setCrumbs([['任务中心']]);
        state.cleanup = mountTasks(view, { navigate, toast, openDeepLink });
    }
    else if (route.name === 'settings') {
        setCrumbs([['模型与设置']]);
        mountSettings(view, { navigate, toast });
    }
    view.focus({ preventScroll: true });
    view.scrollTop = 0;
    window.scrollTo(0, 0);
}
function setCrumbs(items) {
    const crumbs = qs('#crumbs');
    clear(crumbs);
    items.forEach(([label, href], index) => {
        if (index)
            crumbs.append(h('span', { class: 'crumb-sep' }, '/'));
        crumbs.append(href ? h('a', { href }, label) : h('span', { class: 'crumb-current' }, label));
    });
    document.title = `${items.map((x) => x[0]).join(' / ')} · 游戏工作台`;
}
function remember(tool) {
    if (!tool || tool.id === SPECIAL.id)
        return;
    state.recent = [tool.id, ...state.recent.filter((id) => id !== tool.id)].slice(0, 6);
    STORE.set('recent', state.recent);
}
/* ── 首页 ─────────────────────────────────────────────────── */
function renderHome(view) {
    setCrumbs([['工作台', '#/home'], ['概览']]);
    const hero = h('section', { class: 'hero' }, h('div', { class: 'hero-copy' }, h('p', { class: 'eyebrow' }, 'GAME ASSET WORKBENCH'), h('h1', null, '把想法，', h('em', null, '做成能玩的素材。')), h('p', { class: 'hero-sub' }, '生成、修整、装配、导出。素材、角色、场景与声音都在同一条流水线上，做完一步就能接下一步。'), h('div', { class: 'hero-actions' }, h('a', { class: 'btn btn-primary', href: '#/tool/image' }, '＋ 开始做素材'), h('a', { class: 'btn', href: '#/tool/gdd' }, '写策划'), h('a', { class: 'btn btn-quiet', href: '#/tasks' }, '看任务'))), h('div', { class: 'hero-art', 'aria-hidden': 'true' }, h('div', { class: 'art-grid' }), h('div', { class: 'art-tile t1' }), h('div', { class: 'art-tile t2' }), h('div', { class: 'art-tile t3' })));
    const stats = h('section', { class: 'stat-strip' }, stat(`${TOOLS.length}`, '项工具'), stat(`${SPACES.length}`, '个创作空间'), stat(`${PIPELINES.length}`, '条生产链'), stat(String(taskStore.pendingCount()), '个待回填任务', '#/tasks', 'stat-pending'));
    const pipelines = h('section', { class: 'section' }, sectionHead('生产链', '从第一步点到最后一 步，不会迷路', '#/tool/image', '看全部工具'), h('div', { class: 'pipeline-grid' }, ...PIPELINES.map(pipelineCard)));
    const recentTools = state.recent.map(getTool).filter(Boolean).slice(0, 4);
    const recentSection = recentTools.length ? h('section', { class: 'section' }, sectionHead('最近使用', '本机访问记录'), h('div', { class: 'recent-grid' }, ...recentTools.map(recentCard))) : null;
    const matrix = h('section', { class: 'section' }, sectionHead('全部功能', '按创作空间分组，搜索框可以直接跳转'), h('div', { class: 'matrix' }, ...SPACES.map((space) => h('div', { class: 'matrix-col', style: { '--accent': space.accent } }, h('a', { class: 'matrix-head', href: `#/space/${space.id}` }, h('span', null, space.icon), h('span', null, space.title), h('span', { class: 'matrix-count' }, String(toolsOf(space.id).length))), h('div', { class: 'matrix-list' }, ...toolsOf(space.id).map((tool) => h('a', { class: 'matrix-item', href: `#/tool/${tool.id}` }, h('span', { class: 'matrix-icon' }, tool.icon), h('span', null, tool.title))))))));
    const pending = taskStore.tasks.filter((task) => task.status === 'waiting').slice(0, 3);
    const pendingSection = pending.length ? h('section', { class: 'section' }, sectionHead('等待回填', '这些任务正在等生成结果', '#/tasks', '打开任务中心'), h('div', { class: 'pending-list' }, ...pending.map((task) => h('div', { class: 'pending-row' }, h('span', { class: 'badge waiting' }, '等待回填'), h('span', { class: 'pending-text' }, task.prompt.split('\n')[0].slice(0, 90)), h('span', { class: 'muted' }, formatDate(task.createdAt)))))) : null;
    view.append(...[hero, stats, pipelines, recentSection, matrix, pendingSection, h('p', { class: 'home-foot' }, '本地工作区 / 生成结果由当前聊天执行后回填 / 所有项目数据保存在本机 data 目录')].filter(Boolean));
}
function stat(value, label, href, id) {
    const content = h('span', { class: 'stat-value', id: id || null }, value);
    return h(href ? 'a' : 'div', { class: 'stat', href }, content, h('span', { class: 'stat-label' }, label));
}
function sectionHead(title, sub, href, linkLabel) {
    return h('div', { class: 'section-head' }, h('div', null, h('h2', null, title), sub ? h('p', null, sub) : null), href ? h('a', { class: 'section-link', href }, linkLabel || '查看 →') : null);
}
function pipelineCard(pipeline) {
    const steps = pipeline.steps.map(getTool).filter(Boolean);
    return h('article', { class: 'pipeline-card', style: { '--accent': pipeline.accent } }, h('div', { class: 'pipeline-head' }, h('span', { class: 'pipeline-icon' }, pipeline.icon), h('h3', null, pipeline.title)), h('p', { class: 'pipeline-sub' }, pipeline.summary), h('div', { class: 'pipeline-steps' }, ...steps.map((tool, index) => h('a', { class: 'step', href: `#/tool/${tool.id}`, title: tool.summary }, h('span', { class: 'step-no' }, String(index + 1).padStart(2, '0')), h('span', { class: 'step-name' }, tool.title)))));
}
function recentCard(tool) {
    const space = spaceOf(tool);
    return h('a', { class: 'recent-card', href: `#/tool/${tool.id}`, style: { '--accent': space?.accent } }, h('span', { class: 'recent-icon' }, tool.icon), h('span', { class: 'recent-body' }, h('strong', null, tool.title), h('small', null, tool.summary)), h('span', { class: 'recent-arrow' }, '↗'));
}
/* ── 空间页 ───────────────────────────────────────────────── */
function renderSpace(view, space) {
    setCrumbs([['工作台', '#/home'], [space.title]]);
    const items = toolsOf(space.id);
    const head = h('header', { class: 'page-head', style: { '--accent': space.accent } }, h('p', { class: 'eyebrow' }, space.en), h('h1', null, space.title), h('p', { class: 'page-sub' }, space.description), h('div', { class: 'page-meta' }, h('span', { class: 'meta-chip' }, `${items.length} 项工具`), ...items.flatMap((tool) => tool.origin.split(' · ').slice(0, 1)).filter((value, index, list) => list.indexOf(value) === index).slice(0, 4).map((origin) => h('span', { class: 'meta-chip' }, origin))));
    view.append(head);
    for (const group of groupByStage(items)) {
        view.append(h('section', { class: 'stage', style: { '--accent': space.accent } }, h('div', { class: 'stage-head' }, h('h2', null, group.stage), h('span', null, `${group.items.length} 项`)), h('div', { class: 'tool-grid' }, ...group.items.map(toolCard))));
    }
}
function toolCard(tool) {
    const space = spaceOf(tool);
    return h('article', { class: 'tool-card', style: { '--accent': space?.accent } }, h('a', { class: 'tool-card-main', href: `#/tool/${tool.id}` }, h('div', { class: 'tool-top' }, h('span', { class: 'tool-icon' }, tool.icon), h('span', { class: 'tool-badge' }, tool.badge), h('span', { class: 'tool-stage' }, tool.stage)), h('h3', null, tool.title), h('p', null, tool.summary), h('div', { class: 'tool-tags' }, ...tool.tags.map((tag) => h('span', { class: 'tag' }, tag)))), h('div', { class: 'tool-foot' }, h('span', { class: 'tool-origin' }, tool.origin), h('a', { class: 'tool-open', href: `#/tool/${tool.id}` }, '打开 →')));
}
/* ── 工具页 ───────────────────────────────────────────────── */
function renderTool(view, tool) {
    const space = spaceOf(tool);
    remember(tool);
    setCrumbs([['工作台', '#/home'], space ? [space.title, `#/space/${space.id}`] : ['工具'], [tool.title]]);
    if (tool.kind === 'frame')
        view.classList.add('view-frame');
    const head = h('header', { class: 'tool-head', style: { '--accent': space?.accent || 'var(--accent)' } }, h('div', { class: 'tool-head-main' }, h('span', { class: 'tool-head-icon' }, tool.icon), h('div', { class: 'tool-head-text' }, h('p', { class: 'eyebrow' }, space ? `${space.en} / ${tool.stage}` : 'PREFERENCES'), h('h1', null, tool.title), h('p', { class: 'tool-head-sub' }, tool.summary))), h('div', { class: 'tool-head-actions' }, h('span', { class: 'origin-tag' }, tool.origin), tool.kind === 'frame' ? h('a', { class: 'btn btn-small', href: tool.url, target: '_blank', rel: 'noopener' }, '新窗口打开 ↗') : null, tool.kind === 'frame' ? h('button', { class: 'btn btn-small', id: 'reload-frame', onclick: () => reloadFrame(tool) }, '重新载入') : null));
    const body = h('div', { class: 'tool-body', id: 'tool-body' });
    view.append(head, body);
    state.currentTool = tool.id;
    if (tool.kind === 'frame') {
        view.hidden = true;
        qs('#frame-view').hidden = false;
        qs('#frame-heading').replaceChildren(head);
        const frame = frameFor(tool);
        frame.removeAttribute('hidden');
        body.classList.add('is-frame');
    }
    else if (state.nativePool.has(tool.id)) {
        const cached = state.nativePool.get(tool.id);
        cached.node.hidden = false;
        body.append(cached.node);
    }
    else if (tool.kind === 'flow') {
        const flow = FLOWS[tool.flow];
        if (!flow) {
            body.append(h('p', { class: 'muted' }, '流程定义缺失。'));
            return;
        }
        const node = h('div', { class: 'native-workspace' });
        body.append(node);
        const cleanup = mountFlow(node, { tool, flow, navigate, toast, copyText, openDeepLink, onTask: () => taskStore.load(true) });
        state.nativePool.set(tool.id, { node, cleanup });
    }
    else if (tool.kind === 'native') {
        const mount = VIEWS[tool.view];
        if (!mount) {
            body.append(h('p', { class: 'muted' }, '界面尚未实现。'));
            return;
        }
        const node = h('div', { class: 'native-workspace' });
        body.append(node);
        const cleanup = mount(node, { tool, navigate, toast, copyText, openDeepLink }) || null;
        state.nativePool.set(tool.id, { node, cleanup });
    }
}
function frameFor(tool) {
    let wrap = state.framePool.get(tool.id);
    if (!wrap) {
        wrap = h('div', { class: 'frame-wrap', dataset: { tool: tool.id } });
        const src = state.openQuery[tool.id] || tool.url;
        const frame = h('iframe', { class: 'frame', title: tool.title, src, loading: 'eager' });
        frame.addEventListener('load', () => frame.contentWindow?.postMessage({ type: 'workbench-host-capabilities', sessions: state.nativeSessions }, location.origin));
        wrap.append(frame);
        state.framePool.set(tool.id, wrap);
        qs('#persistent-frames').append(wrap);
        wrap.dataset.tool = tool.id;
    }
    wrap.hidden = false;
    return wrap;
}
function reloadFrame(tool) {
    const frame = state.framePool.get(tool.id)?.querySelector('iframe');
    if (frame) {
        frame.src = frame.src;
        toast('已重新载入工具页面');
    }
}
function hidePools() {
    const pool = qs('#frame-pool');
    if (!pool)
        return;
    for (const item of state.nativePool.values()) {
        pool.append(item.node);
        item.node.hidden = true;
    }
    for (const wrap of state.framePool.values()) {
        wrap.hidden = true;
    }
}
/* ── 命令面板 ─────────────────────────────────────────────── */
function buildPalette() {
    const input = h('input', { class: 'palette-input', type: 'text', placeholder: '搜索功能、空间或命令…', autocomplete: 'off', 'aria-label': '搜索功能' });
    const list = h('div', { class: 'palette-list', role: 'listbox' });
    const overlay = h('div', { class: 'palette', hidden: true, role: 'dialog', 'aria-label': '命令面板' }, h('div', { class: 'palette-box' }, h('div', { class: 'palette-search' }, h('span', null, '⌕'), input, h('kbd', null, 'Esc')), list, h('p', { class: 'palette-foot' }, '↑↓ 选择 · Enter 打开 · Ctrl K 呼出')));
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay)
            closePalette();
    });
    input.addEventListener('input', () => { palette.index = 0; paintPalette(input.value); });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!palette.items.length)
                return;
            palette.index = (palette.index + (event.key === 'ArrowDown' ? 1 : -1) + palette.items.length) % palette.items.length;
            paintPalette(input.value, true);
        }
        else if (event.key === 'Enter') {
            event.preventDefault();
            palette.items[palette.index]?.run();
        }
    });
    overlay._input = input;
    overlay._list = list;
    return overlay;
}
function openPalette() {
    palette.open = true;
    const overlay = qs('.palette');
    overlay.hidden = false;
    const input = overlay._input;
    input.value = '';
    palette.index = 0;
    paintPalette('');
    setTimeout(() => input.focus(), 20);
}
function closePalette() {
    palette.open = false;
    const overlay = qs('.palette');
    if (overlay)
        overlay.hidden = true;
}
function paintPalette(query, keepScroll = false) {
    const list = qs('.palette')._list;
    clear(list);
    palette.items = [];
    const push = (group, node, run) => { palette.items.push({ group, node, run }); };
    const q = query.trim();
    if (!q) {
        for (const space of SPACES)
            push('创作空间', paletteRow(space.icon, space.title, `${toolsOf(space.id).length} 项工具 · ${space.en}`, { accent: space.accent }), () => { closePalette(); navigate(`space/${space.id}`); });
        push('快捷', paletteRow('☰', '任务中心', '等待回填与历史生成结果'), () => { closePalette(); navigate('tasks'); });
        push('快捷', paletteRow('⚙', '模型与设置', '后端与功能可见性'), () => { closePalette(); navigate('settings'); });
        push('快捷', paletteRow('◐', '切换明暗主题', '当前：' + (state.theme === 'dark' ? '深色' : '浅色')), () => { closePalette(); toggleTheme(); });
    }
    else {
        const matches = searchTools(q);
        if (!matches.length) {
            const tools = TOOLS.filter((tool) => `${tool.title}${tool.summary}`.toLowerCase().includes(q.toLowerCase()));
            matches.push(...tools);
        }
        for (const tool of matches.slice(0, 14)) {
            const space = spaceOf(tool);
            push(space?.title || '工具', paletteRow(tool.icon, tool.title, tool.summary, { accent: space?.accent }), () => { closePalette(); navigate(`tool/${tool.id}`); });
        }
        if (!matches.length)
            list.append(h('p', { class: 'palette-empty' }, '没有匹配的功能，试试「抠图」「视角」「音效」或「策划」。'));
    }
    for (const item of palette.items)
        list.append(item.node);
    if (!keepScroll)
        list.scrollTop = 0;
    highlightPalette();
}
function paletteRow(icon, title, sub, { accent } = {}) {
    return h('button', { class: 'palette-row', type: 'button' }, h('span', { class: 'palette-icon', style: accent ? { color: accent } : null }, icon), h('span', { class: 'palette-text' }, h('strong', null, title), h('small', null, sub)), h('span', { class: 'palette-enter' }, '↵'));
}
function highlightPalette() {
    palette.items.forEach((item, index) => item.node.classList.toggle('on', index === palette.index));
}
document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openPalette();
    }
    else if (event.key === 'Escape') {
        closePalette();
        document.body.classList.remove('nav-open');
        syncRail();
    }
});
document.addEventListener('click', (event) => {
    const row = event.target.closest('.palette-row');
    if (row) {
        const index = [...qs('.palette')._list.children].indexOf(row);
        palette.items[index]?.run();
        return;
    }
    if (!event.target.closest('.palette') && !event.target.closest('#open-search'))
        closePalette();
});
/* ── 主题与连接状态 ───────────────────────────────────────── */
function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    STORE.set('theme', state.theme);
    document.documentElement.dataset.theme = state.theme;
    toast(`已切换到${state.theme === 'dark' ? '深色' : '浅色'}主题`);
}
async function refreshHealth() {
    const node = qs('#health');
    try {
        const health = await api.health();
        state.health = 'ok';
        if (node) {
            node.className = 'health ok';
            node.lastElementChild.textContent = `本地服务已连接 · ${health.methods} 个接口`;
        }
    }
    catch {
        state.health = 'down';
        if (node) {
            node.className = 'health down';
            node.lastElementChild.textContent = '本地服务未连接';
        }
    }
}
function paintTaskBadge() {
    const count = taskStore.pendingCount();
    const pill = qs('#task-pill');
    const nav = qs('#nav-count');
    if (pill) {
        pill.textContent = String(count);
        pill.dataset.zero = String(count === 0);
    }
    if (nav) {
        nav.textContent = String(count);
        nav.dataset.zero = String(count === 0);
    }
}
/* ── 启动 ─────────────────────────────────────────────────── */
/* 原素材模块派发的消息：跳转任务中心、打开其它工具、接收深链接与交接文件。 */
window.addEventListener('workbench-workspace-changed', () => {
    for (const [id, target] of state.sessionRequests) {
        try {
            target.postMessage({ type: 'workbench-session-result', id, ok: false, error: '工作区已切换，请返回任务所属工作区继续。' }, location.origin);
        }
        catch { }
    }
    state.sessionRequests.clear();
    for (const wrap of state.framePool.values())
        wrap.remove();
    state.framePool.clear();
    state.openQuery = {};
    for (const item of state.nativePool.values()) {
        item.cleanup?.();
        item.node.remove();
    }
    state.nativePool.clear();
    render();
});
window.addEventListener('message', (event) => {
    if (event.origin !== location.origin)
        return;
    if (event.source === parent && parent !== window) {
        if (event.data?.type === 'game-workbench-ready') {
            state.nativeSessions = event.data.sessions === true;
            for (const wrap of state.framePool.values())
                wrap.querySelector('iframe')?.contentWindow?.postMessage({ type: 'workbench-host-capabilities', sessions: state.nativeSessions }, location.origin);
        }
        if (event.data?.type === 'game-workbench-session-result') {
            const target = state.sessionRequests.get(event.data.id);
            if (target) {
                target.postMessage({ ...event.data, type: 'workbench-session-result' }, location.origin);
                state.sessionRequests.delete(event.data.id);
            }
        }
        return;
    }
    const fromFrame = [...state.framePool.values()].some((wrap) => wrap.querySelector('iframe')?.contentWindow === event.source);
    if (!fromFrame)
        return;
    const data = event.data;
    if (!data || typeof data !== 'object')
        return;
    if (data.type === 'workbench-session-request' && state.nativeSessions && typeof data.id === 'string' && typeof data.text === 'string' && data.text.length <= 1000000) {
        state.sessionRequests.set(data.id, event.source);
        void api.health().then(info => {
            if (!state.sessionRequests.has(data.id))
                return;
            const scope = info.workspace?.id;
            if (!scope)
                throw new Error('无法确定任务工作区');
            const text = `本任务属于工作区 ${scope}。每次调用 game_workbench 必须带 workspaceId:"${scope}"；若当前工作区不同，先请用户切回，禁止在其他工作区处理。\n\n` + data.text;
            parent.postMessage({ type: 'game-workbench-session-request', id: data.id, text }, location.origin);
        }).catch(error => { event.source?.postMessage({ type: 'workbench-session-result', id: data.id, ok: false, error: error.message }, location.origin); state.sessionRequests.delete(data.id); });
        return;
    }
    if (data.type === 'open-chatgpt-images')
        navigate('tasks');
    else if (data.type === 'workbench-open-tool' && getTool(data.tool))
        navigate(`tool/${data.tool}`);
    else if (data.type === 'workbench-open-link' && typeof data.search === 'string')
        openDeepLink(data.search);
    else if (data.type === 'handoff' && data.file)
        toast(`已保存交接文件：${data.file}`);
});
/** 把原插件的 `?dsh-gmm=1&module=...` 深链接接到对应工具，保留原有 query。 */
function openDeepLink(search) {
    const params = new URLSearchParams(search);
    const tool = getTool(params.get('module') || 'sprite');
    if (!tool)
        return;
    const existing = state.framePool.get(tool.id)?.querySelector('iframe');
    if (existing) {
        const forward = () => existing.contentWindow?.postMessage({ type: 'workbench-intent', search }, location.origin);
        if (existing.contentDocument?.readyState === 'complete')
            forward();
        else
            existing.addEventListener('load', forward, { once: true });
    }
    else {
        state.openQuery[tool.id] = `${tool.url}&${search}`;
    }
    navigate(`tool/${tool.id}`);
}
buildShell();
window.addEventListener('hashchange', render);
window.addEventListener('resize', syncRail);
/* 旧插件的深链接：/?dsh-gmm=1&module=map&stage=paint，首屏直接落到对应工具。 */
(() => {
    const link = resolveDeepLink(location.search);
    if (!link)
        return;
    state.openQuery[link.toolId] = link.url;
    window.history.replaceState(null, '', `${location.pathname}#/tool/${link.toolId}`);
})();
taskStore.subscribe(() => {
    paintTaskBadge();
    const stat = qs('#stat-pending');
    if (stat)
        stat.textContent = String(taskStore.pendingCount());
});
refreshHealth();
setInterval(refreshHealth, 20000);
render();
