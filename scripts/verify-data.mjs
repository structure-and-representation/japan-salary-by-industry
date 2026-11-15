#!/usr/bin/env node
// data/salary.json がページの前提を満たしているかを確かめる。
//   node scripts/verify-data.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BAND_COUNT = 9;
const SEX_COUNT = 3;
// 階級別の合計と総数の差の許容（人）。元データの四捨五入による
const SUM_TOLERANCE = 20;
// 円盤の半径スケールが想定している割合の上限（js/config.js の DISC.maxShare と同じ値）
const MAX_SHARE = 0.6;
// 説明文は「平均給与を含む 400万円超 500万円以下 を基準」としている（千円単位）
const BASELINE_RANGE = [4000, 5000];

/** 問題点の文字列を配列で返す。空なら合格 */
export function verify(data) {
  const problems = [];
  const nYears = data.years.length;
  if (!nYears) problems.push('年がない');
  if (data.years.some((y, i) => i > 0 && y <= data.years[i - 1])) problems.push('年が昇順でない');
  if (data.bandLabels.length !== BAND_COUNT) problems.push(`給与レンジのラベルが ${BAND_COUNT} 個でない`);
  if (!data.industries.length) problems.push('業種がない');
  if (data.industries.some((d, i) => i > 0 && Number(d.code) <= Number(data.industries[i - 1].code))) problems.push('業種がコード順でない');

  const check = (label, rec) => {
    for (const key of ['workers', 'salaryAvg', 'bands', 'topBandDetail']) {
      if (rec[key].length !== SEX_COUNT || rec[key].some((a) => a.length !== nYears)) problems.push(`${label}: ${key} の形が 性別×年 でない`);
    }
    rec.bands.forEach((bySex, s) => bySex.forEach((bands, y) => {
      const where = `${label} ${data.sexes[s]} ${data.years[y]}`;
      if (bands.length !== BAND_COUNT) { problems.push(`${where}: 給与レンジが ${BAND_COUNT} 個でない`); return; }
      if (bands.some((v) => v !== null && (v < 0 || !Number.isFinite(v)))) problems.push(`${where}: 負または不正な人数がある`);
      const sum = bands.reduce((a, v) => a + (v ?? 0), 0);
      const total = rec.workers[s][y];
      if (total === null) { problems.push(`${where}: 就労人数が欠損`); return; }
      if (Math.abs(sum - total) > SUM_TOLERANCE) problems.push(`${where}: 階級別の合計 ${sum} が就労人数 ${total} と一致しない`);
      const detail = rec.topBandDetail[s][y];
      if (detail.length !== data.topBandLabels.length) problems.push(`${where}: 800万円超の内訳が ${data.topBandLabels.length} 個でない`);
      const detailSum = detail.reduce((a, v) => a + (v ?? 0), 0);
      if (detailSum !== (bands[BAND_COUNT - 1] ?? 0)) problems.push(`${where}: 800万円超の内訳の合計 ${detailSum} が 800万円超 ${bands[BAND_COUNT - 1]} と一致しない`);
      const maxShare = Math.max(...bands.map((v) => (v ?? 0) / sum));
      if (maxShare > MAX_SHARE) problems.push(`${where}: 割合 ${(maxShare * 100).toFixed(1)}% が円盤スケールの上限 ${MAX_SHARE * 100}% を超える`);
    }));
    rec.workers[0].forEach((total, y) => {
      const parts = rec.workers[1][y] + rec.workers[2][y];
      if (Math.abs(parts - total) > SUM_TOLERANCE) problems.push(`${label} ${data.years[y]}: 男女の合計 ${parts} が男女計 ${total} と一致しない`);
    });
  };
  data.industries.forEach((d) => check(d.name, d));
  check('合計', data.total);

  data.total.salaryAvg[0].forEach((v, y) => {
    if (!(v > BASELINE_RANGE[0] && v <= BASELINE_RANGE[1])) problems.push(`${data.years[y]}: 全体の平均給与 ${v} 千円が基準の階級（400万円超 500万円以下）の外にある`);
  });
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'salary.json');
  const data = JSON.parse(await readFile(file, 'utf8'));
  const problems = verify(data);
  if (problems.length) {
    console.error('検証に失敗:\n' + problems.map((p) => '  - ' + p).join('\n'));
    process.exit(1);
  }
  console.log(`検証に合格（業種 ${data.industries.length}、年 ${data.years[0]}〜${data.years.at(-1)}、欠損セル ${data.source.missingCells}）`);
}
