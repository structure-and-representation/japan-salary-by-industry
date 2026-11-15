#!/usr/bin/env node
// 元データ（data-of-japan の work-category 配信データ）から、このページ用の data/salary.json を作る。
//
//   node scripts/build-data.mjs <work-category/public/data のパス> [元リポジトリのコミットID]
//
// 入力: dist.json（業種×給与階級×性別×年の人数）、industry.json（業種×性別×年の人数・平均給与）
// 出力: data/salary.json（業種は国税庁の統計表のコード順、給与階級は9区分にまとめる）
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verify } from './verify-data.mjs';

const SEXES = ['total', 'male', 'female'];
const TOTAL_CODE = '15';
// 元の14階級のうち、先頭8つ（100万円以下〜800万円以下）はそのまま、残り6つを「800万円超」にまとめる
const KEPT_BRACKETS = 8;
const BAND_LABELS = [
  '100万円以下', '100万円超 200万円以下', '200万円超 300万円以下', '300万円超 400万円以下',
  '400万円超 500万円以下', '500万円超 600万円以下', '600万円超 700万円以下', '700万円超 800万円以下', '800万円超',
];
// 「800万円超」にまとめた6階級。内訳として別に持つ
const TOP_BAND_LABELS = [
  '800万円超 900万円以下', '900万円超 1,000万円以下', '1,000万円超 1,500万円以下',
  '1,500万円超 2,000万円以下', '2,000万円超 2,500万円以下', '2,500万円超',
];

/** 行優先のフラット配列（cube）から値を読む関数を作る */
function cubeReader(cube, measure) {
  const sizes = cube.dims.map((d) => d.codes.length);
  const indexOf = cube.dims.map((d) => new Map(d.codes.map((c, i) => [c, i])));
  const values = cube.measures[measure];
  if (!values) throw new Error(`指標 ${measure} がない`);
  return (...codes) => {
    let offset = 0;
    codes.forEach((code, k) => {
      const i = indexOf[k].get(String(code));
      if (i === undefined) throw new Error(`軸 ${cube.dims[k].name} にコード ${code} がない`);
      offset = offset * sizes[k] + i;
    });
    return values[offset] ?? null;
  };
}

function dim(cube, name) {
  const d = cube.dims.find((x) => x.name === name);
  if (!d) throw new Error(`軸 ${name} がない`);
  return d.codes;
}

async function main() {
  const [sourceDir, sourceCommit] = process.argv.slice(2);
  if (!sourceDir) {
    console.error('使い方: node scripts/build-data.mjs <work-category/public/data のパス> [コミットID]');
    process.exit(1);
  }
  const read = async (f) => JSON.parse(await readFile(path.join(sourceDir, f), 'utf8'));
  const dist = await read('dist.json');
  const industry = await read('industry.json');

  const years = dim(dist, 'year');
  const brackets = dim(dist, 'bracket');
  if (brackets.length !== KEPT_BRACKETS + TOP_BAND_LABELS.length) throw new Error('給与階級の数が想定（14）と違う');
  for (const [a, b] of [['year', 'year'], ['industry', 'industry'], ['sex', 'sex']]) {
    if (dim(dist, a).join() !== dim(industry, b).join()) throw new Error(`dist.json と industry.json で軸 ${a} が一致しない`);
  }

  const bandWorkers = cubeReader(dist, 'workers'); // (industry, bracket, sex, year)
  const workers = cubeReader(industry, 'workers'); // (industry, sex, year)
  const salaryAvg = cubeReader(industry, 'salary_avg');
  let missingCells = 0;

  const record = (code) => {
    const perSexYear = (fn) => SEXES.map((sex) => years.map((year) => fn(sex, year)));
    const rawBrackets = (sex, year) => brackets.map((b) => bandWorkers(code, b, sex, year));
    return {
      workers: perSexYear((sex, year) => workers(code, sex, year)),
      // 千円単位（元データのまま）
      salaryAvg: perSexYear((sex, year) => salaryAvg(code, sex, year)),
      bands: perSexYear((sex, year) => {
        const raw = rawBrackets(sex, year);
        missingCells += raw.filter((v) => v === null).length;
        const kept = raw.slice(0, KEPT_BRACKETS);
        const rest = raw.slice(KEPT_BRACKETS);
        // まとめる階級がすべて欠損なら欠損のまま、ひとつでも値があれば欠損を0として合算する
        const merged = rest.every((v) => v === null) ? null : rest.reduce((sum, v) => sum + (v ?? 0), 0);
        return [...kept, merged];
      }),
      // 「800万円超」の内訳（6階級）。数値のないセルは null のまま
      topBandDetail: perSexYear((sex, year) => rawBrackets(sex, year).slice(KEPT_BRACKETS)),
    };
  };

  // 業種は統計表のコード順（1〜14）。合計（15）は別に持つ
  const industries = dist.industries
    .filter((d) => d.code !== TOTAL_CODE)
    .sort((a, b) => Number(a.code) - Number(b.code))
    .map((d) => ({ code: d.code, name: d.label, ...record(d.code) }));

  const data = {
    source: {
      survey: '国税庁 民間給与実態統計調査 全国計表 第9表（1年を通じて勤務した給与所得者）',
      estat: 'https://www.e-stat.go.jp/dbview?sid=0004009620',
      via: 'https://github.com/dataofjapan/data-of-japan/tree/main/apps/society/work-category/public/data',
      commit: sourceCommit ?? null,
      missingCells,
    },
    years: years.map(Number),
    sexes: SEXES,
    bandLabels: BAND_LABELS,
    topBandLabels: TOP_BAND_LABELS,
    industries,
    total: record(TOTAL_CODE),
  };

  const problems = verify(data);
  if (problems.length) {
    console.error('検証に失敗:\n' + problems.map((p) => '  - ' + p).join('\n'));
    process.exit(1);
  }
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'salary.json');
  await writeFile(out, JSON.stringify(data) + '\n');
  console.log(`data/salary.json を書き出した（業種 ${industries.length}、年 ${years.length}、欠損セル ${missingCells}）`);
}

main().catch((e) => { console.error(e); process.exit(1); });
