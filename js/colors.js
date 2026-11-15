// 給与レンジの配色。分岐的カラースキーム（ColorBrewer、色覚多様性に配慮されたもの）。
// 各配列は先頭が低い給与、末尾が高い給与。
import { DISC } from './config.js';

const d3 = window.d3;
const STORAGE_KEY = 'scheme';
/** 基準の層（400万円超 500万円以下）の位置 */
const BASELINE_BAND = 4;

export const SCHEMES = {
  PuOr: { colors: d3.schemePuOr[9].slice().reverse(), high: '紺', low: 'オレンジ' },
  RdBu: { colors: d3.schemeRdBu[9], high: '青', low: '赤' },
  BrBG: { colors: d3.schemeBrBG[9], high: '青緑', low: '茶' },
  PiYG: { colors: d3.schemePiYG[9], high: '緑', low: 'ピンク' },
  PRGn: { colors: d3.schemePRGn[9], high: '緑', low: '紫' },
  RdYlBu: { colors: d3.schemeRdYlBu[9], high: '青', low: '赤' },
};
export const DEFAULT_SCHEME = 'PuOr';

/** 前回選んだ配色。保存がなければ既定 */
export function storedScheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (SCHEMES[v]) return v;
  } catch (e) { /* 保存領域が使えない環境では既定を使う */ }
  return DEFAULT_SCHEME;
}
export function storeScheme(name) {
  try { localStorage.setItem(STORAGE_KEY, name); } catch (e) { /* 保存できなくても表示は続ける */ }
}

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** 層の上面の色。基準の層がほぼ白のときは、背景に埋もれないテーマ側の色に置き換える */
export function bandColor(scheme, band) {
  const color = SCHEMES[scheme].colors[band];
  const hsl = d3.hsl(color);
  const nearWhite = hsl.l > 0.94 && (hsl.s < 0.2 || isNaN(hsl.s));
  return band === BASELINE_BAND && nearWhite ? cssVar('--neutral-disc') : color;
}

/** 層の側面の色 */
export const bandSideColor = (scheme, band) => d3.color(bandColor(scheme, band)).darker(DISC.sideDarken).formatHex();
