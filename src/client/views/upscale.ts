/** 超清放大：本地最近邻 / 平滑放大，另可提交 AI 重绘式放大任务。 */
import { h, toast, copyText } from '../lib/dom.js';
import { resizeCanvas, canvasToDataURL } from '../lib/canvas.js';
import { api } from '../lib/api.js';
import { panel, split, imageDrop, previewCanvas, downloadCanvas, btn, toggle, actionRow } from './kit.js';

const AI_SIZES = ['1024x1024', '1536x1024', '1344x768', '768x1344', '1024x1536'];

export function mountUpscale(container: any) {
  let source = null;
  let output = null;
  let factor = 2;
  let smooth = false;
  let targetWidth = 0;

  const stage = h('div', { class: 'stage' });
  const info = h('p', { class: 'stage-info' }, '上传图片后选择放大倍数。');
  const downloadButton = btn('导出 PNG', { kind: 'primary', disabled: true });
  const aiButton = btn('提交 AI 重绘放大', { disabled: true });
  const aiHint = h('p', { class: 'muted small' }, 'AI 重绘会走任务中心：复制交接指令给当前聊天生成后回填。');

  const drop = imageDrop({
    label: '上传要放大的图',
    hint: '像素图用最近邻；插画可以走 AI 重绘补细节',
    onChange: (canvas) => {
      source = canvas;
      targetWidth = canvas.width * 2;
      widthText.value = String(targetWidth);
      aiButton.disabled = false;
      run();
    }
  });

  const widthText = h('input', { type: 'number', min: 16, step: 2, value: '', placeholder: '目标宽度', 'aria-label': '目标宽度' });

  function run() {
    if (!source) return;
    const width = targetWidth || Math.round(source.width * factor);
    const height = Math.round((width / source.width) * source.height);
    output = resizeCanvas(source, Math.min(8192, width), Math.min(8192, height), smooth);
    downloadButton.disabled = false;
    paint();
  }

  function paint() {
    stage.replaceChildren();
    if (!output) { stage.append(h('div', { class: 'stage-empty' }, '还没有图片')); return; }
    stage.append(previewCanvas(output, 'checker'));
    info.textContent = `原图 ${source.width} × ${source.height} → 输出 ${output.width} × ${output.height}（${(output.width / source.width).toFixed(1)}×）`;
  }

  const drops = h('div', { class: 'field-block' },
    h('span', { class: 'field-label' }, '目标宽度'),
    h('div', { class: 'inline-row' }, widthText, btn('按倍数重算', {
      kind: 'quiet', onclick: () => { targetWidth = Math.round(source?.width || 1) * factor; widthText.value = String(targetWidth); run(); }
    })),
    h('span', { class: 'field-hint' }, '留空时按倍数放大；最大 8192px。')
  );
  widthText.addEventListener('change', () => { targetWidth = Math.max(16, Number(widthText.value) || 0); run(); });

  const aiPanel = panel('AI 重绘放大', '给插画、概念图补细节；像素图建议直接用本地放大。',
    h('p', { class: 'muted small' }, '会以本地放大结果为参考图，提交一条重绘提示任务。'),
    aiButton, aiHint
  );

  aiButton.addEventListener('click', async () => {
    if (!source || !output) return;
    aiButton.disabled = true;
    try {
      const size = AI_SIZES.reduce((best, candidate) => {
        const ratio = candidate.split('x').map(Number)[0] / candidate.split('x').map(Number)[1];
        const want = source.width / source.height;
        return Math.abs(ratio - want) < Math.abs(best.ratio - want) ? { size: candidate, ratio } : best;
      }, { size: '1024x1024', ratio: 1 });
      const prompt = [
        '重绘式放大任务。参考图 1 是已经放大过的画面，但细节仍然不足。',
        `请在保持原图构图、配色、笔触与角色设计完全一致的前提下，把它重绘为更高清晰度的版本（期望 ${size.size}，实际以工具输出为准）。`,
        '要求：线条与边缘干净，材质纹理和光影层次更丰富；不要改变任何设计元素、不要新增物件、不要加文字水印边框。',
        output.width / output.height > 1.2 ? '保持横向构图。' : output.width / output.height < 0.83 ? '保持竖向构图。' : '保持方形构图。'
      ].join('\n');
      const task = await api.createTask({ prompt, size: size.size, transparent: false, images: [canvasToDataURL(output)], source: 'tool:upscale' });
      await copyText(await api.instruction(task.id));
      toast('已创建重绘任务并复制交接指令，去任务中心可以继续。');
      aiHint.replaceChildren(document.createTextNode(`任务 ${task.id.slice(0, 8)} 已创建，交接指令已复制。`));
    } catch (error) {
      toast(error.message, 'error');
    } finally { aiButton.disabled = false; }
  });

  downloadButton.addEventListener('click', async () => {
    if (!output) return;
    await downloadCanvas(output, drop.node._file?.name || 'upscale', 'image/png');
    toast('图片已导出');
  });

  container.append(split(
    panel('预览', '放大结果实时预览。', drop.node, stage, info),
    h('div', { class: 'stack' },
      panel('本地放大', '像素画务必用最近邻，避免糊边。',
        h('div', { class: 'segmented', role: 'group' }, ...[2, 4, 8].map((value) => h('button', {
          type: 'button', class: value === factor ? 'seg on' : 'seg', onclick: (event) => {
            factor = value;
            for (const button of event.currentTarget.parentElement.children) button.classList.toggle('on', button === event.currentTarget);
            targetWidth = Math.round(source?.width || 1) * factor;
            widthText.value = String(targetWidth);
            run();
          }
        }, `${value}×`))),
        drops,
        toggle({ label: '平滑缩放', value: smooth, hint: '像素素材建议关闭；插画可以打开', onChange: (value) => { smooth = value; run(); } }),
        actionRow(downloadButton)
      ),
      aiPanel
    )
  ));
  paint();
  return () => {};
}
