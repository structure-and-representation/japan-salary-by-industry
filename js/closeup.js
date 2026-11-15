// 拡大表示: 選んだ業種だけを画面中央に大きく出し、各層に給与レンジ・割合・人数を添える。
// 「男女を並べる」では、男性と女性の積み重ねを左右に置いて比べる。
import { SEX, SEX_LABELS, DURATION, DISC, BAND_COUNT } from './config.js';
import { bandShares, displayPositions } from './data.js';
import { formatPercent, formatSalary, formatWorkers } from './format.js';
import { createDiscStack, discGeometry, radiusScale, updateDiscShapes, updateDiscColors } from './discs.js';

const d3 = window.d3;
const DISC_STROKE = 0.6;
/** カードの幅がこれより狭いとき、詰めた組み方にする */
const COMPACT_CARD_WIDTH = 600;
const TOP_BAND = BAND_COUNT - 1;
/** この業種の平均給与を含む層 / 全業種の平均給与を含む層 の印 */
const MARK = { industry: '◆', overall: '◇' };
const NO_VALUE = '該当なし';

// 図の寸法。columns は積み重ね1つぶん（比較では男性・女性の2つ）。
// leadEndX は引き出し線の終点、markX は印の位置。pct・count は割合・人数の文字。
const GEOMETRY = {
  regular: {
    width: 740, layerHeight: 36, top: 58,
    label: { x: 440, anchor: 'start', dy: 5, size: 13.5 },
    mark: { size: 10, industryDy: -2, overallDy: 10 },
    columns: [{
      cx: 215, maxRadius: 185, leadEndX: 418, markX: 428,
      pct: { x: 644, anchor: 'end', dy: 5, size: 16 }, count: { x: 736, anchor: 'end', dy: 5, size: 14 },
    }],
    header: [['給与レンジ', 440, 'start'], ['割合', 644, 'end'], ['人数', 736, 'end']],
  },
  compact: {
    width: 360, layerHeight: 44, top: 30,
    label: { x: 204, anchor: 'start', dy: -4, size: 11.5 },
    mark: { size: 9.5, industryDy: -4, overallDy: 9 },
    columns: [{
      cx: 96, maxRadius: 88, leadEndX: 185, markX: 194,
      pct: { x: 204, anchor: 'start', dy: 14, size: 15 }, count: { x: 356, anchor: 'end', dy: 14, size: 13 },
    }],
    header: [],
  },
  compareRegular: {
    width: 860, layerHeight: 36, top: 58,
    label: { x: 430, anchor: 'middle', dy: 5, size: 13 },
    mark: { size: 10, industryDy: 0, overallDy: 12 },
    columns: [
      { cx: 125, maxRadius: 110, leadEndX: 285, markX: 347,
        pct: { x: 335, anchor: 'end', dy: 1, size: 15 }, count: { x: 335, anchor: 'end', dy: 14, size: 11 } },
      { cx: 735, maxRadius: 110, leadEndX: 575, markX: 513,
        pct: { x: 525, anchor: 'start', dy: 1, size: 15 }, count: { x: 525, anchor: 'start', dy: 14, size: 11 } },
    ],
    header: [['男性', 125, 'middle'], ['割合・人数', 335, 'end'], ['給与レンジ', 430, 'middle'], ['割合・人数', 525, 'start'], ['女性', 735, 'middle']],
  },
  compareCompact: {
    width: 360, layerHeight: 46, top: 34,
    label: { x: 180, anchor: 'middle', dy: -7, size: 10.5, short: true },
    // 幅がないので、印は割合・人数の文字の前に付ける
    mark: null,
    columns: [
      { cx: 66, maxRadius: 60, leadEndX: null,
        pct: { x: 131, anchor: 'start', dy: 7, size: 13 }, count: { x: 131, anchor: 'start', dy: 19, size: 9.5 } },
      { cx: 294, maxRadius: 60, leadEndX: null,
        pct: { x: 229, anchor: 'end', dy: 7, size: 13 }, count: { x: 229, anchor: 'end', dy: 19, size: 9.5 } },
    ],
    header: [['男性', 66, 'middle'], ['女性', 294, 'middle']],
  },
};

