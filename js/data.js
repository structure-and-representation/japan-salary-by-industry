// データの読み込みと、データから導く値。
import { SORT, LOW_SHARE_BANDS, INDUSTRY_LABELS } from './config.js';

export async function loadData(url = 'data/salary.json') {
  // HTML と同じ版のデータを読む（版の番号は scripts/stamp-version.mjs が HTML に書く）
  const build = document.querySelector('meta[name="build"]')?.content;
  const res = await fetch(build ? `${url}?v=${build}` : url);
  if (!res.ok) throw new Error(`データを読み込めない: ${url} (${res.status})`);
  const data = await res.json();
  data.industries.forEach((industry, index) => {
    industry.index = index;
    industry.labels = INDUSTRY_LABELS[industry.code];
    industry.displayName = industry.labels.wide.replaceAll('|', '');
  });
  return data;
}

/** ある業種・性別・年の、給与レンジごとの人数（欠損は0として扱う） */
export const bandCounts = (industry, sex, yearIndex) => industry.bands[sex][yearIndex].map((v) => v ?? 0);

/** ある業種・性別・年の、給与レンジごとの割合 */
export function bandShares(industry, sex, yearIndex) {
  const counts = bandCounts(industry, sex, yearIndex);
  const total = counts.reduce((a, v) => a + v, 0);
  return counts.map((v) => (total ? v / total : 0));
}

/**
 * 表示位置を返す。戻り値は position[業種の添字] = 左（上）から何番目か。
 * 業種はもともと国税庁の統計表の順に並んでいるので、同順位のときはその順が保たれる。
 */
export function displayPositions(data, { sort, sex, yearIndex }) {
  const order = data.industries.map((d) => d.index);
  const by = (score) => order.sort((a, b) => score(data.industries[b]) - score(data.industries[a]));
  if (sort === SORT.SALARY) by((d) => d.salaryAvg[0][yearIndex]);
  if (sort === SORT.WORKERS) by((d) => d.workers[0][yearIndex]);
  if (sort === SORT.LOW_SHARE) by((d) => bandShares(d, sex, yearIndex).slice(0, LOW_SHARE_BANDS).reduce((a, v) => a + v, 0));
  const position = [];
  order.forEach((industryIndex, p) => { position[industryIndex] = p; });
  return position;
}
