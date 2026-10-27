/** 策划 Agent：用结构化模板生成策划文档，可导出 Markdown 或交给聊天扩写。 */
import { h, toast, copyText, download } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { panel, split, btn, actionRow, textInput, textArea, select, badge } from './kit.js';

const GENRES = {
  roguelike: {
    label: 'Roguelike / 肉鸽',
    loop: '进入关卡 → 战斗清怪 → 拾取词条与装备形成构筑 → 结算资源 → 死亡或通关 → 用资源解锁新角色与关卡',
    systems: ['随机房间与地图生成', '近战 / 远程战斗与命中判定', '词条与遗物构筑', '商店与资源循环', '精英怪与 Boss 阶段'],
    depth: ['每局 15–25 分钟', '构筑组合至少 30 种有效流派', '首月上线 3 个角色、4 个区域'],
    risks: ['数值成长过快导致后期无挑战', '随机性过高让玩家觉得不公平']
  },
  platformer: {
    label: '平台跳跃',
    loop: '进入关卡 → 跑跳与战斗 → 收集与解谜 → 通过检查点 → 结算评分 → 解锁下一关',
    systems: ['移动手感（加速度、土狼时间、跳跃缓冲）', '关卡机关与陷阱', '收集物与评分', '能力解锁与回溯', 'Boss 战'],
    depth: ['单关 2–4 分钟', '能力 3–5 个，每个改变路线', '首月 12 个关卡'],
    risks: ['手感调不好导致操作挫败', '关卡难度曲线断层']
  },
  rpg: {
    label: '角色扮演',
    loop: '探索地图 → 遭遇战斗 → 获取经验与装备 → 解锁技能 → 推进剧情 → 挑战区域 Boss',
    systems: ['回合制或即时战斗', '技能树与职业', '装备与掉落', '任务与对话', '地图与传送'],
    depth: ['主线 8–12 小时', '支线 20+', '首月 1 个区域、6 名可玩角色'],
    risks: ['内容量估算不足', '战斗重复感强']
  },
  towerDefense: {
    label: '塔防',
    loop: '观察路线 → 布置与升级防御塔 → 抵挡波次 → 结算星级 → 解锁新塔与地图',
    systems: ['路径与寻路', '防御塔类型与升级', '敌人波次与词缀', '资源与利息', 'Boss 波'],
    depth: ['单局 12–18 分钟', '8 种塔、6 张地图', '首月 30 关'],
    risks: ['最优解单一导致策略枯竭', '后期波次数值膨胀']
  },
  sim: {
    label: '模拟经营',
    loop: '规划布局 → 生产与交易 → 满足居民需求 → 扩张 → 应对事件',
    systems: ['资源生产链', '建造与布局', '居民需求与满意度', '经济与价格', '随机事件'],
    depth: ['单局 30 分钟以上', '20+ 建筑', '首月 1 张地图、3 个阶段'],
    risks: ['前期节奏过慢', '后期变成挂机']
  },
  shooter: {
    label: '射击',
    loop: '进入战场 → 走位与射击 → 拾取弹药与增益 → 完成目标 → 结算 → 解锁武器',
    systems: ['武器与后坐力', '敌人 AI 与掩体', '目标与波次', '增益与改装', '关卡节奏'],
    depth: ['单局 10–15 分钟', '6 把武器、3 类敌人', '首月 5 张地图'],
    risks: ['手感与命中反馈不到位', '内容消耗过快']
  },
  puzzle: {
    label: '解谜',
    loop: '观察场景 → 理解机制 → 尝试组合 → 解开机关 → 进入下一组',
    systems: ['核心机制与规则', '关卡编辑器式设计', '提示系统', '收集与叙事碎片', '难度递进'],
    depth: ['单关 3–8 分钟', '6 组机制、40 关', '首月 20 关'],
    risks: ['提示过强失去解谜乐趣', '机制之间缺少组合']
  }
};

