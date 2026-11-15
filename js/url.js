// 画面の状態を URL（# 以降）に持たせる。表示中の年や業種を、そのままリンクで共有できる。
//   例: #year=2020&sex=female&sort=salary&scheme=RdBu&band=8&industry=5&compare=1
// 既定値と同じ項目は書かない。
import { SEX_KEYS, SORT, BAND_COUNT } from './config.js';
import { SCHEMES, DEFAULT_SCHEME } from './colors.js';

/** URL から読み取れた項目だけを返す。industryIndex は拡大表示で開く業種（なければ項目なし） */
export function readUrlState(data) {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const result = {};
  const yearIndex = data.years.indexOf(Number(params.get('year')));
  if (yearIndex >= 0) result.yearIndex = yearIndex;
  const sex = SEX_KEYS.indexOf(params.get('sex'));
  if (sex >= 0) result.sex = sex;
  if (Object.values(SORT).includes(params.get('sort'))) result.sort = params.get('sort');
  if (SCHEMES[params.get('scheme')]) result.scheme = params.get('scheme');
  if (params.has('band')) {
    const band = Number(params.get('band'));
    if (Number.isInteger(band) && band >= 0 && band < BAND_COUNT) result.band = band;
  }
  if (params.get('compare') === '1') result.compare = true;
  const industryIndex = data.industries.findIndex((d) => d.code === params.get('industry'));
  if (industryIndex >= 0) result.industryIndex = industryIndex;
  return result;
}

/** いまの状態を URL に書く。履歴は増やさない */
export function writeUrlState(data, state, openIndustryIndex) {
  const params = new URLSearchParams();
  if (state.yearIndex !== data.years.length - 1) params.set('year', data.years[state.yearIndex]);
  if (state.sex !== 0) params.set('sex', SEX_KEYS[state.sex]);
  if (state.sort !== SORT.NTA) params.set('sort', state.sort);
  if (state.scheme !== DEFAULT_SCHEME) params.set('scheme', state.scheme);
  if (state.band !== null) params.set('band', state.band);
  if (openIndustryIndex !== null) {
    params.set('industry', data.industries[openIndustryIndex].code);
    if (state.compare) params.set('compare', '1');
  }
  const hash = params.toString();
  const url = location.pathname + location.search + (hash ? '#' + hash : '');
  try { history.replaceState(null, '', url); } catch (e) { /* 埋め込み先によっては書き換えられない。表示は続ける */ }
}