/** 平均給与（千円）が入る層。100万円以下が0、800万円超が8 */
const bandOfSalary = (thousandYen) => Math.min(TOP_BAND, Math.max(0, Math.ceil(thousandYen / 1000) - 1));
/** 幅が狭いときの給与レンジ名 */
const shortBandLabel = (band) => (band === 0 ? '100万以下' : band === TOP_BAND ? '800万超' : `${band}00〜${band + 1}00万`);

export function createCloseup({ data, store, reducedMotion, elementOf, onChange }) {
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
  /** 積み重ね1つぶんの要素一式。2つ用意し、比較のときだけ2つ目を使う */
  function createColumn() {
    const g = svg.append('g');
    const bands = createDiscStack(g, 'zb');
    // 引き出し線は円盤より下に描く
    bands.insert('line', ':first-child').attr('class', 'zlead');
    bands.append('text').attr('class', 'zp');
    bands.append('text').attr('class', 'zn');
    return {
      g, bands,
      industryMark: g.append('text').attr('class', 'zmark').text(MARK.industry),
      overallMark: g.append('text').attr('class', 'zmark').text(MARK.overall),
    };
  }
  const columnEls = [createColumn(), createColumn()];
  const rangeLabels = svg.append('g').selectAll('text').data(d3.range(BAND_COUNT)).join('text').attr('class', 'zl');

  function render(duration = 0) {
    if (openIndex === null) return;
    const industry = industries[openIndex];
    const y = state.yearIndex;
    const compare = state.compare;
    const compact = card.clientWidth < COMPACT_CARD_WIDTH;
    const G = GEOMETRY[compare ? (compact ? 'compareCompact' : 'compareRegular') : (compact ? 'compact' : 'regular')];
    const sexes = compare ? [SEX.MALE, SEX.FEMALE] : [state.sex];
    const baseY = G.top + BAND_COUNT * G.layerHeight;
    const maxRadius = Math.max(...G.columns.map((c) => c.maxRadius));
    svg.attr('viewBox', `0 0 ${G.width} ${baseY + maxRadius * DISC.tilt + 6}`);
    const transition = svg.transition().duration(Math.min(duration, DURATION.closeupMax));
    const layerMiddle = (band) => baseY - (band + 0.5) * G.layerHeight;

    header.selectAll('*').remove();
    G.header.forEach(([text, x, anchor]) =>
      header.append('text').attr('class', 'zhd').attr('x', x).attr('y', 16).attr('text-anchor', anchor).text(text));

    rangeLabels
      .attr('x', G.label.x).attr('y', (band) => layerMiddle(band) + G.label.dy)
      .attr('text-anchor', G.label.anchor).attr('font-size', G.label.size)
      .text((band) => (G.label.short ? shortBandLabel(band) : data.bandLabels[band]));

    columnEls.forEach((el, i) => {
      const spec = G.columns[i];
      el.g.style('display', spec ? null : 'none');
      if (!spec) return;
      const sex = sexes[i];
      const shares = bandShares(industry, sex, y);
      const counts = industry.bands[sex][y];
      const geometry = { cx: spec.cx, baseY, layerHeight: G.layerHeight, radius: radiusScale(spec.maxRadius) };
      updateDiscShapes(el.bands, shares, geometry, transition);
      updateDiscColors(el.bands, state.scheme, DISC_STROKE);

      const industryBand = bandOfSalary(industry.salaryAvg[sex][y]);
      const overallBand = bandOfSalary(data.total.salaryAvg[sex][y]);
      // 印を文字の前に付ける組み方（幅が狭い比較）
      const inlineMark = (band, target, mark) => (!G.mark && band === target ? mark : '');

      const leads = el.bands.select('.zlead').style('display', spec.leadEndX === null ? 'none' : null);
      if (spec.leadEndX !== null) {
        // 数値の列が積み重ねの右にあれば右端から、左にあれば左端から線を出す
        const direction = spec.leadEndX > spec.cx ? 1 : -1;
        leads.attr('y1', layerMiddle).attr('y2', layerMiddle).attr('x2', spec.leadEndX)
          .transition(transition)
          .attr('x1', (band) => spec.cx + direction * (discGeometry(band, shares[band], geometry).rx + 5));
      }
      const place = (selection, at, text) => selection
        .attr('x', at.x).attr('y', (band) => layerMiddle(band) + at.dy)
        .attr('text-anchor', at.anchor).attr('font-size', at.size).text(text);
      // 元の統計表に数値がない層は「該当なし」（0人として扱う）
      place(el.bands.select('.zp'), spec.pct, (band) => inlineMark(band, industryBand, MARK.industry) + (counts[band] === null ? '—' : formatPercent(shares[band])));
      place(el.bands.select('.zn'), spec.count, (band) => inlineMark(band, overallBand, MARK.overall) + (counts[band] === null ? NO_VALUE : formatWorkers(counts[band])));

      for (const [mark, band, dy] of [[el.industryMark, industryBand, G.mark?.industryDy], [el.overallMark, overallBand, G.mark?.overallDy]]) {
        mark.style('display', G.mark ? null : 'none');
        if (G.mark) mark.attr('x', spec.markX).attr('y', layerMiddle(band) + dy + G.mark.size * 0.35).attr('font-size', G.mark.size).attr('text-anchor', 'middle');
      }
    });

    renderText(industry, y, compare);
  }

  /** 図の外の文字: 見出し、平均給与と人数、印の説明、800万円超の内訳、操作部の状態 */
  function renderText(industry, y, compare) {
    const sex = state.sex;
    const sexLabel = SEX_LABELS[sex];
    const year = data.years[y];
    $('zname').textContent = industry.displayName;
    $('zmeta').textContent = compare ? `${year}年分・男女別の給与レンジ別構成` : `${year}年分・${sexLabel}の給与レンジ別構成`;

    const both = (format, values) => `男性 ${format(values[SEX.MALE][y])} / 女性 ${format(values[SEX.FEMALE][y])}`;
    const stat = (title, format, values) => (compare
      ? `<div><dt>${title}</dt><dd>${both(format, values)}<small>男女計 ${format(values[SEX.TOTAL][y])}</small></dd></div>`
      : `<div><dt>${title}（${sexLabel}）</dt><dd>${format(values[sex][y])}<small>${both(format, values)}</small></dd></div>`);
    $('zstats').innerHTML = stat('平均給与', formatSalary, industry.salaryAvg) + stat('就労人数', formatWorkers, industry.workers);

    const scope = compare ? '男性・女性それぞれ' : sexLabel;
    $('zlegend').textContent = `${MARK.industry} この業種の平均給与を含む層　${MARK.overall} 全業種の平均給与を含む層（${scope}の平均）`;

    // 800万円超の内訳。割合は、その業種・その対象の全体に対するもの
    const detailCell = (s) => (index) => {
      const value = industry.topBandDetail[s][y][index];
      if (value === null) return NO_VALUE;
      return `${formatPercent(value / industry.workers[s][y])}・${formatWorkers(value)}`;
    };
    $('ztop').innerHTML = `<h3>800万円超の内訳</h3><dl>${data.topBandLabels.map((label, index) => {
      const values = compare
        ? `<dd><span>男性</span>${detailCell(SEX.MALE)(index)}</dd><dd><span>女性</span>${detailCell(SEX.FEMALE)(index)}</dd>`
        : `<dd>${detailCell(sex)(index)}</dd>`;
      return `<div><dt>${label}</dt>${values}</div>`;
    }).join('')}</dl>`;

    document.querySelectorAll('#zsex button').forEach((b) => {
      const pressed = b.dataset.s === 'compare' ? compare : !compare && +b.dataset.s === sex;
      b.setAttribute('aria-pressed', pressed);
    });
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
    onChange();
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
    onChange();
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
    onChange();
  }

  overlay.addEventListener('click', (e) => { e.stopPropagation(); if (e.target === overlay) close(); });
  $('zclose').onclick = close;
  $('zprev').onclick = () => step(-1);
  $('znext').onclick = () => step(1);
  $('zym').onclick = () => { if (state.yearIndex > 0) store.set({ yearIndex: state.yearIndex - 1 }, { duration: DURATION.closeup }); };
  $('zyp').onclick = () => { if (state.yearIndex < data.years.length - 1) store.set({ yearIndex: state.yearIndex + 1 }, { duration: DURATION.closeup }); };
  document.querySelectorAll('#zsex button').forEach((b) => {
    b.onclick = () => store.set(
      b.dataset.s === 'compare' ? { compare: true } : { sex: +b.dataset.s, compare: false },
      { duration: DURATION.closeup },
    );
  });
  addEventListener('keydown', (e) => {
    if (openIndex === null) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });
  addEventListener('resize', () => render(0));

  return { open, close, render, get openIndex() { return openIndex; } };
}
