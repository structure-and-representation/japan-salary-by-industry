// 操作部と凡例: 年の選択と再生、円盤の対象、並び順、配色、凡例、説明文。
import { BAND_COUNT, DURATION, FLOW, DISC, DISC_LEGEND_SHARES } from './config.js';
import { SCHEMES, bandColor, bandSideColor } from './colors.js';
import { radiusScale } from './discs.js';
import { formatPercent } from './format.js';

const d3 = window.d3;
const PLAY_INTERVAL = 1300;
const $ = (id) => document.getElementById(id);

export function createControls({ data, store }) {
  const { state } = store;
  const lastYear = data.years.length - 1;

  // ---- 年: スライダー、年ラベル、再生
  const slider = $('year');
  slider.max = lastYear;
  const ticks = $('yticks');
  ticks.innerHTML = data.years
    .map((year, i) => `<span class="yt"><i></i><button type="button" tabindex="-1" data-y="${i}" aria-label="${year}年分">'${String(year).slice(-2)}</button></span>`)
    .join('');
  ticks.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (button) store.set({ yearIndex: +button.dataset.y }, { duration: DURATION.quick });
  });
  slider.oninput = (e) => store.set({ yearIndex: +e.target.value }, { duration: DURATION.quick });

  const playButton = $('play');
  let timer = null;
  function stopPlay() {
    clearInterval(timer);
    timer = null;
    playButton.textContent = '▶ 再生';
  }
  playButton.onclick = () => {
    if (timer) { stopPlay(); return; }
    // 最後の年にいるときは最初の年から始める
    if (state.yearIndex >= lastYear) store.set({ yearIndex: 0 }, { source: 'play' });
    playButton.textContent = '■ 停止';
    timer = setInterval(() => {
      if (state.yearIndex >= lastYear) { stopPlay(); return; }
      store.set({ yearIndex: state.yearIndex + 1 }, { source: 'play' });
    }, PLAY_INTERVAL);
  };

  // ---- 円盤の対象、並び順、配色
  document.querySelectorAll('#sex button').forEach((b) => { b.onclick = () => store.set({ sex: +b.dataset.s }); });
  $('sort').onchange = (e) => store.set({ sort: e.target.value });
  $('scheme').value = state.scheme;
  $('sort').value = state.sort;
  $('scheme').onchange = (e) => store.set({ scheme: e.target.value }, { duration: 0 });

  // ---- 給与レンジの凡例（選ぶと全業種でそのレンジを比べる）。上が高い給与
  const bandLegend = $('lgband');
  bandLegend.innerHTML = d3.range(BAND_COUNT).reverse()
    .map((band) => `<button type="button" class="lgb" data-b="${band}" aria-pressed="false"><i></i>${data.bandLabels[band]}</button>`)
    .join('');
  bandLegend.addEventListener('click', (e) => {
    const button = e.target.closest('.lgb');
    if (!button) return;
    e.stopPropagation();
    const band = +button.dataset.b;
    store.set({ band: state.band === band ? null : band }, { duration: DURATION.quick });
  });

  function updateYear() {
    const year = data.years[state.yearIndex];
    $('yearlabel').innerHTML = `${year}<small>年分</small>`;
    slider.value = state.yearIndex;
    ticks.querySelectorAll('.yt').forEach((el, i) => el.classList.toggle('cur', i === state.yearIndex));
    $('avgtext').textContent = `${year}年分の平均給与${Math.round(data.total.salaryAvg[0][state.yearIndex] / 10)}万円`;
  }
  function updateSex() {
    document.querySelectorAll('#sex button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.s === state.sex));
  }
  /** 配色に依存する表示: 凡例の色見本と、説明文の色名 */
  function updateScheme() {
    bandLegend.querySelectorAll('.lgb').forEach((el) => {
      const swatch = el.firstChild;
      swatch.style.background = bandColor(state.scheme, +el.dataset.b);
      swatch.style.borderColor = bandSideColor(state.scheme, +el.dataset.b);
    });
    $('scheme').value = state.scheme;
    $('hiname').textContent = SCHEMES[state.scheme].high;
    $('loname').textContent = SCHEMES[state.scheme].low;
  }
  function updateBand() {
    bandLegend.querySelectorAll('.lgb').forEach((el) => el.setAttribute('aria-pressed', +el.dataset.b === state.band));
  }
  /** 線の太さの凡例と、円盤の面積の凡例。どちらも尺度は配置で変わる */
  function updateScaleLegends(layout) {
    const flowLegend = d3.select('#lgflow');
    flowLegend.selectAll('*').remove();
    const row = (i) => 9 + i * 18;
    const sample = (i) => flowLegend.append('line').attr('x1', 0).attr('x2', 56).attr('y1', row(i)).attr('y2', row(i)).style('stroke', 'var(--flow-hi)');
    const label = (i, text) => flowLegend.append('text').attr('x', 66).attr('y', row(i) + 3.5).text(text);
    // 太さでは表せない人数は点線
    sample(0).attr('stroke-width', FLOW.thinStroke).attr('stroke-dasharray', FLOW.thinDash);
    label(0, `${Math.floor(layout.thinFlowLimit / 1e4)}万人未満`);
    FLOW.legendValues.forEach((workers, i) => {
      sample(i + 1).attr('stroke-width', layout.flowWidth(workers) * layout.scale);
      label(i + 1, `${workers / 1e4}万人`);
    });

    // 円盤の面積: 底をそろえて重ねた楕円と、その割合
    const discLegend = d3.select('#lgdisc');
    discLegend.selectAll('*').remove();
    const radius = radiusScale(layout.disc.maxRadius * layout.scale);
    const cx = 48;
    const bottom = 40;
    const labelX = 106;
    DISC_LEGEND_SHARES.slice().reverse().forEach((share, i) => {
      const rx = radius(share);
      const ry = rx * DISC.tilt;
      const labelY = 12 + i * 13;
      discLegend.append('ellipse').attr('cx', cx).attr('cy', bottom - ry).attr('rx', rx).attr('ry', ry)
        .style('fill', 'none').style('stroke', 'var(--flow-hi)').attr('stroke-width', 1);
      discLegend.append('polyline').attr('points', `${cx},${bottom - 2 * ry} ${labelX - 14},${labelY - 3.5} ${labelX - 4},${labelY - 3.5}`)
        .style('fill', 'none').style('stroke', 'var(--ink-faint)').attr('stroke-width', 0.75);
      discLegend.append('text').attr('x', labelX).attr('y', labelY).text(`${Math.round(share * 100)}%`);
    });
  }

  return { updateYear, updateSex, updateScheme, updateBand, updateScaleLegends, stopPlay };
}
