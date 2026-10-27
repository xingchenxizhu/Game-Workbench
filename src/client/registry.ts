/**
 * 工作台功能注册表 —— V3 的唯一数据源。
 *
 * 侧边导航、工作台首页、空间页、搜索面板、快捷键、面包屑、任务角标
 * 全部从这里读，新增功能只需要在这里加一条（或加一个流程定义）。
 *
 * 字段说明：
 *   kind: 'frame'  嵌入原有工具页面（modules/material、mapstitch 等）
 *         'native' 由 public/views/ 下的原生视图渲染
 *         'flow'   由 views/flow.js 按 FLOWS 定义渲染的 AI 流程
 *   stage: 空间内的分组标题（同一空间按出现顺序分组）
 *   origin: 复刻/参考来源，界面会展示成小标签
 */

export const SPACES = [
  {
    id: 'assets',
    title: '素材工坊',
    en: 'ASSET LAB',
    icon: '▧',
    accent: '#7c9cff',
    description: '从一句话到可用素材：生成、局部修整、放大、抠图、风格化与游戏 UI。',
    stageOrder: ['生成', '修整', '处理']
  },
  {
    id: 'characters',
    title: '角色动画',
    en: 'CHARACTER',
    icon: '♧',
    accent: '#c4a2ff',
    description: '八方向、序列帧、骨骼动画：同一条角色生产链，从设定图走到可导入引擎的动画。',
    stageOrder: ['生成', '装配', '导出']
  },
  {
    id: 'world',
    title: '世界场景',
    en: 'WORLD',
    icon: '▱',
    accent: '#5fd6a8',
    description: '地块、地图、横版关卡与大地图拼接：先做素材，再画场景，最后拼成完整世界。',
    stageOrder: ['绘制', '生成', '拼接']
  },
  {
    id: 'audio',
    title: '音频工作室',
    en: 'AUDIO',
    icon: '≋',
    accent: '#f0b46a',
    description: 'BGM、环境音与角色音效：一段旋律或一句描述，导出可用的音频文件。',
    stageOrder: ['生成', '编辑']
  },
  {
    id: 'design',
    title: '游戏设计',
    en: 'GAME DESIGN',
    icon: '✦',
    accent: '#f58fa8',
    description: '先把要做什么想清楚：策划文档、风格参考与提示词库，再接上素材生产。',
    stageOrder: ['规划', '参考']
  }
];

const material = (tool) => `material.html?tool=${tool}&embedded=1`;