const ART = {
  pixel: { label: '像素', note: '16–32 色，硬边，1px 描边，网格对齐', assets: '像素角色、像素地块、像素 UI' },
  flat: { label: '2D 手绘', note: '清晰线稿、赛璐璐上色、柔和光影', assets: '角色立绘、场景插画、UI 图标' },
  lowpoly: { label: '3D 低多边形', note: '平面着色、几何明确、低面数', assets: '低模角色、道具、地形块' },
  pbr: { label: '3D 写实', note: 'PBR 材质、三点布光、景深', assets: '高模角色、环境资产、材质' },
  ink: { label: '国风水墨', note: '宣纸质感、留白、墨色层次', assets: '角色、场景、UI 纹样' }
};

const SCOPE = {
  small: { label: '小（1 人 / 1 个月）', characters: 2, enemies: 4, maps: 4, ui: 4, sfx: 12, music: 1 },
  medium: { label: '中（2–3 人 / 3 个月）', characters: 4, enemies: 8, maps: 8, ui: 8, sfx: 24, music: 3 },
  large: { label: '大（团队 / 6 个月）', characters: 8, enemies: 16, maps: 16, ui: 14, sfx: 48, music: 6 }
};

export function mountGdd(container: any) {
  const state = {
    name: '未命名项目',
    pitch: '一个能在 3 分钟内上手、每局都有新构筑的小体量游戏。',
    genre: 'roguelike',
    platform: 'PC',
    dimension: '2D 等距',
    art: 'pixel',
    scope: 'small',
    notes: ''
  };

  const preview = h('pre', { class: 'doc-preview' });
  const metaLine = h('p', { class: 'muted small' });

  function build() {
    const genre = GENRES[state.genre];
    const art = ART[state.art];
    const scope = SCOPE[state.scope];
    const lines = [
      `# ${state.name} · 策划文档`,
      '',
      `> ${state.pitch}`,
      '',
      `- 类型：${genre.label}`,
      `- 平台：${state.platform}`,
      `- 视角 / 维度：${state.dimension}`,
      `- 美术：${art.label}（${art.note}）`,
      `- 规模：${scope.label}`,
      '',
      '## 1. 项目概述',
      '',
      `${state.name} 是一款 ${genre.label}，面向 ${state.platform} 平台。目标是用最小可玩范围验证「${state.pitch}」是否成立。`,
      `美术方向为 ${art.label}，资产以 ${art.assets} 为主。`,
      '',
      '## 2. 核心循环',
      '',
      `1. ${genre.loop.split(' → ')[0]}`,
      ...genre.loop.split(' → ').slice(1).map((step, index) => `${index + 2}. ${step}`),
      '',
      '## 3. 核心系统',
      '',
      ...genre.systems.map((system, index) => `- **S${index + 1} ${system}**：先做最小可用版本，验证手感与节奏后再扩内容。`),
      '',
      '## 4. 内容规模（首版本）',
      '',
      `- 可玩角色：${scope.characters}`,
      `- 敌人 / 怪物：${scope.enemies}`,
      `- 关卡 / 地图：${scope.maps}`,
      `- UI 界面：${scope.ui} 个（HUD、主菜单、设置、结算）`,
      `- 音效：约 ${scope.sfx} 条；音乐：${scope.music} 首`,
      ...genre.depth.map((line) => `- ${line}`),
      '',
      '## 5. 美术与音频',
      '',
      `- 画风：${art.label}。${art.note}。`,
      '- 参考：统一收集 3–5 张同风格参考图，写进「模板与灵感」库里复用。',
      '- UI：所有界面共用一套边框、按钮和图标底座，先做 HUD 再扩菜单。',
      '- 音频：每个交互动作至少一条音效；BGM 做 1 首主题 + 1 首战斗循环。',
      '',
      '## 6. 资产清单',
      '',
      '| 资产 | 数量 | 做法 |',
      '| --- | --- | --- |',
      `| 角色设定与动作 | ${scope.characters} | 图片制作 → 抠图 → 八方向 → 序列帧 |`,
      `| 敌人 | ${scope.enemies} | 复用同一套骨架与动作 |`,
      `| 地块与地图 | ${scope.maps} | 等距地块 → 地图编辑器 → 拼接 |`,
      `| UI 套件 | ${scope.ui} | 游戏 UI 套件 → 图片调整 → 抠图 |`,
      `| 音效 / 音乐 | ${scope.sfx} / ${scope.music} | 音效制作 / 音乐工作室 |`,
      '',
      '## 7. 里程碑',
      '',
      '1. **原型（2 周）**：跑通核心循环，只做 1 个角色、1 个敌人、1 张地图。',
      '2. **垂直切片（1 个月）**：完整一局体验，包含 UI、音效和结算。',
      '3. **内容填充（2 个月）**：按资产清单补齐数量，做难度曲线。',
      '4. **打磨与发布**：手感、性能、可读性、教程。',
      '',
      '## 8. 风险',
      '',
      ...genre.risks.map((risk) => `- ${risk}`),
      '- 资产量估算偏乐观：先做「一个角色完整走完流程」再乘数量。',
      '- AI 生成结果需要人工校对，重要资产预留 30% 返工时间。',
      '',
      state.notes ? '## 9. 补充说明\n\n' + state.notes : ''
    ];
    return lines.filter((line) => line !== undefined).join('\n').replace(/\n{3,}/g, '\n\n');
  }

  function refresh() {
    preview.textContent = build();
    metaLine.textContent = `${state.name} · ${GENRES[state.genre].label} · ${ART[state.art].label} · ${SCOPE[state.scope].label}`;
  }

  const form = panel('项目信息', '填完自动生成文档，右侧可以导出或交给聊天扩写。',
    textInput({ label: '项目名', value: state.name, onInput: (value) => { state.name = value || '未命名项目'; refresh(); } }),
    textArea({ label: '一句话说明', value: state.pitch, rows: 2, onInput: (value) => { state.pitch = value; refresh(); } }),
    select({ label: '类型', value: state.genre, options: Object.entries(GENRES).map(([value, item]) => ({ value, label: item.label })), onChange: (value) => { state.genre = value; refresh(); } }),
    select({ label: '平台', value: state.platform, options: ['PC', '移动端', '主机', '网页'].map((value) => ({ value, label: value })), onChange: (value) => { state.platform = value; refresh(); } }),
    select({ label: '视角', value: state.dimension, options: ['2D 横版', '2D 俯视', '2D 等距', '2.5D', '3D 第三人称', '3D 第一人称'].map((value) => ({ value, label: value })), onChange: (value) => { state.dimension = value; refresh(); } }),
    select({ label: '美术风格', value: state.art, options: Object.entries(ART).map(([value, item]) => ({ value, label: item.label })), onChange: (value) => { state.art = value; refresh(); } }),
    select({ label: '开发规模', value: state.scope, options: Object.entries(SCOPE).map(([value, item]) => ({ value, label: item.label })), onChange: (value) => { state.scope = value; refresh(); } }),
    textArea({ label: '补充说明（可选）', rows: 3, placeholder: '例如：必须支持双人本地合作；不要抽卡…', onInput: (value) => { state.notes = value; refresh(); } }),
    actionRow(
      btn('下载 Markdown', { kind: 'primary', onclick: () => {
        const blob = new Blob([build()], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        download(url, `${state.name}.md`);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        toast('策划文档已下载');
      } }),
      btn('复制全文', { kind: 'quiet', onclick: async () => { await copyText(build()); toast('已复制策划文档'); } }),
      btn('交给聊天扩写', { kind: 'quiet', onclick: async () => {
        try {
          const result = await api.handoff(`请把这份策划文档扩写成更详细的开发文档，补全数值、关卡与美术需求：\n\n${build()}`);
          toast(`已保存交接文件：${result.file}`);
        } catch (error) { toast(error.message, 'error'); }
      } })
    )
  );

  const previewPanel = panel('文档预览', '生成结果是本地 Markdown，不会自动调用模型。',
    h('div', { class: 'doc-meta' }, badge('Markdown', 'tone'), metaLine),
    preview
  );

  container.append(split(form, previewPanel));
  refresh();
  return () => {};
}
