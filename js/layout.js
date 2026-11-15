// 一覧の配置。図の表示幅から、横並びか縦積みかと、各部の座標を決める。
import { FLOW } from './config.js';

const d3 = window.d3;

/** 横並びにする最小の表示幅（px）。これより狭いと縦に積む */
const HORIZONTAL_MIN_WIDTH = 820;
/** 凡例を図の右上・右下に重ねる最小の表示幅（px） */
const OVERLAY_LEGEND_MIN_WIDTH = 1000;
/** 横並びの座標系の最小幅。表示幅がこれより狭いときは全体を縮小する */
const HORIZONTAL_MIN_VIEWBOX = 1000;
/** 業種の間隔がこれより狭いとき、業種名を細かく改行する */
const NARROW_LABEL_SPACING = 80;
/** 縦積みで幹の太さを決める基準: 男性の合計（約2,930万人）が表示幅のこの割合になる */
const VERTICAL_TRUNK_RATIO = 0.125;
const VERTICAL_TRUNK_WORKERS = 29.3e6;

/** 人数 → 線の太さ（px）。太さは人数に比例する */
const flowWidthScale = (pxPerWorker) => d3.scaleLinear().domain([0, 1e6]).range([0, 1e6 * pxPerWorker]);
/** 太さでは表せず、点線で描くことになる人数の上限 */
const thinFlowLimit = (pxPerWorker) => FLOW.minWidth / pxPerWorker;

function horizontalLayout(containerWidth, count) {
  const width = Math.max(HORIZONTAL_MIN_VIEWBOX, containerWidth);
  const sideMargin = 60;
  const columnX = d3.scalePoint().domain(d3.range(count)).range([sideMargin, width - sideMargin]);
  const spacing = columnX.step();
  const stackBase = 424; // 円盤の最下段の底
  const nameTop = 458; // 業種名の1行目
  return {
    mode: 'horizontal',
    // 表示幅が座標系より狭いと図全体が縮む。図の外に置く凡例を同じ比率にするための倍率
    scale: containerWidth / width,
    width,
    height: 810,
    overlayLegends: containerWidth >= OVERLAY_LEGEND_MIN_WIDTH,
    flowWidth: flowWidthScale(FLOW.pxPerWorker),
    thinFlowLimit: thinFlowLimit(FLOW.pxPerWorker),
    columnX,
    columnY: () => 0,
    disc: { maxRadius: 46, layerHeight: 7.7, baseY: stackBase },
    nameLines: (industry) => (spacing < NARROW_LABEL_SPACING ? industry.labels.narrow : industry.labels.wide).split('|'),
    nameLineY: (line) => nameTop + line * 14,
    percentLabel: { x: 0, y: 314, anchor: 'middle' },
    // 人数ラベルは線の右横に置く（x は線の太さから決める）
    countLabel: { male: { y: 282, anchor: 'start', side: 1 }, female: { y: 540, anchor: 'start', side: 1 } },
    hitArea: { x: -41, width: 82, y: 300, height: 215 },
    sexLabel: {
      fontSize: '30px',
      male: { x: width * 0.07, y: 150, anchor: 'start' },
      female: { x: width * 0.07, y: 690, anchor: 'start' },
    },
    // 男性は上端の幹から各業種の上へ、女性は下端の幹から各業種の下へ
    flow: { maleTrunkY: 22, maleEndY: 290, femaleEndY: 522, femaleTrunkY: 790, trunkHandle: 115, endHandle: 95 },
  };
}

function verticalLayout(containerWidth, count) {
  const width = containerWidth;
  const rowHeight = 124;
  const topMargin = 40;
  const rowCenterOffset = 68; // 行の上端から、円盤の基準位置まで
  const pxPerWorker = Math.min(FLOW.pxPerWorker, (width * VERTICAL_TRUNK_RATIO) / VERTICAL_TRUNK_WORKERS);
  return {
    mode: 'vertical',
    scale: 1,
    width,
    height: topMargin + count * rowHeight + 10,
    overlayLegends: false,
    flowWidth: flowWidthScale(pxPerWorker),
    thinFlowLimit: thinFlowLimit(pxPerWorker),
    columnX: () => width / 2,
    columnY: d3.scalePoint().domain(d3.range(count)).range([topMargin + rowCenterOffset, topMargin + rowCenterOffset + (count - 1) * rowHeight]),
    disc: { maxRadius: 41, layerHeight: 6, baseY: 36 },
    // 3行の名前は2行に、2行の名前は1行にまとめる
    nameLines: (industry) => {
      const parts = industry.labels.wide.split('|');
      return parts.length === 3 ? [parts[0] + parts[1], parts[2]] : [parts.join('')];
    },
    nameLineY: (line, lineCount) => -44 - (lineCount - 1 - line) * 13,
    percentLabel: { x: 62, y: -30, anchor: 'start' },
    countLabel: { male: { x: -58, y: -4, anchor: 'end' }, female: { x: 58, y: -4, anchor: 'start' } },
    hitArea: { x: -width / 2, width, y: -rowCenterOffset, height: rowHeight - 2 },
    sexLabel: {
      fontSize: '17px',
      male: { x: 8, y: 24, anchor: 'start' },
      female: { x: width - 8, y: 24, anchor: 'end' },
    },
    // 左端に男性、右端に女性の幹を縦に通し、各行で角を丸めて円盤の横へ入る
    flow: { trunkTopY: 32, edgeMargin: 8, cornerRadius: 26, rowOffsetY: 8, gapFromCenter: 60 },
  };
}

export function computeLayout(containerWidth, industryCount) {
  const width = Math.max(300, Math.floor(containerWidth));
  return width >= HORIZONTAL_MIN_WIDTH ? horizontalLayout(width, industryCount) : verticalLayout(width, industryCount);
}
