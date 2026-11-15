// 円盤の積み重ねを描く。一覧と拡大表示の両方がこれを使う。
import { DISC, BAND_COUNT } from './config.js';
import { bandColor, bandSideColor } from './colors.js';

const d3 = window.d3;

/** 半径のスケール。平方根なので、円盤の面積が割合に比例する */
export const radiusScale = (maxRadius) => d3.scaleSqrt().domain([0, DISC.maxShare]).range([0, maxRadius]);

/** 層ごとの g 要素（側面の path と上面の ellipse）を parent の下に作る。データは層の番号（0 が最下段） */
export function createDiscStack(parent, className = 'band') {
  const bands = parent.selectAll(`g.${className}`).data(d3.range(BAND_COUNT)).join('g').attr('class', className);
  bands.append('path').attr('class', 'disc-side');
  bands.append('ellipse').attr('class', 'disc-top');
  return bands;
}

/** ある層の形。baseY は最下段の底、層は上へ積む */
export function discGeometry(band, share, { cx, baseY, layerHeight, radius }) {
  const rx = radius(share);
  const ry = rx * DISC.tilt;
  const top = baseY - (band + 1) * layerHeight;
  const bottom = top + layerHeight;
  const left = cx - rx;
  const right = cx + rx;
  // 側面: 左右の縦線と、下向きの楕円弧2本で囲んだ帯
  const sidePath = `M${left},${top}L${left},${bottom}A${rx},${ry} 0 0 0 ${right},${bottom}L${right},${top}A${rx},${ry} 0 0 1 ${left},${top}Z`;
  return { rx, ry, top, bottom, right, sidePath };
}

/** 層の形を更新する。bands は createDiscStack の戻り値（またはその一部） */
export function updateDiscShapes(bands, shares, geometry, transition) {
  bands.each(function (band) {
    const g = discGeometry(band, shares[band], geometry);
    const el = d3.select(this);
    el.select('.disc-side').transition(transition).attr('d', g.sidePath);
    el.select('.disc-top').attr('cx', geometry.cx).transition(transition).attr('cy', g.top).attr('rx', g.rx).attr('ry', g.ry);
  });
}

/** 層の色を更新する */
export function updateDiscColors(bands, scheme, strokeWidth) {
  bands.each(function (band) {
    const el = d3.select(this);
    el.select('.disc-side').attr('fill', bandSideColor(scheme, band));
    el.select('.disc-top').attr('fill', bandColor(scheme, band)).attr('stroke', bandSideColor(scheme, band)).attr('stroke-width', strokeWidth);
  });
}
