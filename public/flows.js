/**
 * AI 流程定义（V3）。
 *
 * 每个流程都是「参考图 + 选项 → 提示词 → 生图任务」的同一条链路，
 * 差异全部写在数据里。新增一个流程只要往 FLOWS 里加一项，
 * 工作台会自动生成页面、搜索项和任务归属。
 *
 * build(values) 只返回纯数据，方便在 node 里做单元测试。
 */
const SIZE_LABEL = {
    '1024x1024': '1024×1024（方形）',
    '1344x768': '1344×768（横向）',
    '768x1344': '768×1344（竖向）',
    '1536x1024': '1536×1024（宽幅）'
};
const COMMON = {
    size: { id: 'size', type: 'select', label: '输出尺寸', value: '1024x1024', options: Object.entries(SIZE_LABEL).map(([value, label]) => ({ value, label })) },
    transparent: { id: 'transparent', type: 'toggle', label: '透明背景', hint: '需要真实 alpha，方便直接进游戏' },
    extra: { id: 'extra', type: 'textarea', label: '补充要求', placeholder: '例如：不要文字、保持 1px 深色描边、武器在右手…', rows: 2 }
};
export const FLOWS = {
    inpaint: {
        id: 'inpaint', tool: 'inpaint', title: '局部重绘', icon: '◐', accent: '#7c9cff',
        summary: '在图上刷出要改的区域，写清楚改什么，其余部分保持不动。',
        source: 'Holopix · 局部细化 / 局部替换&擦除',
        guide: [
            '上传原图，用画笔把要修改的区域涂出来（白色区域 = 要改）。',
            '写清楚这块区域要变成什么样，比如「把剑换成发光的符文剑」。',
            '提交后任务进入任务中心：复制交接指令给当前聊天生成，再把结果回填回来。'
        ],
        inputs: [
            { id: 'base', type: 'image', label: '原图', required: true, hint: '要修改的整张图' },
            { id: 'mask', type: 'mask', label: '蒙版', required: true, from: 'base', hint: '在图上涂抹要重绘的区域' }
        ],
        fields: [
            { id: 'instruction', type: 'textarea', label: '这块区域改成什么', required: true, rows: 3, placeholder: '例如：把手中的木剑换成发蓝光的符文剑，剑身有裂纹，保持右手握持姿势' },
            { id: 'strength', type: 'select', label: '改动幅度', value: 'balanced', options: [{ value: 'light', label: '轻微（保留原结构）' }, { value: 'balanced', label: '适中（默认）' }, { value: 'strong', label: '大幅（可改结构）' }] },
            COMMON.size, COMMON.transparent, COMMON.extra
        ],
        build(values) {
            const strength = { light: '轻微改动，尽量保留原区域的结构和笔触', balanced: '适度改动，保持原画风', strong: '可以较大幅度重画该区域的结构' }[values.strength || 'balanced'];
            return {
                prompt: [
                    '局部重绘任务。',
                    '参考图 1 是原图，参考图 2 是蒙版：白色/亮色区域代表需要修改，黑色区域必须保持原样。',
                    `修改内容：${values.instruction}`,
                    `改动幅度：${strength}。`,
                    '硬性要求：蒙版之外的所有像素与风格保持不变（构图、线条、光照方向、透视、比例、材质一致）；修改区域要和周围自然衔接，不能出现明显的方形边界或色差；不要添加文字、水印、边框、签名。',
                    values.transparent ? '输出透明背景 PNG，保留真实 alpha。' : '保留原图背景。',
                    values.extra ? `补充：${values.extra}` : '',
                    `输出尺寸：${values.size || '1024x1024'}。`
                ].filter(Boolean).join('\n'),
                size: values.size || '1024x1024',
                transparent: !!values.transparent,
                references: ['base', 'mask']
            };
        }
    },
    view: {
        id: 'view', tool: 'view', title: '自由视角', icon: '◎', accent: '#8fb3ff',
        summary: '同一角色或场景，换一台摄像机：正侧背、45° 斜角、俯仰都能补。',
        source: 'Holopix · 自由视角 / 3D 转视角',
        guide: [
            '上传角色或场景图，选择目标机位。',
            '如果只补缺失的方向，打开「只补缺失视角」，模型不会重画已有角度。',
            '结果可以直接接着做八方向九宫格或骨骼装配。'
        ],
        inputs: [{ id: 'base', type: 'image', label: '原始画面', required: true, hint: '角色立绘、三视图、场景截图都可以' }],
        fields: [
            { id: 'subject', type: 'select', label: '对象', value: 'character', options: [{ value: 'character', label: '角色' }, { value: 'creature', label: '生物 / 怪物' }, { value: 'prop', label: '道具 / 武器' }, { value: 'scene', label: '场景' }] },
            { id: 'azimuth', type: 'select', label: '水平机位', value: 'front', options: [
                    { value: 'front', label: '正面' }, { value: 'frontLeft45', label: '左前 45°' }, { value: 'left', label: '正侧面（左）' },
                    { value: 'backLeft45', label: '左后 45°' }, { value: 'back', label: '背面' }, { value: 'backRight45', label: '右后 45°' },
                    { value: 'right', label: '正侧面（右）' }, { value: 'frontRight45', label: '右前 45°' }, { value: 'topDown', label: '俯视（等距）' }
                ] },
            { id: 'pitch', type: 'range', label: '俯仰角', min: -45, max: 60, step: 5, value: 0, suffix: '°', hint: '负数为仰视，正数为俯视' },
            { id: 'focal', type: 'select', label: '镜头', value: 'normal', options: [{ value: 'normal', label: '标准 50mm' }, { value: 'wide', label: '广角 24mm（有透视）' }, { value: 'tele', label: '长焦 85mm（压平）' }, { value: 'ortho', label: '正交投影（无透视）' }] },
            { id: 'keep', type: 'toggle', label: '严格保持设计', hint: '发型、服装、配色、纹样、武器都不许变' }
        ],
        build(values) {
            const azimuth = {
                front: '正面（0°）', frontLeft45: '左前方 45°', left: '正侧面（左侧 90°）', backLeft45: '左后方 135°',
                back: '背面（180°）', backRight45: '右后方 225°', right: '正侧面（右侧 270°）', frontRight45: '右前方 315°', topDown: '正俯视（等距 45° 俯角）'
            }[values.azimuth || 'front'];
            const focal = { normal: '标准 50mm 镜头，接近人眼透视', wide: '广角 24mm，轻微透视夸张', tele: '长焦 85mm，透视压缩', ortho: '正交投影，无透视变形' }[values.focal || 'normal'];
            const subject = { character: '角色', creature: '生物', prop: '道具', scene: '场景' }[values.subject || 'character'];
            return {
                prompt: [
                    `视角转换任务：把参考图 1 中的${subject}转到新的机位。`,
                    `新机位：${azimuth}，俯仰角 ${values.pitch || 0}°，${focal}。`,
                    '必须保持对象本身完全一致：轮廓、比例、发型、服装、配色、纹样、装备位置、材质与光源方向都与原图一致，只改变观察角度。',
                    values.keep ? '严格模式：不得重新设计任何细节，不得增删配饰。' : '允许为了让新角度自然而补充被遮挡的细节，但不能改变设计。',
                    '背景保持简洁或沿用原图背景风格；不要文字、水印、边框。',
                    values.transparent ? '输出透明背景 PNG，保留真实 alpha。' : '',
                    `输出尺寸：${values.size || '1024x1024'}。`
                ].filter(Boolean).join('\n'),
                size: values.size || '1024x1024',
                transparent: !!values.transparent,
                references: ['base']
            };
        }
    },
    render: {
        id: 'render', tool: 'render', title: '风格渲染', icon: '◈', accent: '#f0b46a',
        summary: '线稿、白模、照片或草稿，指定画风与材质后统一渲染，构图不变。',
        source: 'Holopix · 万能渲染 / 风格转换',
        guide: [
            '上传原图（线稿、灰模、照片或低完成度草图）。',
            '选画风、材质和光照；需要统一项目风格时把这个流程当作「渲染器」。',
            '同一张图换风格时，保持尺寸和构图一致，方便后期叠图对比。'
        ],
        inputs: [{ id: 'base', type: 'image', label: '原始画面', required: true, hint: '线稿 / 灰模 / 草图 / 照片' }],
        fields: [
            { id: 'style', type: 'select', label: '画风', value: 'pixel', options: [
                    { value: 'pixel', label: '像素 · 16 色' }, { value: 'anime', label: '二次元 · 赛璐璐' }, { value: 'paint', label: '手绘 · 厚涂' },
                    { value: 'lowpoly', label: '低多边形 3D' }, { value: 'pbr', label: '写实 PBR' }, { value: 'ink', label: '国风 · 水墨' }, { value: 'cyber', label: '赛博朋克' }
                ] },
            { id: 'material', type: 'select', label: '主体材质', value: 'auto', options: [
                    { value: 'auto', label: '跟随画风' }, { value: 'metal', label: '金属' }, { value: 'cloth', label: '布料 / 皮革' }, { value: 'emissive', label: '发光 / 能量' }, { value: 'stone', label: '石材 / 岩壁' }, { value: 'wood', label: '木质' }
                ] },
            { id: 'light', type: 'select', label: '光照', value: 'three', options: [
                    { value: 'three', label: '三点布光' }, { value: 'rim', label: '轮廓光' }, { value: 'moody', label: '低调氛围光' }, { value: 'flat', label: '平光（便于后期）' }, { value: 'sunset', label: '暖色夕阳' }
                ] },
            { id: 'strength', type: 'range', label: '风格强度', min: 0, max: 100, step: 5, value: 70, suffix: '%', hint: '越高越偏离原图，越低越保留原笔触' },
            COMMON.size, COMMON.transparent, COMMON.extra
        ],
        build(values) {
            const style = {
                pixel: '像素艺术，16 色调色板，硬边无抗锯齿，1px 深色描边，色块干净',
                anime: '日系二次元赛璐璐上色，清晰线稿，分层阴影，少量高光',
                paint: '厚涂手绘，明显笔触与色块堆叠，边缘松动',
                lowpoly: 'low-poly 3D，平面着色，三角面清晰，柔和阴影',
                pbr: '写实 PBR 材质渲染，物理正确的反射与粗糙度',
                ink: '中国水墨，宣纸质感，墨色浓淡，留白',
                cyber: '赛博朋克，霓虹边缘光，暗部偏青紫，高对比'
            }[values.style || 'pixel'];
            const material = { auto: '', metal: '主体为金属材质，有清楚的高光与磨损', cloth: '布料与皮革材质，褶皱自然', emissive: '局部自发光，能量流动感', stone: '石材与岩壁，颗粒质感', wood: '木质纹理，年轮与裂纹' }[values.material || 'auto'];
            const light = { three: '三点布光，主光侧前方', rim: '强轮廓光，主体从背景里剥离', moody: '低调氛围光，暗部有层次', flat: '平光，方便后期统一', sunset: '暖色夕阳侧逆光' }[values.light || 'three'];
            const strength = values.strength ?? 70;
            return {
                prompt: [
                    '风格渲染任务：以参考图 1 的构图和内容为基础，重新渲染成指定画风。',
                    `画风：${style}。`,
                    material ? `材质：${material}。` : '',
                    `光照：${light}。`,
                    `风格强度约 ${strength}%：${strength >= 75 ? '强烈重绘，允许明显改变笔触和细节' : strength >= 40 ? '在保留原结构的前提下统一风格' : '只做轻微风格化，尽量保留原图细节'}。`,
                    '保持原图的构图、比例、主体位置与轮廓不变；不要新增或删除主体部件；不要文字、水印、边框。',
                    values.transparent ? '输出透明背景 PNG。' : '',
                    values.extra ? `补充：${values.extra}` : '',
                    `输出尺寸：${values.size || '1024x1024'}。`
                ].filter(Boolean).join('\n'),
                size: values.size || '1024x1024',
                transparent: !!values.transparent,
                references: ['base']
            };
        }
    },
    split: {
        id: 'split', tool: 'split', title: '智能拆分', icon: '⧉', accent: '#c4a2ff',
        summary: '把整张角色图拆成独立部件，排成部件总览图，方便后续骨骼装配。',
        source: 'Holopix · 智能拆补图层',
        guide: [
            '上传一张正面、站姿、没有遮挡的角色图效果最好。',
            '拆分结果是一张「部件总览图」：每个部件单独完整、边缘干净。',
            '把总览图直接导入「骨骼动画 → 部件拆件图」，可以继续自动装配。'
        ],
        inputs: [{ id: 'base', type: 'image', label: '角色图', required: true, hint: '正面站姿、无遮挡、背景干净' }],
        fields: [
            { id: 'kind', type: 'select', label: '拆分对象', value: 'character', options: [{ value: 'character', label: '角色（人形）' }, { value: 'creature', label: '生物 / 四足' }, { value: 'mech', label: '机械 / 机甲' }] },
            { id: 'detail', type: 'select', label: '拆分粒度', value: 'standard', options: [{ value: 'simple', label: '简单（头/躯干/四肢 6 件）' }, { value: 'standard', label: '标准（含上下臂、大小腿 10 件）' }, { value: 'fine', label: '精细（含手、脚、披风、武器 14+ 件）' }] },
            { id: 'canvas', type: 'select', label: '总览图布局', value: 'grid', options: [{ value: 'grid', label: '等距网格 + 标签' }, { value: 'loose', label: '松散排布（更省空间）' }] },
            { id: 'labels', type: 'toggle', label: '标注部件名', value: true }
        ],
        build(values) {
            const kind = { character: '人形角色', creature: '生物', mech: '机械' }[values.kind || 'character'];
            const parts = {
                simple: '头部、躯干、左上臂、右上臂、左腿、右腿，共 6 个部件',
                standard: '头部、躯干、左上臂、左下臂、右上臂、右下臂、左大腿、左小腿、右大腿、右小腿，共 10 个部件',
                fine: '头部、躯干、左上臂、左下臂、左手、右上臂、右下臂、右手、左大腿、左小腿、左脚、右大腿、右小腿、右脚，以及披风、武器等附加件'
            }[values.detail || 'standard'];
            return {
                prompt: [
                    `拆件任务：把参考图 1 里的${kind}拆成可以独立使用的部件。`,
                    `需要拆出的部件：${parts}。`,
                    '每个部件必须完整、边界干净、不带其它部件的碎片；保持原图的画风、配色、光影与比例。',
                    '所有部件排在同一张图里，按' + (values.canvas === 'loose' ? '松散排布' : '等距网格') + '摆放' + (values.labels ? '，并在每个部件下方标注中文部件名。' : '，不要标注文字。'),
                    '背景统一使用透明或纯色（与部件颜色有明显对比），部件之间留出至少 8px 间距，不要相互重叠。',
                    '不要重新设计角色，只做拆分。',
                    '输出尺寸：2048x2048。'
                ].join('\n'),
                size: '1536x1024',
                transparent: true,
                references: ['base']
            };
        }
    },
    ui: {
        id: 'ui', tool: 'ui', title: '游戏 UI 套件', icon: '▤', accent: '#5fd6a8',
        summary: 'HUD、菜单、按钮、图标，一次生成整套同风格的界面参考。',
        source: 'Meowa · Game UI',
        guide: [
            '先写清楚游戏类型、题材和界面里必须出现的元素。',
            '建议一次只做一个界面（HUD / 主菜单 / 背包），风格更容易统一。',
            '生成的界面可以用「图片调整」切图、抠图和改尺寸，再进引擎。'
        ],
        inputs: [],
        fields: [
            { id: 'screen', type: 'select', label: '界面类型', value: 'hud', options: [
                    { value: 'hud', label: '战斗 HUD' }, { value: 'menu', label: '主菜单' }, { value: 'inventory', label: '背包 / 物品栏' },
                    { value: 'dialog', label: '对话框 / 剧情' }, { value: 'icons', label: '技能图标组' }, { value: 'buttons', label: '按钮组' }, { value: 'settings', label: '设置面板' }
                ] },
            { id: 'theme', type: 'select', label: '世界题材', value: 'fantasy', options: [
                    { value: 'fantasy', label: '奇幻 / 中世纪' }, { value: 'scifi', label: '科幻 / 太空' }, { value: 'wuxia', label: '武侠 / 国风' },
                    { value: 'post', label: '末日 / 废土' }, { value: 'pixel', label: '像素 / 复古' }, { value: 'cozy', label: '治愈 / 卡通' }
                ] },
            { id: 'palette', type: 'text', label: '主色调', value: '', placeholder: '例如：金 + 深蓝，或写十六进制色值' },
            { id: 'elements', type: 'textarea', label: '必须出现的元素', rows: 3, placeholder: '例如：生命条、魔力条、四个技能格、小地图、任务追踪；横版 1440×900' },
            COMMON.size, COMMON.extra
        ],
        build(values) {
            const screen = {
                hud: '战斗 HUD：左上角色头像与生命/魔力条，右下技能轮盘，右上小地图，底部经验条',
                menu: '主菜单：游戏标题、开始/继续/设置/退出按钮、版本号、氛围背景',
                inventory: '背包界面：物品网格、分类标签、物品详情面板、装备栏、金币数量',
                dialog: '剧情对话框：角色头像、名字、文本区、继续按钮、选项分支',
                icons: '一套技能图标：6 枚，统一底座与描边，分别代表火/冰/雷/治疗/防御/冲刺',
                buttons: '一套按钮：主按钮、次按钮、危险按钮、禁用态、按下态，含图标位',
                settings: '设置面板：音量滑条、画质选项、按键设置、开关控件'
            }[values.screen || 'hud'];
            const theme = {
                fantasy: '奇幻中世纪：木质、黄铜、皮革、羊皮纸质感',
                scifi: '科幻：深色玻璃、青色发光边线、全息投影',
                wuxia: '武侠国风：水墨、宣纸、朱红印章、细金线',
                post: '末日废土：锈迹金属、破损边缘、警示条纹',
                pixel: '像素复古：16 色、硬边、像素描边、8×8 网格对齐',
                cozy: '治愈卡通：圆角、软阴影、马卡龙配色'
            }[values.theme || 'fantasy'];
            return {
                prompt: [
                    `游戏 UI 设计任务：${screen}。`,
                    `世界观与材质：${theme}。`,
                    values.palette ? `主色调：${values.palette}。` : '',
                    values.elements ? `必须包含：${values.elements}。` : '',
                    '要求：所有元素风格统一、层级清楚、可读性优先；按钮与图标边缘干净，便于切图；不要出现真实游戏 logo、商标或水印；不要人物立绘抢占界面。',
                    '输出为单张界面效果图，正视角平面展示。',
                    values.extra ? `补充：${values.extra}` : '',
                    `输出尺寸：${values.size || '1344x768'}（横向界面优先）。`
                ].filter(Boolean).join('\n'),
                size: values.size || '1344x768',
                transparent: false,
                references: []
            };
        }
    }
};
export function getFlow(id) {
    return FLOWS[id] || null;
}
