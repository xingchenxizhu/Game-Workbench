/** 模板与灵感：画风、机位、UI、动作四组提示词预设。 */
import { h, toast, copyText } from '../lib/dom.js';
import { PRESETS } from '../registry.js';
import { panel, btn, actionRow } from './kit.js';

const GROUPS = [
  { id: 'all', label: '全部' },
  { id: 'style', label: '画风' },
  { id: 'camera', label: '机位' },
  { id: 'ui', label: '界面' },
  { id: 'action', label: '动作' }
];

const TARGET = {
  style: { id: 'image', label: '去图片制作' },
  camera: { id: 'view', label: '去自由视角' },
  ui: { id: 'ui', label: '去 UI 套件' },
  action: { id: 'sequence', label: '去序列帧' }
};

export function mountLibrary(container: any, { navigate, tool }: any = {}) {
  let group = tool?.presetGroup || 'all';
  let subject = '';
  const grid = h('div', { class: 'preset-grid' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': '预设分组' });
  for (const item of GROUPS) {
    chips.append(h('button', { type: 'button', class: 'chip', dataset: { group: item.id }, onclick: () => { group = item.id; paint(); } }, item.label));
  }
  const subjectInput = h('input', { type: 'text', placeholder: '例如：银发、蓝色披风的骑士（会替换 {subject}）', oninput: (event) => { subject = event.target.value.trim(); } });

  function resolve(preset) {
    return preset.prompt.replace(/\{subject\}/g, subject || '一个游戏角色');
  }

  function paint() {
    for (const chip of chips.children) chip.classList.toggle('on', chip.dataset.group === group);
    grid.replaceChildren();
    const list = PRESETS.filter((preset) => group === 'all' || preset.group === group);
    for (const preset of list) {
      const target = TARGET[preset.group];
      grid.append(h('article', { class: 'preset-card', style: { '--accent': preset.accent } },
        h('div', { class: 'preset-top' },
          h('span', { class: 'preset-tag' }, GROUPS.find((item) => item.id === preset.group)?.label || preset.group),
          h('h3', null, preset.title)
        ),
        h('p', { class: 'preset-prompt' }, resolve(preset)),
        actionRow(
          btn('复制提示词', { kind: 'quiet', onclick: async () => { await copyText(resolve(preset)); toast('提示词已复制'); } }),
          h('a', { class: 'btn btn-small', href: `#/tool/${target.id}` }, target.label)
        )
      ));
    }
  }

  container.append(h('header', { class: 'page-head' },
    h('p', { class: 'eyebrow' }, 'PRESET LIBRARY'),
    h('h1', null, '模板与灵感'),
    h('p', { class: 'page-sub' }, '把常用画风、机位、界面和动作固化成提示词。填好主体后复制，直接粘到图片制作或流程里。')
  ), panel('我的主体', '会替换预设里的 {subject} 占位。', subjectInput), h('div', { class: 'chips-row' }, chips), grid);

  paint();
  return () => {};
}
