/** 视频工具：抽帧 / 裁剪 / 拼接。转码在本机 ffmpeg 完成，文件放在 data/video。 */
import { h, toast } from '../lib/dom.js';
import { api, withBase } from '../lib/api.js';
import { panel, split, btn, actionRow, fileDrop, toggle } from './kit.js';

const ACCEPT = '.mp4,.mov,.webm,.mkv,.avi,.m4v,video/*';

function formatSize(bytes) {
  if (!bytes) return '—';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}
function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds * 10) / 10;
  if (total < 60) return `${total} 秒`;
  return `${Math.floor(total / 60)} 分 ${Math.round(total % 60)} 秒`;
}
function videoPlayer(url) {
  return h('video', { class: 'video-player', src: url, controls: true, preload: 'metadata' });
}
function downloadLink(url, name, label = '下载') {
  return h('a', { class: 'btn btn-small', href: url, download: name || true }, label);
}
async function uploadFile(file) {
  const response = await fetch(withBase(`/api/video/upload?name=${encodeURIComponent(file.name)}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.error || '上传失败');
  return payload;
}
const post = async (path, body) => {
  const response = await fetch(withBase(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.error || '处理失败');
  return payload;
};

export function mountVideo(container: any, { toast: notify }: any = {}) {
  let tab = 'frames';
  const tabs = [
    { id: 'frames', label: '抽帧', hint: '把视频拆成 PNG / JPG 序列，做序列帧动画或 GIF' },
    { id: 'trim', label: '裁剪', hint: '截取一段，流拷贝快、重编码精确' },
    { id: 'concat', label: '拼接', hint: '多个片段合成一条，分辨率不同会自动重编码' }
  ];
  const tabBar = h('div', { class: 'video-tabs', role: 'tablist' });
  const status = h('p', { class: 'stage-info' }, '正在检测本机 ffmpeg…');
  const hint = h('p', { class: 'muted small' }, '');
  const panes: any = {};

  function setTab(id) {
    tab = id;
    for (const button of tabBar.children) {
      const on = button.dataset.tab === id;
      button.classList.toggle('on', on);
      button.setAttribute('aria-selected', String(on));
    }
    for (const [key, pane] of Object.entries(panes) as [string, any][]) pane.hidden = key !== id;
    hint.textContent = tabs.find((item) => item.id === id)?.hint || '';
  }

  /* ── 抽帧 ─────────────────────────────────────────────── */
  function buildFrames() {
    let uploaded = null;
    let mode = 'interval';
    const meta = h('p', { class: 'stage-info' }, '先上传一个视频。');
    const interval = h('input', { type: 'number', min: '0.1', max: '30', step: '0.1', value: '1', 'aria-label': '每隔多少秒抽一帧' });
    const fps = h('input', { type: 'number', min: '0.1', max: '30', step: '0.1', value: '1', 'aria-label': '每秒抽多少帧' });
    const max = h('input', { type: 'number', min: '1', max: '300', step: '1', value: '40', 'aria-label': '最多抽多少帧' });
    const width = h('select', { 'aria-label': '输出宽度' },
      ...[0, 160, 320, 480, 640, 1280].map((value) => h('option', { value: String(value), selected: value === 0 }, value === 0 ? '保持原尺寸' : `${value}px 宽`)));
    const format = h('select', { 'aria-label': '图片格式' },
      h('option', { value: 'png' }, 'PNG（无损）'), h('option', { value: 'jpg' }, 'JPG（更小）'));
    const modeBar = h('div', { class: 'segmented', role: 'group' },
      h('button', { type: 'button', class: 'seg on', dataset: { mode: 'interval' }, onclick: (event) => switchMode('interval', event) }, '每隔 N 秒'),
      h('button', { type: 'button', class: 'seg', dataset: { mode: 'fps' }, onclick: (event) => switchMode('fps', event) }, '每秒 N 帧')
    );
    const rowInterval = h('label', { class: 'field' }, h('span', { class: 'field-label' }, '间隔（秒）'), interval);
    const rowFps = h('label', { class: 'field', hidden: true }, h('span', { class: 'field-label' }, '帧率（帧/秒）'), fps);
    const result = h('div', { class: 'video-result' });
    const run = btn('开始抽帧', { kind: 'primary', disabled: true });

    function switchMode(next, event) {
      mode = next;
      for (const button of modeBar.children) button.classList.toggle('on', button.dataset.mode === next);
      rowInterval.hidden = next !== 'interval';
      rowFps.hidden = next !== 'fps';
      void event;
    }

    const drop = fileDrop({
      label: '上传视频', hint: 'mp4 / mov / webm / mkv，最大 300 MB', accept: ACCEPT,
      onFiles: async ([file]) => {
        run.disabled = true;
        meta.textContent = '上传中…';
        try {
          uploaded = await uploadFile(file);
          meta.textContent = `${uploaded.name} · ${formatDuration(uploaded.duration)} · ${uploaded.width}×${uploaded.height} · ${formatSize(uploaded.size)}`;
          run.disabled = false;
        } catch (error) { meta.textContent = error.message; toast(error.message, 'error'); }
      }
    });

    run.addEventListener('click', async () => {
      if (!uploaded) return;
      run.disabled = true;
      const label = run.textContent;
      run.textContent = '抽帧中…';
      result.replaceChildren(h('p', { class: 'muted small' }, '正在调用 ffmpeg…'));
      try {
        const payload = await post('/api/video/frames', {
          id: uploaded.id,
          interval: Number(interval.value) || 1,
          fps: mode === 'fps' ? Number(fps.value) || 1 : 0,
          max: Number(max.value) || 40,
          width: Number(width.value) || 0,
          format: format.value
        });
        const grid = h('div', { class: 'frame-grid' });
        for (const frame of payload.frames) {
          grid.append(h('a', { class: 'frame-tile', href: withBase(frame.url), target: '_blank', rel: 'noopener', download: frame.name },
            h('img', { src: withBase(frame.url), alt: frame.name, loading: 'lazy' }),
            h('span', null, frame.name)
          ));
        }
        result.replaceChildren(
          h('div', { class: 'result-head' },
            h('strong', null, `抽到 ${payload.count} 帧`),
            h('a', { class: 'btn btn-small btn-primary', href: withBase(payload.zipUrl), download: 'frames.zip' }, '下载全部 ZIP')
          ),
          grid
        );
        toast(`抽帧完成：${payload.count} 张`);
      } catch (error) {
        result.replaceChildren(h('p', { class: 'error-text' }, error.message));
        toast(error.message, 'error');
      } finally { run.disabled = false; run.textContent = label; }
    });

    const pane = split(
      panel('抽帧', '序列图可以直接拿去「序列帧动画」，或者用图片调整继续处理。',
        drop.node, meta, modeBar, rowInterval, rowFps,
        h('div', { class: 'field-row' },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, '最多帧数'), max),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, '宽度'), width),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, '格式'), format)
        ),
        actionRow(run)
      ),
      panel('结果', '帧会按 frame-001 的顺序命名。', result)
    );
    return pane;
  }

  /* ── 裁剪 ─────────────────────────────────────────────── */
  function buildTrim() {
    let uploaded = null;
    const meta = h('p', { class: 'stage-info' }, '先上传一个视频。');
    const start = h('input', { type: 'number', min: '0', step: '0.1', value: '0', 'aria-label': '开始时间（秒）' });
    const end = h('input', { type: 'number', min: '0.1', step: '0.1', value: '', 'aria-label': '结束时间（秒）' });
    const result = h('div', { class: 'video-result' });
    const reencode = toggle({ label: '精确重编码', value: true, hint: '关闭后流拷贝更快，但只能从关键帧切' });
    const run = btn('裁剪', { kind: 'primary', disabled: true });

    const drop = fileDrop({
      label: '上传视频', hint: 'mp4 / mov / webm / mkv，最大 300 MB', accept: ACCEPT,
      onFiles: async ([file]) => {
        run.disabled = true;
        meta.textContent = '上传中…';
        try {
          uploaded = await uploadFile(file);
          meta.textContent = `${uploaded.name} · ${formatDuration(uploaded.duration)} · ${uploaded.width}×${uploaded.height}`;
          start.value = '0';
          end.value = String(Math.round(uploaded.duration * 10) / 10);
          run.disabled = false;
        } catch (error) { meta.textContent = error.message; toast(error.message, 'error'); }
      }
    });

    run.addEventListener('click', async () => {
      if (!uploaded) return;
      run.disabled = true;
      const label = run.textContent;
      run.textContent = '裁剪中…';
      try {
        const payload = await post('/api/video/trim', {
          id: uploaded.id, start: Number(start.value) || 0, end: Number(end.value) || 0, reencode: reencode.querySelector('input').checked
        });
        result.replaceChildren(
          h('div', { class: 'result-head' }, h('strong', null, `${formatDuration(payload.duration)} · ${formatSize(payload.size)}`), downloadLink(withBase(payload.url), payload.name)),
          videoPlayer(withBase(payload.url))
        );
        toast('裁剪完成');
      } catch (error) {
        result.replaceChildren(h('p', { class: 'error-text' }, error.message));
        toast(error.message, 'error');
      } finally { run.disabled = false; run.textContent = label; }
    });

    const pane = split(
      panel('裁剪', '按秒数截取，支持快速流拷贝或逐帧精确重编码。',
        drop.node, meta,
        h('div', { class: 'field-row' },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, '开始（秒）'), start),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, '结束（秒）'), end)
        ),
        reencode, actionRow(run)
      ),
      panel('结果', '输出保存在 data/video。', result)
    );
    return pane;
  }

  /* ── 拼接 ─────────────────────────────────────────────── */
  function buildConcat() {
    let files = [];
    const list = h('div', { class: 'file-list' });
    const meta = h('p', { class: 'stage-info' }, '至少选 2 个片段；顺序就是拼接顺序。');
    const result = h('div', { class: 'video-result' });
    const reencode = toggle({ label: '统一重编码', value: true, hint: '分辨率或编码不同时必须打开' });
    const run = btn('开始拼接', { kind: 'primary', disabled: true });

    function paint() {
      list.replaceChildren();
      files.forEach((file, index) => {
        list.append(h('div', { class: 'file-row' },
          h('span', { class: 'file-index' }, String(index + 1)),
          h('span', { class: 'file-name' }, file.name),
          h('span', { class: 'muted small' }, formatSize(file.size)),
          btn('移除', { kind: 'danger-quiet', onclick: () => { files = files.filter((item) => item !== file); paint(); } })
        ));
      });
      run.disabled = files.length < 2;
      meta.textContent = files.length < 2 ? '至少选 2 个片段；顺序就是拼接顺序。' : `已选 ${files.length} 个片段，将按列表顺序拼接。`;
    }

    const drop = fileDrop({
      label: '添加视频片段', hint: '可以一次选多个，也可以分几次添加', accept: ACCEPT, multiple: true,
      onFiles: (picked) => { files = [...files, ...picked].slice(0, 20); paint(); }
    });

    run.addEventListener('click', async () => {
      if (files.length < 2) return;
      run.disabled = true;
      const label = run.textContent;
      try {
        const ids = [];
        for (const [index, file] of files.entries()) {
          run.textContent = `上传 ${index + 1}/${files.length}…`;
          ids.push((await uploadFile(file)).id);
        }
        run.textContent = '拼接中…';
        const payload = await post('/api/video/concat', { ids, reencode: reencode.querySelector('input').checked });
        result.replaceChildren(
          h('div', { class: 'result-head' }, h('strong', null, `${payload.sources} 段 · ${formatDuration(payload.duration)} · ${formatSize(payload.size)}`), downloadLink(withBase(payload.url), payload.name)),
          videoPlayer(withBase(payload.url))
        );
        toast('拼接完成');
      } catch (error) {
        result.replaceChildren(h('p', { class: 'error-text' }, error.message));
        toast(error.message, 'error');
      } finally { run.disabled = files.length < 2; run.textContent = label; }
    });

    paint();
    const pane = split(
      panel('拼接', '按列表顺序合并；不同尺寸或编码时打开统一重编码。',
        drop.node, meta, list,
        reencode, actionRow(run)
      ),
      panel('结果', '输出保存在 data/video。', result)
    );
    return pane;
  }

  for (const item of tabs) {
    tabBar.append(h('button', {
      type: 'button', class: 'video-tab', role: 'tab', dataset: { tab: item.id },
      'aria-selected': String(item.id === tab), onclick: () => setTab(item.id)
    }, item.label));
  }
  panes.frames = buildFrames();
  panes.trim = buildTrim();
  panes.concat = buildConcat();
  container.append(h('div', { class: 'video-shell' }, tabBar, hint, status, ...Object.values(panes)));
  setTab('frames');

  api.health().then((health) => {
    const video = health.video || {};
    status.textContent = video.ok ? `本机转码可用 · ${video.message || 'ffmpeg'}` : (video.message || '未检测到 ffmpeg，视频功能不可用。');
    status.classList.toggle('error-text', !video.ok);
  }).catch(() => { status.textContent = '读取本机服务状态失败。'; status.classList.add('error-text'); });

  return () => {};
}