export const TOOLS = [
  // ── 素材工坊 ──────────────────────────────────────────────
  {
    id:'asset-pack',space:'assets',stage:'生成',title:'成套素材',
    summary:'角色、道具、武器、UI 与地块模板；保存工作区制作配方，统一风格、创建任务并打包结果。',
    icon:'▣',kind:'native',view:'asset-pack',tags:['模板','制作配方','像素','高清','素材包','批量'],origin:'Meowa · 模板素材流程',badge:'AI 任务'
  },
  {
    id: 'image', space: 'assets', stage: '生成', title: '图片制作',
    summary: '提示词、参考图、尺寸与透明背景，一次生成多张，并接回填流程。',
    icon: '▧', kind: 'frame', url: material('image'),
    tags: ['文生图', '图生图', '参考图', '透明背景'], origin: '工作台原生', badge: 'AI'
  },
  {
    id: 'ui', space: 'assets', stage: '生成', title: '游戏 UI 套件',
    summary: 'HUD、菜单、按钮、图标与背包界面，按风格一次出一整套 UI 参考。',
    icon: '▤', kind: 'flow', flow: 'ui',
    tags: ['HUD', '菜单', '按钮', '图标'], origin: 'Meowa · Game UI', badge: 'AI'
  },
  {
    id: 'inpaint', space: 'assets', stage: '修整', title: '局部重绘',
    summary: '在图上刷出蒙版，按描述只改这一块：修手、换配色、去杂物、补细节。',
    icon: '◐', kind: 'flow', flow: 'inpaint',
    tags: ['局部细化', '擦除', '替换', '蒙版'], origin: 'Holopix · 局部细化', badge: 'AI'
  },
  {
    id: 'render', space: 'assets', stage: '修整', title: '风格渲染',
    summary: '把线稿、白模或照片渲染成指定画风和材质，保留原构图。',
    icon: '◈', kind: 'flow', flow: 'render',
    tags: ['万能渲染', '风格转换', '材质', '光影'], origin: 'Holopix · 万能渲染', badge: 'AI'
  },
  {
    id: 'view', space: 'assets', stage: '修整', title: '自由视角',
    summary: '给一张角色或场景图，换机位：正侧背、俯仰、45° 斜角都能补。',
    icon: '◎', kind: 'flow', flow: 'view',
    tags: ['3D 转视角', '机位', '多视图'], origin: 'Holopix · 自由视角', badge: 'AI'
  },
  {
    id: 'split', space: 'assets', stage: '修整', title: '智能拆分',
    summary: '把整张角色图拆成可编辑的部件总览，直接喂给骨骼动画做装配。',
    icon: '⧉', kind: 'flow', flow: 'split',
    tags: ['部件总览', '拆件', '骨骼前置'], origin: 'Holopix · 智能拆分', badge: 'AI'
  },
  {
    id:'layers',space:'assets',stage:'修整',title:'图层画布',
    summary:'拖动图层、调整层级、旋转与透明度；撤销重做，保存工程、合成 PNG、分层 PSD 与 ZIP。',
    icon:'▱',kind:'native',view:'layers',tags:['画布','图层','合成','工程','PSD'],origin:'Holopix / FrameRonin · 画布流程',badge:'本地'
  },
  {
    id: 'matte', space: 'assets', stage: '处理', title: '抠图去背',
    summary: '纯色/绿幕一键去背，容差、软边、收缩与自动裁边，导出透明 PNG。',
    icon: '◑', kind: 'native', view: 'matte',
    tags: ['去背', '透明 PNG', '批量'], origin: 'Holopix · 一键抠图', badge: '本地'
  },
  {
    id: 'upscale', space: 'assets', stage: '处理', title: '超清放大',
    summary: '像素图用最近邻放大不发虚，插画可走 AI 重绘式放大补细节。',
    icon: '⤢', kind: 'native', view: 'upscale',
    tags: ['4K', '像素完美', '重绘放大'], origin: 'Holopix · 超清放大', badge: '本地 + AI'
  },
  {
    id: 'adjust', space: 'assets', stage: '处理', title: '图片调整',
    summary: '亮度、对比、饱和、色阶与颜色量化，顺带网格对齐和尺寸规整。',
    icon: '☼', kind: 'native', view: 'adjust',
    tags: ['调色', '量化', '网格对齐', '完美像素'], origin: 'Frameronin · 单图调整 Pro', badge: '本地'
  },
  {
    id: 'video', space: 'assets', stage: '处理', title: '视频工具',
    summary: '抽帧成序列图、按秒裁剪、多个片段拼接，全部在本机 ffmpeg 完成。',
    icon: '▶', kind: 'native', view: 'video',
    tags: ['抽帧', '裁剪', '拼接', '转码'], origin: 'Frameronin · 视频编辑器', badge: '本地'
  },
  {
    id: 'pixel', space: 'assets', stage: '处理', title: '像素净化',
    summary: '检测真像素网格、量化调色板、Bayer 抖动与描边，导出可用的像素图。',
    icon: '▦', kind: 'native', view: 'pixel',
    tags: ['像素画', '调色板', '量化', '抖动'], origin: 'AIPixel + dsh-gpt-image', badge: '本地'
  },

  // ── 角色动画 ──────────────────────────────────────────────
  {
    id: 'sprite', space: 'characters', stage: '生成', title: '八方向角色',
    summary: '一张设定图生成中心原图 + 八方向九宫格，可补齐缺失的 45° 斜角。',
    icon: '✥', kind: 'frame', url: material('sprite'),
    tags: ['八方向', '九宫格', '斜角补齐'], origin: 'Frameronin · 完美八方向', badge: 'AI'
  },
  {
    id: 'sequence', space: 'characters', stage: '生成', title: '序列帧动画',
    summary: '图像或视频 → 抽帧 → 抠像 → 合成，输出序列图、GIF 或视频。',
    icon: '▤', kind: 'frame', url: material('sequence'),
    tags: ['抽帧', '序列图', 'GIF'], origin: 'Frameronin · 像素动画', badge: 'AI'
  },
  {
    id: 'rig', space: 'characters', stage: '装配', title: '骨骼动画',
    summary: '部件拆分 → 自动装配 → 骨骼动作 → Spine 图集与工程下载。',
    icon: '⚉', kind: 'frame', url: material('rig'),
    tags: ['Spine', '骨骼', '图集', '装配'], origin: 'Frameronin · 骨骼动画', badge: 'AI'
  },
  {
    id:'sprites',space:'characters',stage:'导出',title:'精灵图集整理',
    summary:'拆图集、分组动作、倒序/往返/翻转，导出逐动作 GIF、PNG/JSON/ZIP 与 RPG Maker 角色表。',
    icon:'▦',kind:'native',view:'sprites',tags:['Sprite Sheet','拆分','帧排序','对齐','GIF','RPG Maker','动作分组','翻转'],origin:'FrameRonin · Sprite Sheet',badge:'本地'
  },
  {
    id: 'poses', space: 'characters', stage: '导出', title: '动作与镜头库',
    summary: '常用动作、机位与提示词模板，复制即可用在角色流程里。',
    icon: '⌘', kind: 'native', view: 'library', presetGroup: 'action',
    tags: ['动作模板', '镜头', '提示词'], origin: 'Frameronin · 提示词库', badge: '本地'
  },

  // ── 世界场景 ──────────────────────────────────────────────
  {
    id: 'tile', space: 'world', stage: '绘制', title: '等距地块',
    summary: '45° 地块生成、规整、铺图与打包，输出可用的地块集。',
    icon: '◪', kind: 'frame', url: material('tile'),
    tags: ['等距', '45°', '地块集'], origin: 'Frameronin · 地形', badge: 'AI'
  },
  {
    id: 'map', space: 'world', stage: '生成', title: '地图编辑器',
    summary: '导入地块、自动连接、图层绘制、撤销重做与整图导出。',
    icon: '▦', kind: 'frame', url: material('map'),
    tags: ['地图', '绘制', '导出'], origin: '工作台原生', badge: '本地'
  },
  {
    id: 'stitch', space: 'world', stage: '拼接', title: '大地图拼接',
    summary: '重叠拼接、分层、扩图任务队列与状态恢复，导出 PNG / PSD / Godot / Unity 地图包。',
    icon: '⊞', kind: 'native', view: 'stitch',
    tags: ['拼接', '扩图', '分块', '大图', 'Godot', 'Unity'], origin: 'MapStitch / FrameRonin', badge: '本地 + AI 任务'
  },
  {
    id: 'sidescroll', space: 'world', stage: '拼接', title: '横版关卡',
    summary: '2D 横轴地图程序化生成、水平拼接、瓦片图集与碰撞/生成点提取。',
    icon: '≋', kind: 'native', view: 'sidescroll',
    tags: ['横版', '关卡生成', '瓦片图集', '碰撞层', '生成点'], origin: '工作台原生', badge: '本地'
  },

  // ── 音频 ─────────────────────────────────────────────────
  {
    id: 'music', space: 'audio', stage: '生成', title: '音乐工作室',
    summary: '灵感、歌词、谱曲、裁剪与导出，做主题曲和循环 BGM。',
    icon: '≋', kind: 'frame', url: material('music'),
    tags: ['BGM', '作曲', '歌词'], origin: '工作台原生', badge: 'AI'
  },
  {
    id: 'sfx', space: 'audio', stage: '编辑', title: '音效制作',
    summary: '环境音、交互音与角色配音，可多次生成后挑选。',
    icon: '◉', kind: 'frame', url: material('sfx'),
    tags: ['音效', '环境音', '配音'], origin: '工作台原生', badge: 'AI'
  },

  // ── 游戏设计 ──────────────────────────────────────────────
  {
    id: 'gdd', space: 'design', stage: '规划', title: '策划 Agent',
    summary: '填几个关键选择，生成结构完整的策划文档，可直接导出 Markdown。',
    icon: '✎', kind: 'native', view: 'gdd',
    tags: ['玩法', '系统', '文档', 'GDD'], origin: 'Meowa · Game Design Agent', badge: '本地'
  },
  {
    id: 'story', space: 'design', stage: '规划', title: '剧情与 NPC',
    summary: '节点 + 分支 + 条件，试玩后导出 JSON / Markdown，也能把结构交给聊天扩写。',
    icon: '⧉', kind: 'native', view: 'story',
    tags: ['分支剧情', 'NPC', '对话', '任务'], origin: 'ludo-npc-ai', badge: '本地'
  },
  {
    id: 'library', space: 'design', stage: '参考', title: '模板与灵感',
    summary: '画风、机位、UI、动作四组提示词预设，复制即用，也能带进流程。',
    icon: '❖', kind: 'native', view: 'library',
    tags: ['预设', '风格', '提示词'], origin: 'Holopix · 作品灵感', badge: '本地'
  }
];

