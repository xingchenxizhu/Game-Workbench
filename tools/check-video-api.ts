/**
 * 视频工具接口回归：上传 → 抽帧 → 打包 ZIP → 裁剪 → 拼接。
 * 默认自起一个临时服务（端口 14175、临时数据目录），也可以传 baseUrl 指向已启动的服务。
 * 需要本机可用的 ffmpeg/ffprobe。用法：node tools/check-video-api.ts [baseUrl]
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

let base = process.argv[2] || '';
const dir = await mkdtemp(join(tmpdir(), 'workbench-video-'));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server = null;
let dataDir = '';

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${bin} 退出码 ${code}`)));
  });
}

try {
  if (!base) {
    dataDir = await mkdtemp(join(tmpdir(), 'workbench-video-data-'));
    base = 'http://127.0.0.1:14175';
    server = spawn(process.execPath, ['lib/standalone.js'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, WORKBENCH_PORT: '14175', WORKBENCH_DATA: dataDir },
      stdio: 'ignore',
      windowsHide: true
    });
    let up = false;
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(base + '/api/health').then((r) => r.json())).ok) { up = true; break; } } catch { /* 还没起来 */ }
      await pause(100);
    }
    if (!up) throw new Error('临时服务未能启动');
  }

  const health = await fetch(base + '/api/health').then((r) => r.json());
  assert.equal(health.ok, true);
  let video = health.video || {};
  for (let i = 0; i < 60 && !video.checked; i++) {
    await pause(100);
    video = (await fetch(base + '/api/health').then((r) => r.json())).video || {};
  }
  assert.equal(video.ok, true, video.message || 'ffmpeg 不可用');
  console.log('ok   ffmpeg 可用');

  const post = async (path, body) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(`${path} ${response.status}: ${payload.error?.message || payload.error}`);
    return payload;
  };
  const upload = async (name) => {
    const data = await readFile(join(dir, name));
    const response = await fetch(`${base}/api/video/upload?name=${encodeURIComponent(name)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`upload ${response.status}: ${payload.error?.message || payload.error}`);
    return payload;
  };

  await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24', '-t', '3', '-pix_fmt', 'yuv420p', join(dir, 'a.mp4')]);
  await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'smptebars=size=320x240:rate=24', '-t', '2', '-pix_fmt', 'yuv420p', join(dir, 'b.mp4')]);

  const a = await upload('a.mp4');
  assert.equal(a.width, 320);
  assert.equal(a.height, 240);
  assert.ok(Math.abs(a.duration - 3) < 0.2, String(a.duration));
  assert.ok((await fetch(base + a.url)).status === 200);
  console.log('ok   上传与探测', `${a.width}x${a.height}`, a.duration.toFixed(2) + 's');

  const frames = await post('/api/video/frames', { id: a.id, interval: 1, max: 10, format: 'png', width: 160 });
  assert.ok(frames.count >= 3, String(frames.count));
  const first = await fetch(base + frames.frames[0].url);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'image/png');
  const zip = await fetch(base + frames.zipUrl);
  assert.equal(zip.status, 200);
  const zipBytes = (await zip.arrayBuffer()).byteLength;
  assert.ok(zipBytes > 500, String(zipBytes));
  console.log('ok   抽帧', frames.count, '张 · ZIP', Math.round(zipBytes / 1024) + 'KB');

  const trim = await post('/api/video/trim', { id: a.id, start: 0.5, end: 2.5, reencode: true });
  assert.ok(Math.abs(trim.duration - 2) < 0.3, String(trim.duration));
  assert.ok((await fetch(base + trim.url)).status === 200);
  console.log('ok   裁剪', trim.duration.toFixed(2) + 's');

  const b = await upload('b.mp4');
  const concat = await post('/api/video/concat', { ids: [a.id, b.id], reencode: true });
  assert.ok(Math.abs(concat.duration - 5) < 0.8, String(concat.duration));
  assert.ok((await fetch(base + concat.url)).status === 200);
  console.log('ok   拼接', concat.duration.toFixed(2) + 's');

  console.log('PASS: 上传 / 抽帧 / ZIP / 裁剪 / 拼接');
} finally {
  if (server) {
    server.kill();
    await pause(400);
  }
  await rm(dir, { recursive: true, force: true });
  if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => {});
}
