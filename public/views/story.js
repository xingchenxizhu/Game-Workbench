/** 剧情与 NPC：分支节点编辑、试玩、导入导出，可把结构交给聊天扩写。 */
import { h, toast, download, copyText } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { panel, split, btn, actionRow, textInput } from './kit.js';
const KEY = 'wb3.story.v1';
function sample() {
    const nodes = [
        { id: 'n1', title: '村口', text: '守林人拦住你：「天黑前别进北边的林子。」', choices: [
                { text: '我偏要去。', next: 'n2', condition: '' },
                { text: '问他为什么。', next: 'n3', condition: '' }
            ] },
        { id: 'n2', title: '北林', text: '雾气漫过脚踝，远处有两点绿光。', choices: [{ text: '后退', next: 'n1', condition: '' }] },
        { id: 'n3', title: '旧事', text: '他压低声音：「上个月，猎户丢了三个。」', choices: [{ text: '答应帮忙', next: 'n4', condition: '信任≥1' }] },
        { id: 'n4', title: '委托', text: '他塞给你一枚铜哨：「吹响它，我就来。」', choices: [] }
    ];
    return { start: 'n1', nodes };
}
function load() {
    try {
        return JSON.parse(localStorage.getItem(KEY) || '') || sample();
    }
    catch {
        return sample();
    }
}
function save(data) { localStorage.setItem(KEY, JSON.stringify(data)); }
export function mountStory(container) {
    let data = load();
    let currentId = data.start;
    let play = { at: data.start, history: [] };
    const list = h('div', { class: 'story-list' });
    const editor = h('div', { class: 'story-editor' });
    const player = h('div', { class: 'story-player' });
    function nodeById(id) { return data.nodes.find((node) => node.id === id); }
    function paintList() {
        list.replaceChildren();
        for (const node of data.nodes) {
            const row = h('button', {
                class: node.id === currentId ? 'story-node active' : 'story-node', type: 'button',
                onclick: () => { currentId = node.id; paint(); }
            }, h('strong', null, node.title || '未命名'), h('span', { class: 'muted small' }, `${node.id} · ${node.choices.length} 个分支`));
            list.append(row);
        }
        list.append(btn('＋ 新节点', { kind: 'quiet', onclick: () => {
                const id = `n${Date.now().toString(36)}`;
                data.nodes.push({ id, title: '新节点', text: '', choices: [] });
                currentId = id;
                save(data);
                paint();
            } }));
    }
    function paintEditor() {
        editor.replaceChildren();
        const node = nodeById(currentId);
        if (!node) {
            editor.append(h('p', { class: 'muted' }, '左侧选择一个节点'));
            return;
        }
        const title = textInput({ value: node.title, placeholder: '节点标题', onInput: (value) => { node.title = value; save(data); paintList(); } });
        const text = h('textarea', { class: 'textarea', rows: 6, placeholder: 'NPC 台词 / 旁白' });
        text.value = node.text || '';
        text.addEventListener('input', () => { node.text = text.value; save(data); });
        const choices = h('div', { class: 'choice-list' });
        node.choices.forEach((choice, index) => {
            const next = h('select', { class: 'select' }, h('option', { value: '' }, '结束'), ...data.nodes.filter((item) => item.id !== node.id).map((item) => h('option', { value: item.id, selected: item.id === choice.next }, `${item.title || item.id}`)));
            next.addEventListener('change', () => { choice.next = next.value; save(data); });
            const condition = textInput({ value: choice.condition || '', placeholder: '条件（可空）', onInput: (value) => { choice.condition = value; save(data); } });
            const line = h('div', { class: 'choice-row' }, textInput({ value: choice.text, placeholder: '选项文案', onInput: (value) => { choice.text = value; save(data); } }), next, condition, btn('×', { kind: 'danger-quiet', onclick: () => { node.choices.splice(index, 1); save(data); paint(); } }));
            choices.append(line);
        });
        const isStart = data.start === node.id;
        editor.append(h('div', { class: 'story-head' }, h('h3', null, isStart ? '起点节点' : '节点编辑'), isStart ? null : btn('设为起点', { kind: 'quiet', onclick: () => { data.start = node.id; save(data); paint(); } })), title, text, h('div', { class: 'story-sub' }, h('strong', null, '分支'), btn('＋ 选项', { kind: 'quiet', onclick: () => { node.choices.push({ text: '新选项', next: '', condition: '' }); save(data); paint(); } })), choices, actionRow(btn('删除节点', { kind: 'danger-quiet', onclick: () => {
                if (!confirm('删除这个节点？指向它的分支会变成结束。'))
                    return;
                data.nodes = data.nodes.filter((item) => item.id !== node.id);
                if (data.start === node.id)
                    data.start = data.nodes[0]?.id || '';
                for (const item of data.nodes)
                    for (const choice of item.choices)
                        if (choice.next === node.id)
                            choice.next = '';
                save(data);
                paint();
            } })));
    }
    function paintPlayer() {
        player.replaceChildren();
        const node = nodeById(play.at);
        if (!node) {
            player.append(h('p', { class: 'muted' }, '没有可试玩的节点'));
            return;
        }
        player.append(h('div', { class: 'story-scene' }, h('h4', null, node.title || '未命名'), h('p', null, node.text || '（空白台词）')), h('div', { class: 'story-choices' }, ...node.choices.map((choice) => h('button', {
            class: 'btn btn-quiet', type: 'button', disabled: !choice.next,
            onclick: () => { play.at = choice.next; play.history.push(node.id); paintPlayer(); }
        }, choice.text || '（未命名选项）', choice.condition ? h('span', { class: 'cond' }, ` [${choice.condition}]`) : null))), actionRow(btn('回到起点', { kind: 'primary', onclick: () => { play = { at: data.start, history: [] }; paintPlayer(); } }), btn('后退一步', { kind: 'quiet', disabled: !play.history.length, onclick: () => { play.at = play.history.pop() || data.start; paintPlayer(); } })));
    }
    function paint() {
        paintList();
        paintEditor();
        paintPlayer();
    }
    async function copyPrompt() {
        const prompt = buildPrompt(data);
        await copyText(prompt);
        try {
            await api.handoff(prompt);
        }
        catch { /* 无服务时只复制 */ }
        toast('剧情结构已复制，可以粘到聊天里扩写');
    }
    container.append(panel('剧情与 NPC', '节点 + 分支 + 条件；导出 JSON 可直接喂给对话式 AI 或游戏引擎。', actionRow(btn('复制扩写提示词', { kind: 'primary', onclick: copyPrompt }), btn('导出 JSON', { kind: 'quiet', onclick: () => { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); download(url, 'story.json'); setTimeout(() => URL.revokeObjectURL(url), 2000); } }), btn('导出 Markdown', { kind: 'quiet', onclick: () => { const url = URL.createObjectURL(new Blob([buildMarkdown(data)], { type: 'text/markdown' })); download(url, 'story.md'); setTimeout(() => URL.revokeObjectURL(url), 2000); } }), btn('导入 JSON', { kind: 'quiet', onclick: () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.onchange = async () => {
                const file = input.files?.[0];
                if (!file)
                    return;
                try {
                    const parsed = JSON.parse(await file.text());
                    if (!Array.isArray(parsed.nodes) || !parsed.start)
                        throw new Error('缺少 nodes / start');
                    data = parsed;
                    play = { at: data.start, history: [] };
                    save(data);
                    paint();
                    toast('已导入');
                }
                catch (error) {
                    toast(`导入失败：${error.message}`, 'error');
                }
            };
            input.click();
        } })), split(list, h('div', null, editor, h('hr', { class: 'divider' }), h('h3', null, '试玩'), player))));
    paint();
    return () => { };
}
function buildPrompt(data) {
    return [
        '# 剧情扩写任务', '',
        '你要扩写下面这份游戏剧情，保持节点 id 与分支结构，补全 NPC 台词、旁白与至少两条可选支线。',
        '要求：每个节点 2–5 句；选项要能体现角色差异；条件字段用「信任≥1」这类可判定表达式；不要改节点 id。', '',
        '```json', JSON.stringify(data, null, 2), '```'
    ].join('\n');
}
function buildMarkdown(data) {
    const lines = ['# 剧情脚本', `起点：${data.start}`, ''];
    for (const node of data.nodes) {
        lines.push(`## ${node.title || node.id}（${node.id}）`, '', node.text || '', '');
        if (node.choices.length)
            lines.push('分支：', ...node.choices.map((choice) => `- ${choice.text}${choice.condition ? `（条件：${choice.condition}）` : ''} → ${choice.next || '结束'}`), '');
    }
    return lines.join('\n');
}
