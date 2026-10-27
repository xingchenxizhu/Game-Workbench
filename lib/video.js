import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
const uploadExtensions = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'];
const media = await import(new URL('../modules/material/lib/media.js', import.meta.url).href);
export function createVideoTools({ root, mountPath }) {
    const ffmpegBin = media.ffmpegPath();
    const ffprobeBin = media.ffprobePath();
    const status = { ok: false, checked: false, message: '正在检测 ffmpeg…' };
    function spawnTool(bin, args, { timeout = 180000 } = {}) {
        return new Promise((resolvePromise, reject) => {
            let child;
            try {
                child = spawn(bin, args, { stdio: 'ignore', windowsHide: true, timeout });
            }
            catch (error) {
                reject(error);
                return;
            }
            child.on('error', reject);
            child.on('close', (code) => code === 0
                ? resolvePromise()
                : reject(new Error(`${bin === ffprobeBin ? 'ffprobe' : 'ffmpeg'} 退出码 ${code}`)));
        });
    }
    async function detect() {
        try {
            await spawnTool(ffmpegBin, ['-hide_banner', '-version'], { timeout: 12000 });
            await spawnTool(ffprobeBin, ['-hide_banner', '-version'], { timeout: 12000 });
            status.ok = true;
            status.message = 'ffmpeg 可用';
        }
        catch (error) {
            status.ok = false;
            status.message = `本机没有可用的 ffmpeg（${error.message}）。把 ffmpeg/ffprobe 加入 PATH，或设置 FFMPEG_PATH / FFPROBE_PATH。`;
        }
        finally {
            status.checked = true;
        }
    }
    void detect();
    async function probeVideo(file) {
        const temp = join(root, `.probe-${randomUUID()}.json`);
        try {
            await mkdir(root, { recursive: true });
            await spawnTool(ffprobeBin, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-o', temp, file], { timeout: 30000 });
            const info = JSON.parse(await readFile(temp, 'utf8'));
            const stream = (info.streams || []).find((item) => item.codec_type === 'video');
            const audio = (info.streams || []).find((item) => item.codec_type === 'audio');
            const [num, den] = String(stream?.avg_frame_rate || '0/0').split('/').map(Number);
            return {
                ok: true,
                duration: Number(info.format?.duration || 0),
                size: Number(info.format?.size || 0),
                width: Number(stream?.width || 0),
                height: Number(stream?.height || 0),
                fps: den ? Number((num / den).toFixed(3)) : 0,
                codec: String(stream?.codec_name || ''),
                hasAudio: Boolean(audio)
            };
        }
        catch (error) {
            return { ok: false, error: error.message };
        }
        finally {
            await rm(temp, { force: true }).catch(() => { });
        }
    }
    function videoId(value) {
        if (!/^[a-f0-9-]{36}$/.test(String(value || ''))) {
            throw Object.assign(new Error('无效的视频编号'), { status: 400 });
        }
        return String(value);
    }
    async function videoSource(id) {
        const dir = join(root, videoId(id));
        const entries = await readdir(dir).catch(() => []);
        const file = entries.find((name) => /^source\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(name));
        if (!file)
            throw Object.assign(new Error('视频不存在或已清理'), { status: 404 });
        return { id, dir, file: join(dir, file) };
    }
    function videoUrl(id, name) {
        return `/video-assets/${id}/${name.split('/').map(encodeURIComponent).join('/')}`;
    }
    async function upload(req, url, readBytes) {
        if (status.checked && !status.ok)
            throw Object.assign(new Error(status.message), { status: 503 });
        const original = String(url.searchParams.get('name') || 'video.mp4');
        const name = original.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(-120);
        const ext = extname(name).toLowerCase();
        if (!uploadExtensions.includes(ext))
            throw Object.assign(new Error('只支持 mp4 / mov / webm / mkv / avi'), { status: 415 });
        const data = await readBytes(req, 300 * 1024 * 1024);
        if (data.length < 1024)
            throw Object.assign(new Error('视频文件为空或已损坏'), { status: 400 });
        const id = randomUUID();
        const dir = join(root, id);
        await mkdir(dir, { recursive: true });
        const source = `source${ext}`;
        await writeFile(join(dir, source), data);
        const probe = await probeVideo(join(dir, source));
        if (!probe.ok) {
            await rm(dir, { recursive: true, force: true }).catch(() => { });
            throw Object.assign(new Error(`无法读取视频：${probe.error}`), { status: 400 });
        }
        return { ok: true, id, name, url: videoUrl(id, source), ...probe };
    }
    async function frames(input) {
        const job = await videoSource(input.id);
        const format = input.format === 'jpg' ? 'jpg' : 'png';
        const width = Math.max(0, Math.min(1920, Number(input.width) || 0));
        const max = Math.max(1, Math.min(300, Number(input.max) || 60));
        const fps = Number(input.fps) || 0;
        const interval = Math.max(0.05, Number(input.interval) || 1);
        const filters = [`fps=${fps > 0 ? fps : `1/${interval}`}`];
        if (width > 0)
            filters.push(`scale=${width}:-2:flags=lanczos`);
        const dirName = `frames-${Date.now().toString(36)}`;
        const outDir = join(job.dir, dirName);
        await mkdir(outDir, { recursive: true });
        const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', job.file, '-vf', filters.join(','), '-frames:v', String(max)];
        if (format === 'jpg')
            args.push('-q:v', '2');
        args.push(join(outDir, `frame-%03d.${format}`));
        await spawnTool(ffmpegBin, args, { timeout: 240000 });
        const files = (await readdir(outDir)).filter((name) => /^frame-\d+\.(png|jpg)$/.test(name)).sort();
        if (!files.length)
            throw Object.assign(new Error('没有抽到帧，检查视频时长或抽帧设置'), { status: 400 });
        return {
            ok: true,
            count: files.length,
            dir: `${job.id}/${dirName}`,
            frames: files.map((name) => ({ name, url: videoUrl(job.id, `${dirName}/${name}`) })),
            zipUrl: `/api/video/zip?dir=${encodeURIComponent(`${job.id}/${dirName}`)}`
        };
    }
    async function trim(input) {
        const job = await videoSource(input.id);
        const start = Math.max(0, Number(input.start) || 0);
        const end = Number(input.end);
        const durationInput = Number(input.duration);
        let length = 0;
        if (Number.isFinite(end) && end > start)
            length = end - start;
        else if (Number.isFinite(durationInput) && durationInput > 0)
            length = durationInput;
        if (!(length > 0))
            throw Object.assign(new Error('请填写结束时间或时长'), { status: 400 });
        const outName = `trim-${Date.now().toString(36)}.mp4`;
        const args = ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(start), '-i', job.file, '-t', String(length)];
        if (input.reencode)
            args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart');
        else
            args.push('-c', 'copy');
        args.push(join(job.dir, outName));
        await spawnTool(ffmpegBin, args, { timeout: 240000 });
        const probe = await probeVideo(join(job.dir, outName));
        return {
            ok: true, url: videoUrl(job.id, outName), name: outName, start, end: start + length, reencode: !!input.reencode,
            duration: probe.ok ? probe.duration : length, size: probe.ok ? probe.size : 0, width: probe.width, height: probe.height
        };
    }
    async function concat(input) {
        const ids = Array.isArray(input.ids) ? input.ids.slice(0, 20) : [];
        if (ids.length < 2)
            throw Object.assign(new Error('至少选择 2 个视频'), { status: 400 });
        const jobs = [];
        for (const id of ids)
            jobs.push(await videoSource(id));
        const outId = randomUUID();
        const outDir = join(root, outId);
        await mkdir(outDir, { recursive: true });
        const listFile = join(outDir, 'concat.txt');
        const lines = jobs.map((job) => `file '${job.file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
        await writeFile(listFile, `${lines.join('\n')}\n`);
        const outName = 'concat.mp4';
        const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile];
        if (input.reencode === false)
            args.push('-c', 'copy');
        else
            args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart');
        args.push(join(outDir, outName));
        await spawnTool(ffmpegBin, args, { timeout: 300000 });
        const probe = await probeVideo(join(outDir, outName));
        return {
            ok: true, url: videoUrl(outId, outName), name: outName, sources: jobs.length, reencode: input.reencode !== false,
            duration: probe.ok ? probe.duration : 0, size: probe.ok ? probe.size : 0, width: probe.width, height: probe.height
        };
    }
    async function zip(url) {
        const rel = String(url.searchParams.get('dir') || '');
        const dir = resolve(root, rel);
        if (!dir.startsWith(root + sep))
            throw Object.assign(new Error('禁止访问'), { status: 403 });
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        const files = entries.filter((entry) => entry.isFile());
        if (!files.length)
            throw Object.assign(new Error('没有可打包的文件'), { status: 404 });
        const archive = new JSZip();
        for (const file of files)
            archive.file(file.name, await readFile(join(dir, file.name)));
        const buffer = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        return { buffer, filename: `video-${Date.now()}.zip` };
    }
    function asset(path) {
        const rel = path.slice('/video-assets/'.length);
        const file = resolve(root, rel);
        if (!file.startsWith(root + sep))
            throw Object.assign(new Error('禁止访问'), { status: 403 });
        return file;
    }
    return { status, upload, frames, trim, concat, zip, asset, videoUrl };
}
