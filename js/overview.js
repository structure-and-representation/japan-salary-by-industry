// 一覧: 上下の流れ（就労人数）と、業種ごとの円盤の積み重ね（給与レンジ）。
import { SEX } from './config.js';
import { bandShares, displayPositions } from './data.js';
import { formatPercent, formatWorkers } from './format.js';
import { computeLayout } from './layout.js';
import { createDiscStack, radiusScale, updateDiscShapes, updateDiscColors } from './discs.js';

const d3 = window.d3;
const DISC_STROKE = 0.4;

export function createOverview({ svg, chartEl, wrapEl, data, store, onOpen }) {
  const { state } = store;
  const industries = data.industries;
  const count = industries.length;
  let layout = null;

  // ---- 要素の用意（描く順 = 重なりの順）
  const sexLabels = {
    male: svg.append('text').attr('class', 'sexlabel').text('男性'),
    female: svg.append('text').attr('class', 'sexlabel').text('女性'),
  };
  const root = svg.append('g').attr('id', 'root');
  const groups = root.selectAll('g.ind').data(industries).join('g')
    .attr('class', 'ind').attr('tabindex', 0).attr('role', 'button').attr('aria-label', (d) => d.displayName);
  const flows = {
    male: groups.append('path').attr('class', 'flow m'),
    female: groups.append('path').attr('class', 'flow f'),
  };
  const columns = groups.append('g').attr('class', 'col');
  const hitAreas = columns.append('rect').attr('class', 'hit');
  const stacks = columns.append('g').attr('class', 'stack');
  const bands = createDiscStack(stacks);
  const names = columns.append('text').attr('class', 'name');
  const percentLabels = columns.append('text').attr('class', 'pct');
  const countLabels = {
    male: columns.append('text').attr('class', 'cnt cm'),
    female: columns.append('text').attr('class', 'cnt cf'),
  };

  // ---- 操作
  const isOpenKey = (e) => e.key === 'Enter' || e.key === ' ';
  groups
    .on('pointerenter', (e, d) => { if (e.pointerType !== 'touch') store.set({ hover: d.index }); })
    .on('pointerleave', (e) => { if (e.pointerType !== 'touch') store.set({ hover: null }); })
    .on('click', function (e, d) { e.stopPropagation(); onOpen(d.index, this, false); })
    .on('focus', function (e, d) { if (this.matches(':focus-visible')) store.set({ hover: d.index }); })
    .on('blur', () => store.set({ hover: null }))
    .on('keydown', function (e, d) { if (isOpenKey(e)) { e.preventDefault(); onOpen(d.index, this, true); } });

  // ---- 配置（表示幅が変わったとき）
  function applyLayout() {
    layout = computeLayout(chartEl.clientWidth, count);
    wrapEl.classList.toggle('wide', layout.overlayLegends);
    wrapEl.classList.toggle('vert', layout.mode === 'vertical');
    svg.attr('viewBox', `0 0 ${layout.width} ${layout.height}`);

    for (const key of ['male', 'female']) {
      const at = layout.sexLabel[key];
      sexLabels[key].attr('x', at.x).attr('y', at.y).attr('text-anchor', at.anchor).style('font-size', layout.sexLabel.fontSize);
      const label = layout.countLabel[key];
      countLabels[key].attr('y', label.y).attr('text-anchor', label.anchor);
      if (label.x !== undefined) countLabels[key].attr('x', label.x);
    }
    names.each(function (d) {
      const lines = layout.nameLines(d);
      d3.select(this).selectAll('tspan').data(lines).join('tspan')
        .attr('x', 0).attr('y', (text, i) => layout.nameLineY(i, lines.length)).text((text) => text);
    });
    percentLabels.attr('x', layout.percentLabel.x).attr('y', layout.percentLabel.y).attr('text-anchor', layout.percentLabel.anchor);
    hitAreas.attr('x', layout.hitArea.x).attr('width', layout.hitArea.width).attr('y', layout.hitArea.y).attr('height', layout.hitArea.height);
  }

  // ---- 流れの形
  /** 横並び: 幹の中で、表示順に左から太さを並べる */
  function horizontalTrunkX(widths, byPosition) {
    const x = [];
    let edge = layout.width / 2 - d3.sum(widths) / 2;
    byPosition.forEach((i) => { x[i] = edge + widths[i] / 2; edge += widths[i]; });
    return x;
  }
  /** 横並び: 幹から垂直に出て、業種の真上（真下）へ垂直に入る3次ベジエ */
  function horizontalFlowPath(trunkX, columnX, trunkY, endY) {
    const direction = Math.sign(endY - trunkY);
    const { trunkHandle, endHandle } = layout.flow;
    return `M${trunkX},${trunkY}C${trunkX},${trunkY + direction * trunkHandle} ${columnX},${trunkY + direction * endHandle} ${columnX},${endY}`;
  }
  /** 縦積み: 端の幹の中で、最下段の業種を最も外側に、最上段を最も内側に並べる。side は左端が +1、右端が -1 */
  function verticalTrunkX(widths, byPosition, startX, side) {
    const x = [];
    let edge = startX;
    byPosition.slice().reverse().forEach((i) => { x[i] = edge + side * widths[i] / 2; edge += side * widths[i]; });
    return x;
  }
  /** 縦積み: 幹を下り、行の高さで角を丸めて円盤の横へ入る */
  function verticalFlowPath(trunkX, rowY, side) {
    const { trunkTopY, cornerRadius, gapFromCenter } = layout.flow;
    const endX = layout.width / 2 - side * gapFromCenter;
    return `M${trunkX},${trunkTopY}L${trunkX},${rowY - cornerRadius}Q${trunkX},${rowY} ${trunkX + side * cornerRadius},${rowY}L${endX},${rowY}`;
  }

  /** 流れ、業種の位置、人数ラベル（年・並び順・配置に依存） */
  function updateGeometry(duration) {
    const y = state.yearIndex;
    const position = displayPositions(data, state);
    const byPosition = d3.range(count).sort((a, b) => position[a] - position[b]);
    const transition = svg.transition().duration(duration);
    const widths = {
      male: industries.map((d) => layout.flowWidth(d.workers[SEX.MALE][y])),
      female: industries.map((d) => layout.flowWidth(d.workers[SEX.FEMALE][y])),
    };

    let paths;
    if (layout.mode === 'horizontal') {
      const f = layout.flow;
      const trunk = { male: horizontalTrunkX(widths.male, byPosition), female: horizontalTrunkX(widths.female, byPosition) };
      paths = {
        male: (d) => horizontalFlowPath(trunk.male[d.index], layout.columnX(position[d.index]), f.maleTrunkY, f.maleEndY),
        female: (d) => horizontalFlowPath(trunk.female[d.index], layout.columnX(position[d.index]), f.femaleTrunkY, f.femaleEndY),
      };
    } else {
      const f = layout.flow;
      const trunk = {
        male: verticalTrunkX(widths.male, byPosition, f.edgeMargin, 1),
        female: verticalTrunkX(widths.female, byPosition, layout.width - f.edgeMargin, -1),
      };
      const rowY = (d) => layout.columnY(position[d.index]) + f.rowOffsetY;
      paths = {
        male: (d) => verticalFlowPath(trunk.male[d.index], rowY(d), 1),
        female: (d) => verticalFlowPath(trunk.female[d.index], rowY(d), -1),
      };
    }
    for (const key of ['male', 'female']) {
      flows[key].transition(transition).attr('stroke-width', (d) => widths[key][d.index]).attr('d', paths[key]);
    }
    columns.transition(transition)
      .attr('transform', (d) => `translate(${layout.columnX(position[d.index])},${layout.columnY(position[d.index])})`);

    const sexOf = { male: SEX.MALE, female: SEX.FEMALE };
    const prefix = { male: '男性 ', female: '女性 ' };
    for (const key of ['male', 'female']) {
      const label = layout.countLabel[key];
      // 横並びでは、線の太さの分だけ右へずらす
      if (label.x === undefined) countLabels[key].attr('x', (d) => label.side * (widths[key][d.index] / 2 + 5));
      countLabels[key].text((d) => prefix[key] + formatWorkers(d.workers[sexOf[key]][y]));
    }
  }

  /** 円盤の形（年・対象・配置に依存） */
  function updateDiscs(duration) {
    const transition = svg.transition().duration(duration);
    const geometry = { cx: 0, baseY: layout.disc.baseY, layerHeight: layout.disc.layerHeight, radius: radiusScale(layout.disc.maxRadius) };
    stacks.each(function (d) {
      updateDiscShapes(d3.select(this).selectAll('g.band'), bandShares(d, state.sex, state.yearIndex), geometry, transition);
    });
  }

  /** 円盤の色（配色・テーマに依存） */
  function updateColors() {
    updateDiscColors(bands, state.scheme, DISC_STROKE);
  }

  /** 凡例で選んだ給与レンジの強調と、その割合のラベル */
  function updateBandFocus() {
    const selected = state.band;
    root.classed('bandsel', selected !== null);
    wrapEl.classList.toggle('bandsel', selected !== null);
    bands.classed('sel', (band) => band === selected);
    percentLabels.text((d) => (selected === null ? '' : formatPercent(bandShares(d, state.sex, state.yearIndex)[selected])));
  }

  /** カーソルを合わせた業種の強調 */
  function updateHover() {
    const hovered = state.hover;
    root.classed('dim', hovered !== null);
    groups.classed('on', (d) => d.index === hovered);
    groups.filter((d) => d.index === hovered).raise();
  }

  return {
    applyLayout,
    updateGeometry,
    updateDiscs,
    updateColors,
    updateBandFocus,
    updateHover,
    get layout() { return layout; },
    /** 業種の添字から、その g 要素を返す */
    elementOf: (index) => groups.filter((d) => d.index === index).node(),
  };
}
