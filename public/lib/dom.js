/** 共用 DOM 工具：不引入框架，统一 TypeScript 界面接口。 */
export function h(tag, props = null, ...children) {
    const node = document.createElement(tag);
    if (props) {
        for (const [key, value] of Object.entries(props)) {
            if (value == null || value === false)
                continue;
            if (key === 'class')
                node.className = value;
            else if (key === 'dataset')
                Object.assign(node.dataset, value);
            else if (key === 'style' && typeof value === 'object')
                Object.assign(node.style, value);
            else if (key === 'html')
                node.innerHTML = value;
            else if (key.startsWith('on') && typeof value === 'function')
                node.addEventListener(key.slice(2).toLowerCase(), value);
            else if (key in node && key !== 'list')
                node[key] = value;
            else
                node.setAttribute(key, value === true ? '' : String(value));
        }
    }
    appendChildren(node, children);
    return node;
}
function appendChildren(node, children) {
    for (const child of children.flat(Infinity)) {
        if (child == null || child === false)
            continue;
        if (typeof child === 'object' && !(child instanceof Node))
            throw new TypeError('界面需要 DOM 节点：请传入控件的 node，而不是整个控件对象。');
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
}
export function frag(...children) {
    const fragment = document.createDocumentFragment();
    appendChildren(fragment, children);
    return fragment;
}
export function clear(node) {
    node.replaceChildren();
    return node;
}
export function qs(selector, root = document) {
    return root.querySelector(selector);
}
export function uid(prefix = 'id') {
    return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
/** 去掉文件扩展名，用于下载命名。 */
export function baseName(name = 'image') {
    return String(name).replace(/\.[^.]+$/, '') || 'image';
}
export function stamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
export function formatDate(iso) {
    if (!iso)
        return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return '—';
    const now = Date.now();
    const diff = now - date.getTime();
    if (diff < 60000)
        return '刚刚';
    if (diff < 3600000)
        return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000)
        return `${Math.floor(diff / 3600000)} 小时前`;
    return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function debounce(fn, wait = 180) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}
/** 统一的非阻塞提示，挂在 body 末尾。 */
export function toast(text, tone = 'info', timeout = 3600) {
    let host = document.querySelector('.toast-host');
    if (!host) {
        host = h('div', { class: 'toast-host', 'aria-live': 'polite' });
        document.body.append(host);
    }
    const item = h('div', { class: `toast toast-${tone}` }, text);
    host.append(item);
    requestAnimationFrame(() => item.classList.add('in'));
    setTimeout(() => {
        item.classList.remove('in');
        setTimeout(() => item.remove(), 240);
    }, timeout);
}
export async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    }
    catch {
        const area = h('textarea', { style: { position: 'fixed', opacity: '0' } });
        area.value = text;
        document.body.append(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
    }
}
export function download(href, filename) {
    const link = h('a', { href, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
}
export function emptyState(icon, title, text, action = null) {
    return h('div', { class: 'empty-state' }, h('span', { class: 'empty-icon' }, icon), h('h3', null, title), text ? h('p', null, text) : null, action || null);
}
export function field(label, control, hint) {
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
}
export function segmented(options, value, onChange) {
    const wrap = h('div', { class: 'segmented', role: 'group' });
    for (const option of options) {
        const button = h('button', {
            type: 'button',
            class: option.value === value ? 'seg on' : 'seg',
            onclick: () => {
                for (const child of wrap.children)
                    child.classList.toggle('on', child === button);
                onChange(option.value);
            }
        }, option.label);
        wrap.append(button);
    }
    return wrap;
}
