// 拡大表示: 選んだ業種だけを画面中央に大きく出し、各層に給与レンジ・割合・人数を添える。
import { SEX, SEX_LABELS, DURATION, DISC, BAND_COUNT } from './config.js';
import { bandCounts, bandShares, displayPositions } from './data.js';
import { formatPercent, formatSalary, formatWorkers } from './format.js';
import { createDiscStack, discGeometry, radiusScale, updateDiscShapes, updateDiscColors } from './discs.js';

const d3 = window.d3;
const DISC_STROKE = 0.6;
/** カードの幅がこれより狭いとき、ラベルを2行組みにする */
const COMPACT_CARD_WIDTH = 600;

// 図の寸法。lead は引き出し線、列は右端からの位置
const GEOMETRY = {
  regular: { width: 740, cx: 215, maxRadius: 185, layerHeight: 36, labelX: 440, top: 58, percentRight: 96, countRight: 4 },
  compact: { width: 360, cx: 96, maxRadius: 88, layerHeight: 44, labelX: 204, top: 30, countRight: 4 },
};

export function createCloseup({ data, store, reducedMotion, elementOf }) {
  const { state } = store;
  const industries = data.industries;
  const $ = (id) => document.getElementById(id);
  const overlay = $('zoom');
  const card = $('zcard');
  const svg = d3.select('#zsvg');

  let openIndex = null; // 開いている業種の添字。閉じているときは null
  let sourceEl = null; // 開くきっかけになった一覧側の要素
  let openedByKeyboard = false;

  const header = svg.append('g');
  const bands = createDiscStack(svg.append('g'), 'zb');
  // 引き出し線は円盤より下に描く
  bands.insert('line', ':first-child').attr('class', 'zlead');
  const rangeLabels = bands.append('text').attr('class', 'zl');
  const percentLabels = bands.append('text').attr('class', 'zp');
  const countLabels = bands.append('text').attr('class', 'zn');

  function render(duration = 0) {
    if (openIndex === null) return;
    const industry = industries[openIndex];
    const y = state.yearIndex;
    const sex = state.sex;
    const compact = card.clientWidth < COMPACT_CARD_WIDTH;
    const G = compact ? GEOMETRY.compact : GEOMETRY.regular;
    const shares = bandShares(industry, sex, y);
    const counts = bandCounts(industry, sex, y);
    const baseY = G.top + BAND_COUNT * G.layerHeight;
    const geometry = { cx: G.cx, baseY, layerHeight: G.layerHeight, radius: radiusScale(G.maxRadius) };
    svg.attr('viewBox', `0 0 ${G.width} ${baseY + G.maxRadius * DISC.tilt + 6}`);

    header.selectAll('*').remove();
    if (!compact) {
      [['給与レンジ', G.labelX, 'start'], ['割合', G.width - G.percentRight, 'end'], ['人数', G.width - G.countRight, 'end']]
        .forEach(([text, x, anchor]) => header.append('text').attr('class', 'zhd').attr('x', x).attr('y', 16).attr('text-anchor', anchor).text(text));
    }

    const transition = svg.transition().duration(Math.min(duration, DURATION.closeupMax));
    updateDiscShapes(bands, shares, geometry, transition);
    updateDiscColors(bands, state.scheme, DISC_STROKE);

    const middleY = (band) => { const g = discGeometry(band, shares[band], geometry); return (g.top + g.bottom) / 2; };
    bands.select('.zlead')
      .attr('y1', middleY).attr('y2', middleY).attr('x2', G.labelX - 8)
      .transition(transition).attr('x1', (band) => discGeometry(band, shares[band], geometry).right + 5);
    const place = (labels, x, dy, anchor, size, text) =>
      labels.attr('x', x).attr('y', (band) => middleY(band) + dy).attr('text-anchor', anchor).attr('font-size', size).text(text);
    const percentText = (band) => formatPercent(shares[band]);
    const countText = (band) => formatWorkers(counts[band]);
    if (compact) {
      place(rangeLabels, G.labelX, -4, 'start', 11.5, (band) => data.bandLabels[band]);
      place(percentLabels, G.labelX, 14, 'start', 15, percentText);
      place(countLabels, G.width - G.countRight, 14, 'end', 13, countText);
    } else {
      place(rangeLabels, G.labelX, 5, 'start', 13.5, (band) => data.bandLabels[band]);
      place(percentLabels, G.width - G.percentRight, 5, 'end', 16, percentText);
      place(countLabels, G.width - G.countRight, 5, 'end', 14, countText);
    }

    const sexLabel = SEX_LABELS[sex];
    const year = data.years[y];
    $('zname').textContent = industry.displayName;
    $('zmeta').textContent = `${year}年分・${sexLabel}の給与レンジ別構成`;
    const both = (format, values) => `男性 ${format(values[SEX.MALE][y])} / 女性 ${format(values[SEX.FEMALE][y])}`;
    $('zstats').innerHTML =
      `<div><dt>平均給与（${sexLabel}）</dt><dd>${formatSalary(industry.salaryAvg[sex][y])}<small>${both(formatSalary, industry.salaryAvg)}</small></dd></div>
     <div><dt>就労人数（${sexLabel}）</dt><dd>${formatWorkers(industry.workers[sex][y])}<small>${both(formatWorkers, industry.workers)}</small></dd></div>`;
    document.querySelectorAll('#zsex button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.s === sex));
    $('zyl').textContent = `${year}年分`;
    $('zym').disabled = y <= 0;
    $('zyp').disabled = y >= data.years.length - 1;
  }

  const blurActive = () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); };

  /** index の業種を開く。source は一覧側の要素、byKeyboard はキーボードで開いたか */
  function open(index, source, byKeyboard) {
    openIndex = index;
    sourceEl = source || null;
    openedByKeyboard = !!byKeyboard;
    store.set({ hover: null });
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    render(0);
    if (sourceEl && !reducedMotion && card.animate) {
      // 一覧の円盤の位置から、カードが広がるように見せる
      const from = sourceEl.querySelector('.stack').getBoundingClientRect();
      const to = card.getBoundingClientRect();
      const scale = Math.max(0.05, from.width / to.width);
      card.animate(
        [{ transform: `translate(${from.left - to.left}px,${from.top - to.top}px) scale(${scale})`, opacity: 0.2 }, { transform: 'none', opacity: 1 }],
        { duration: DURATION.open, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
    // フォーカスを動かすのはキーボードで開いたときだけ。マウスやタップでは枠を残さない
    if (openedByKeyboard) $('zclose').focus({ preventScroll: true });
    else blurActive();
  }

  function close() {
    if (openIndex === null) return;
    openIndex = null;
    overlay.hidden = true;
    document.body.style.overflow = '';
    if (openedByKeyboard && sourceEl && sourceEl.focus) sourceEl.focus({ preventScroll: true });
    else blurActive();
    sourceEl = null;
    store.set({ hover: null });
  }

  /** 表示順で前後の業種へ移る */
  function step(offset) {
    if (openIndex === null) return;
    const position = displayPositions(data, state);
    const count = industries.length;
    const next = (position[openIndex] + offset + count) % count;
    openIndex = position.indexOf(next);
    sourceEl = elementOf(openIndex);
    render(DURATION.closeup);
  }

  overlay.addEventListener('click', (e) => { e.stopPropagation(); if (e.target === overlay) close(); });
  $('zclose').onclick = close;
  $('zprev').onclick = () => step(-1);
  $('znext').onclick = () => step(1);
  $('zym').onclick = () => { if (state.yearIndex > 0) store.set({ yearIndex: state.yearIndex - 1 }, { duration: DURATION.closeup }); };
  $('zyp').onclick = () => { if (state.yearIndex < data.years.length - 1) store.set({ yearIndex: state.yearIndex + 1 }, { duration: DURATION.closeup }); };
  document.querySelectorAll('#zsex button').forEach((b) => {
    b.onclick = () => store.set({ sex: +b.dataset.s }, { duration: DURATION.closeup });
  });
  addEventListener('keydown', (e) => {
    if (openIndex === null) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });
  addEventListener('resize', () => render(0));

  return { open, close, render, get isOpen() { return openIndex !== null; } };
}
