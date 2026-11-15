// 操作部と凡例: 年の選択と再生、円盤の対象、並び順、配色、凡例、説明文。
import { BAND_COUNT, DURATION, FLOW } from './config.js';
import { SCHEMES, bandColor, bandSideColor } from './colors.js';

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
    .map((year, i) => `<span class="yt"><i></i><button type="button" tabindex="-1" data-y="${i}" aria-label="${year}年分">${year}</button></span>`)
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
    $('hiname').textContent = SCHEMES[state.scheme].high;
    $('loname').textContent = SCHEMES[state.scheme].low;
  }
  function updateBand() {
    bandLegend.querySelectorAll('.lgb').forEach((el) => el.setAttribute('aria-pressed', +el.dataset.b === state.band));
  }
  /** 線の太さの凡例。太さの尺度は配置で変わる */
  function updateFlowLegend(flowWidth) {
    const legend = d3.select('#lgflow');
    legend.selectAll('*').remove();
    FLOW.legendValues.forEach((workers, i) => {
      const y = 9 + i * 18;
      legend.append('line').attr('x1', 0).attr('x2', 56).attr('y1', y).attr('y2', y)
        .style('stroke', 'var(--flow-hi)').attr('stroke-width', flowWidth(workers));
      legend.append('text').attr('x', 66).attr('y', y + 3.5).text(`${workers / 1e4}万人`);
    });
  }

  return { updateYear, updateSex, updateScheme, updateBand, updateFlowLegend, stopPlay };
}