export const SPECIAL = {
  id: 'settings', space: null, title: '模型与设置', icon: '⚙',
  summary: '管理工作区、素材保存位置、生成后端与 API Key、行为与数据。',
  kind: 'native', view: 'settings', url: 'material.html?settings=1&embedded=1'
};

/** 首页展示的四条生产链。步骤里的 id 必须能在 TOOLS 中找到。 */
export const PIPELINES = [
  {
    id: 'character-pack', title: '角色资产包', icon: '♧', accent: '#c4a2ff',
    summary: '从一个想法到能导入引擎的角色：设定、去背、八方向、动画与骨骼。',
    steps: ['image', 'matte', 'sprite', 'sequence', 'rig']
  },
  {
    id: 'world-pack', title: '场景与地块', icon: '▱', accent: '#5fd6a8',
    summary: '先定风格，再做地块，最后画成地图并切块导出。',
    steps: ['render', 'tile', 'map', 'sidescroll', 'stitch']
  },
  {
    id: 'ui-kit', title: '游戏 UI 套件', icon: '▤', accent: '#7c9cff',
    summary: '一整套 HUD 与菜单，统一风格后逐张调整导出。',
    steps: ['gdd', 'ui', 'adjust', 'matte']
  },
  {
    id: 'audio-pack', title: '音频包', icon: '≋', accent: '#f0b46a',
    summary: '主题曲与音效一起做，按场景命名后打包。',
    steps: ['library', 'music', 'sfx']
  }
];

