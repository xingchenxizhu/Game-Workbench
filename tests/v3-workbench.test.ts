import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, SPACES, PIPELINES, PRESETS, SPECIAL, getTool, getSpace, toolsOf, groupByStage, searchTools } from '../public/registry.js';
import { FLOWS } from '../public/flows.js';
import { resolveDeepLink } from '../public/lib/deeplink.js';
import { sendTaskToRig, rigDeepLink } from '../public/lib/rig.js';

test('功能注册表自洽：工具、空间、生产链互相引用正确', () => {
  const ids = TOOLS.map((tool) => tool.id);
  assert.equal(new Set(ids).size, ids.length, '工具 id 不能重复');
  for (const tool of TOOLS) {
    assert.ok(getSpace(tool.space), `${tool.id} 的空间不存在`);
    assert.ok(tool.stage, `${tool.id} 缺少阶段分组`);
    assert.ok(tool.title && tool.summary && tool.tags.length, `${tool.id} 元信息不完整`);
    if (tool.kind === 'frame') assert.ok(tool.url && tool.url.length > 0, `${tool.id} 缺少 url`);
    if (tool.kind === 'flow') assert.ok(FLOWS[tool.flow], `${tool.id} 的流程不存在`);
    if (tool.kind === 'native') assert.ok(tool.view, `${tool.id} 缺少原生视图名`);
  }
  for (const pipeline of PIPELINES) {
    for (const step of pipeline.steps) assert.ok(getTool(step), `${pipeline.id} 的步骤 ${step} 不存在`);
  }
  assert.ok(getTool(SPECIAL.id));
  assert.equal(toolsOf('assets').length, groupByStage(toolsOf('assets')).reduce((sum, group) => sum + group.items.length, 0));
});

test('五个创作空间的工具数量与阶段顺序', () => {
  assert.deepEqual(SPACES.map((space) => space.id), ['assets', 'characters', 'world', 'audio', 'design']);
  assert.equal(SPACES.reduce((sum, space) => sum + toolsOf(space.id).length, 0), TOOLS.length);
  for (const space of SPACES) {
    const stages = groupByStage(toolsOf(space.id)).map((group) => group.stage);
    for (let i = 1; i < stages.length; i++) {
      assert.ok(space.stageOrder.indexOf(stages[i - 1]) <= space.stageOrder.indexOf(stages[i]), `${space.id} 阶段顺序不对`);
    }
  }
});

test('提示词预设分组齐全且带主体占位', () => {
  for (const preset of PRESETS) {
    assert.ok(['style', 'camera', 'ui', 'action'].includes(preset.group), preset.title);
    assert.ok(preset.prompt.includes('{subject}'), `${preset.title} 缺少 {subject}`);
  }
});

test('流程定义都能生成可提交的提示词', () => {
  const defaults = (flow) => {
    const values = {};
    for (const field of flow.fields) values[field.id] = field.value ?? (field.type === 'toggle' ? false : field.type === 'range' ? field.min ?? 0 : '');
    return values;
  };
  for (const flow of Object.values(FLOWS)) {
    const built = flow.build(defaults(flow));
    assert.ok(built.prompt.length > 40, `${flow.id} 提示词过短`);
    assert.match(built.size, /^\d+x\d+$/, `${flow.id} 尺寸非法`);
    assert.equal(typeof built.transparent, 'boolean');
    assert.ok(Array.isArray(built.references));
    for (const input of flow.inputs) assert.ok(flow.guide.length > 0);
  }
  const inpaint = FLOWS.inpaint.build({ ...defaults(FLOWS.inpaint), instruction: '把剑换成符文剑', size: '1024x1024' });
  assert.ok(inpaint.prompt.includes('把剑换成符文剑'));
  assert.ok(inpaint.prompt.includes('保留'));
  const view = FLOWS.view.build({ ...defaults(FLOWS.view), azimuth: 'back', pitch: 20 });
  assert.ok(view.prompt.includes('背面'));
});

test('搜索能落到具体工具', () => {
  assert.equal(searchTools('抠图')[0]?.id, 'matte');
  assert.equal(searchTools('八方向')[0]?.id, 'sprite');
  assert.equal(searchTools('音效')[0]?.id, 'sfx');
  assert.equal(searchTools('策划')[0]?.id, 'gdd');
  assert.equal(searchTools('不存在的功能').length, 0);
});

test('旧插件深链接能解析成工具与 iframe 地址', () => {
  const link = resolveDeepLink('?dsh-gmm=1&module=map&stage=paint');
  assert.equal(link.toolId, 'map');
  assert.match(link.url, /^material\.html\?tool=map&embedded=1&dsh-gmm=1&module=map&stage=paint$/);
  assert.equal(resolveDeepLink('?foo=1'), null);
  assert.equal(resolveDeepLink('?dsh-gmm=1&module=nope'), null);
  const fallback = resolveDeepLink('?dsh-gmm=1');
  assert.equal(fallback.toolId, 'sprite');
});

test('拆件结果能创建骨骼任务并导入拆件图', async () => {
  const calls = [];
  const original = globalThis.fetch;
  const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/result.png')) {
      return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
    const { method, payload } = JSON.parse(init.body);
    calls.push({ method, payload });
    if (method === 'createRigJob') return jsonResponse({ ok: true, value: { jobId: 'r-test' } });
    return jsonResponse({ ok: true, value: { parts: [] } });
  };
  try {
    const jobId = await sendTaskToRig({ id: 'a'.repeat(36), result: 'result.png' }, { name: '测试拆件' });
    assert.equal(jobId, 'r-test');
    assert.deepEqual(calls.map((call) => call.method), ['createRigJob', 'uploadRigSheet']);
    assert.equal(calls[0].payload.name, '测试拆件');
    assert.match(calls[1].payload.data, /^iVBOR/);
    assert.equal(rigDeepLink(jobId), 'dsh-gmm=1&module=rig&job=r-test&stage=parts');
  } finally {
    globalThis.fetch = original;
  }
});

test('拆件图导入失败会删掉刚建的空任务', async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/result.png')) {
      return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
    const { method } = JSON.parse(init.body);
    calls.push(method);
    const body = method === 'createRigJob' ? { ok: true, value: { jobId: 'r-bad' } } : { ok: false, error: { message: '拆件图无法分割' } };
    return new Response(JSON.stringify(body), { status: method === 'createRigJob' ? 200 : 400, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await assert.rejects(() => sendTaskToRig({ id: 'b'.repeat(36), result: 'result.png' }), /拆件图无法分割/);
    assert.deepEqual(calls, ['createRigJob', 'uploadRigSheet', 'deleteRigJob']);
  } finally {
    globalThis.fetch = original;
  }
});
