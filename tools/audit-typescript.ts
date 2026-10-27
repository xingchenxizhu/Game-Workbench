/**
 * TypeScript 收口审计：确保第一方源码里不再出现手写 .js / .mjs。
 *
 * 允许存在的 JS 只有三类：
 *   public/**  浏览器构建产物
 *   lib/**     宿主 / 插件构建产物
 *   modules/** 引入的第三方模块（素材模块 TS 源 + 编译产物、MapStitch 原代码）
 *
 * 用法：node tools/audit-typescript.ts（npm run check:ts）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const skip = new Set(['node_modules', '.git', 'data', 'test-results', 'assets']);
const allowedPrefixes = ['public', 'lib', 'modules'];
const violations: string[] = [];
const inlineScripts: string[] = [];
const counts = new Map<string, { ts: number; js: number; other: number }>();

function areaOf(file: string): string {
  const rel = relative(root, file);
  return rel.split(sep)[0] || 'root';
}

function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) { walk(full); continue; }
    const ext = extname(full).toLowerCase();
    const area = areaOf(full);
    const row = counts.get(area) || { ts: 0, js: 0, other: 0 };
    if (ext === '.ts') row.ts += 1;
    else if (['.js', '.mjs', '.cjs'].includes(ext)) {
      row.js += 1;
      const rel = relative(root, full).split(sep).join('/');
      if (!allowedPrefixes.some((prefix) => rel.startsWith(`${prefix}/`))) violations.push(rel);
    } else row.other += 1;
    counts.set(area, row);
  }
}

walk(root);

// 页面里不允许再有内联脚本（base / boot-error / redirect 都已外置成经典脚本）
for (const page of ['index.html', 'material.html', 'images.html']) {
  const file = join(root, 'public', page);
  const html = readFileSync(file, 'utf8');
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) inlineScripts.push(`public/${page}`);
}

// package.json 的脚本不应再指向 .mjs 源码（modules/ 里的第三方脚本除外）
const scripts: Record<string, string> = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts || {};
for (const [name, command] of Object.entries(scripts)) {
  if (/\.mjs(\s|$)/.test(command) && !command.includes('modules/')) violations.push(`package.json#${name}: ${command}`);
}

const order = ['src', 'tools', 'tests', 'public', 'lib', 'modules', 'docs', 'root'];
const rows = [...counts.entries()].sort((a, b) => {
  const ai = order.indexOf(a[0]); const bi = order.indexOf(b[0]);
  return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a[0].localeCompare(b[0]);
});

console.log('目录            .ts    .js/其它 JS');
for (const [area, row] of rows) {
  if (row.ts === 0 && row.js === 0) continue;
  console.log(`${area.padEnd(14)}${String(row.ts).padStart(5)}${String(row.js).padStart(8)}`);
}

const firstPartyTs = ['src', 'tools', 'tests'].reduce((sum, area) => sum + (counts.get(area)?.ts || 0), 0);
console.log(`\n第一方 TS 源文件：${firstPartyTs}`);
console.log('JS 允许范围：public/（构建产物）、lib/（构建产物）、modules/（第三方）');

if (inlineScripts.length) {
  console.log(`\n内联脚本：${inlineScripts.join(', ')}`);
}
if (violations.length) {
  console.log(`\n发现第一方 JS 源码（需要改成 .ts）：\n${violations.map((item) => `  - ${item}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('\nPASS：第一方源码全部是 TypeScript，且页面没有内联脚本。');
}