/**
 * 提示词预设库。group 对应库的筛选：
 *   style 画风 / camera 机位 / ui 界面 / action 动作
 * prompt 里可以用 {subject} 占位，复制到聊天或流程里时替换。
 */
export const PRESETS = [
  { group: 'style', title: '像素 · 16 色', accent: '#7c9cff',
    prompt: '像素艺术，16 色调色板，硬边无抗锯齿，正面光，1px 深色描边，干净透明背景，{subject}，游戏素材，居中构图' },
  { group: 'style', title: '二次元 · 立绘', accent: '#c4a2ff',
    prompt: '日系二次元角色立绘，赛璐璐上色，清晰线稿，柔和轮廓光，浅色渐变背景，全身构图，{subject}' },
  { group: 'style', title: '手绘 · 厚涂', accent: '#f0b46a',
    prompt: '厚涂手绘风格，明显笔触，暖色主光与冷色环境光，轻微颗粒质感，{subject}，游戏概念设定' },
  { group: 'style', title: '低多边形 · 3D', accent: '#5fd6a8',
    prompt: 'low-poly 3D 风格，平面着色，清晰几何面，柔和阴影，纯色背景，等距视角，{subject}，游戏资产' },
  { group: 'style', title: '写实 · 材质', accent: '#f58fa8',
    prompt: '写实游戏美术，PBR 材质，金属与布料细节，三点布光，景深，{subject}' },
  { group: 'style', title: '国风 · 水墨', accent: '#8fbf8f',
    prompt: '中国水墨风格，宣纸质感，留白构图，墨色浓淡层次，少量朱红点缀，{subject}' },

  { group: 'camera', title: '正面机位', accent: '#7c9cff',
    prompt: '正面视角，镜头与角色等高，平视，角色居中，全身完整入画，{subject}' },
  { group: 'camera', title: '45° 斜前', accent: '#c4a2ff',
    prompt: '45 度斜前方视角，略微俯视，角色居中，游戏角色展示图，{subject}' },
  { group: 'camera', title: '正侧机位', accent: '#5fd6a8',
    prompt: '正侧面视角，平视，角色完整入画，轮廓清晰，{subject}' },
  { group: 'camera', title: '背面机位', accent: '#f0b46a',
    prompt: '背面视角，平视，完整展示背部装备与披风，{subject}' },
  { group: 'camera', title: '俯视 · 等距', accent: '#f58fa8',
    prompt: '等距俯视视角，45 度俯角，正交投影，无透视变形，{subject}' },
  { group: 'camera', title: '低角度 hero', accent: '#8fbf8f',
    prompt: '低角度仰视，广角镜头，角色占据画面主体，背景虚化，英雄感构图，{subject}' },

  { group: 'ui', title: '奇幻 HUD', accent: '#c4a2ff',
    prompt: '奇幻 RPG 游戏 HUD 界面设计，木质与黄铜材质，生命值/魔力值/技能栏，暗色半透明底，1440x900，{subject}' },
  { group: 'ui', title: '科幻面板', accent: '#7c9cff',
    prompt: '科幻游戏 UI 面板，深色玻璃与青色发光边线，数据图表与按钮，扁平图标，{subject}' },
  { group: 'ui', title: '像素背包', accent: '#5fd6a8',
    prompt: '像素风背包与物品格 UI，16x16 图标网格，木框与羊皮纸底，{subject}' },
  { group: 'ui', title: '主菜单', accent: '#f0b46a',
    prompt: '游戏主菜单界面设计，标题、开始/设置/退出按钮，氛围背景，竖版构图，{subject}' },
  { group: 'ui', title: '技能图标组', accent: '#f58fa8',
    prompt: '六枚游戏技能图标，统一风格，透明背景，方形构图，圆形徽章底座，{subject}' },

  { group: 'action', title: '待机呼吸', accent: '#7c9cff',
    prompt: '待机呼吸动作，2 秒循环，身体轻微起伏，武器自然下垂，镜头固定，角色居中，{subject}' },
  { group: 'action', title: '四向行走', accent: '#5fd6a8',
    prompt: '四方向行走循环，每方向 4 帧，宫格排布：下/左/右/上，像素风，角色居中，{subject}' },
  { group: 'action', title: '挥剑攻击', accent: '#f58fa8',
    prompt: '挥剑攻击动作，6 帧序列，蓄力到斩击到收势，动作清晰，固定镜头，{subject}' },
  { group: 'action', title: '受击硬直', accent: '#f0b46a',
    prompt: '受击动作，3 帧，后仰与回正，轻微位移，固定镜头，{subject}' },
  { group: 'action', title: '自转八向', accent: '#c4a2ff',
    prompt: '角色原地自转，每 45° 一帧，共八帧，镜头固定，光照一致，{subject}' }
];

