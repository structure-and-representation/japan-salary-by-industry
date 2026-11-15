#!/usr/bin/env node
// HTML から読み込むファイルに、内容から決まる版の番号（?v=...）を付ける。
//
//   node scripts/stamp-version.mjs          HTML を書き換える
//   node scripts/stamp-version.mjs --check  書き換えが必要なら終了コード 1（push 前の確認用）
//
// GitHub Pages は各ファイルをしばらくキャッシュさせる。番号がないと、更新の直後に
// 「新しい HTML と古いスクリプト」が組み合わさって動かなくなることがある。
// 番号は全ファイルの内容から計算するので、どれか1つでも変わると全部の URL が変わり、
// HTML と同じ版のファイルだけが読み込まれる。
// スクリプトどうしの import には、HTML の importmap で同じ番号を付ける。
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const posix = (p) => p.split(path.sep).join('/');

async function filesIn(dir, extensions) {
  const out = [];
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const rel = posix(path.join(dir, entry.name));
    if (entry.isDirectory()) out.push(...await filesIn(rel, extensions));
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(rel);
  }
  return out.sort();
}

// ページごとの設定。modules は importmap に載せるスクリプトの置き場所
const PAGES = [
  { html: 'index.html', modules: ['js'] },
  { html: 'object/index.html', modules: ['js', 'object'], three: true },
  { html: 'objects/index.html', modules: ['js', 'object', 'objects'], three: true },
];
const THREE_FILES = {
  three: 'vendor/three/three.module.min.js',
  'three/addons/controls/OrbitControls.js': 'vendor/three/addons/controls/OrbitControls.js',
};

async function computeVersion() {
  const files = [
    ...await filesIn('js', ['.js']), ...await filesIn('css', ['.css']), ...await filesIn('data', ['.json']),
    ...await filesIn('object', ['.js', '.css']), ...await filesIn('objects', ['.js', '.css']), ...await filesIn('vendor', ['.js']),
  ];
  const hash = createHash('sha256');
  for (const file of files) hash.update(file).update(await readFile(path.join(root, file)));
  return hash.digest('hex').slice(0, 8);
}

async function stamp(page, version) {
  const file = path.join(root, page.html);
  const dir = path.dirname(page.html);
  /** ページから見た相対パス。importmap のキーは ./ か ../ で始める必要がある */
  const relative = (target) => {
    const rel = posix(path.relative(dir, target));
    return rel.startsWith('.') ? rel : `./${rel}`;
  };
  const imports = {};
  for (const [specifier, target] of Object.entries(page.three ? THREE_FILES : {})) imports[specifier] = `${relative(target)}?v=${version}`;
  for (const moduleDir of page.modules) {
    for (const module of await filesIn(moduleDir, ['.js'])) imports[relative(module)] = `${relative(module)}?v=${version}`;
  }
  const importmap = `<!-- build:importmap（scripts/stamp-version.mjs が生成） -->\n<script type="importmap">\n${JSON.stringify({ imports }, null, 1)}\n</script>\n<!-- /build:importmap -->`;

  const before = await readFile(file, 'utf8');
  if (!/<!-- build:importmap[\s\S]*?<!-- \/build:importmap -->/.test(before)) throw new Error(`${page.html}: importmap の目印がない`);
  const after = before
    .replace(/<!-- build:importmap[\s\S]*?<!-- \/build:importmap -->/, importmap)
    .replace(/(<meta name="build" content=")[^"]*(">)/, `$1${version}$2`)
    .replace(/((?:href|src)="[^"?]+\.(?:css|js))\?v=[0-9a-z]+(")/g, `$1?v=${version}$2`);
  if (!after.includes(`<meta name="build" content="${version}">`)) throw new Error(`${page.html}: <meta name="build"> がない`);
  return { file, before, after };
}

const check = process.argv.includes('--check');
const version = await computeVersion();
let stale = 0;
for (const page of PAGES) {
  const { file, before, after } = await stamp(page, version);
  if (before === after) continue;
  stale += 1;
  if (!check) await writeFile(file, after);
}
if (check && stale) {
  console.error(`版の番号が古い HTML が ${stale} 件ある。node scripts/stamp-version.mjs を実行すること`);
  process.exit(1);
}
console.log(check ? `版の番号は最新（${version}）` : `版 ${version} を付けた（書き換え ${stale} 件）`);