const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.id, tool]));

export function getTool(id: string): any {
  if (id === SPECIAL.id) return SPECIAL;
  return TOOL_MAP.get(id) || null;
}

export function toolsOf(spaceId: string): any[] {
  return TOOLS.filter((tool) => tool.space === spaceId);
}

export function getSpace(id: string): any {
  return SPACES.find((space) => space.id === id) || null;
}

export function spaceOf(tool: any): any {
  return tool?.space ? getSpace(tool.space) : null;
}

/** 按空间阶段分组，保持空间定义的顺序。 */
export function groupByStage(tools) {
  const groups = new Map();
  for (const tool of tools) {
    if (!groups.has(tool.stage)) groups.set(tool.stage, []);
    groups.get(tool.stage).push(tool);
  }
  return [...groups.entries()].map(([stage, items]) => ({ stage, items }));
}

export function presetsOf(group: string): any[] {
  return PRESETS.filter((preset) => preset.group === group);
}

/** 共用的轻量搜索：标题、摘要、标签、空间名。 */
export function searchTools(query: string): any[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  return TOOLS
    .map((tool) => {
      const space = spaceOf(tool);
      const haystack = `${tool.title} ${tool.summary} ${tool.tags.join(' ')} ${space?.title || ''} ${tool.origin}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { tool, score, exact: tool.title.toLowerCase().includes(q) ? 2 : 0 };
    })
    .filter((row) => row.score === terms.length)
    .sort((a, b) => b.exact - a.exact || b.score - a.score || a.tool.title.localeCompare(b.tool.title, 'zh'))
    .map((row) => row.tool);
}

