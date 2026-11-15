// 起動と配線: データを読み、各部を作り、状態の変化を必要な描画だけにつなぐ。
import { SORT, DURATION } from './config.js';
import { loadData } from './data.js';
import { storedScheme, storeScheme } from './colors.js';
import { createStore } from './state.js';
import { createOverview } from './overview.js';
import { createCloseup } from './closeup.js';
import { createControls } from './controls.js';

const d3 = window.d3;

async function start() {
  const data = await loadData();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const chartEl = document.querySelector('.chart');

  const store = createStore({
    yearIndex: data.years.length - 1,
    sex: 0,
    sort: SORT.NTA,
    scheme: storedScheme(),
    band: null, // 凡例で選んだ給与レンジ
    hover: null, // カーソルを合わせている業種の添字
  });
  const { state } = store;

  let closeup = null;
  const overview = createOverview({
    svg: d3.select('#svg'),
    chartEl,
    wrapEl: document.querySelector('.chartwrap'),
    data,
    store,
    onOpen: (index, source, byKeyboard) => closeup.open(index, source, byKeyboard),
  });
  closeup = createCloseup({ data, store, reducedMotion, elementOf: overview.elementOf });
  const controls = createControls({ data, store });

  // ---- 状態の変化 → 必要な描画だけを更新する
  store.subscribe((changed, { duration, source }) => {
    const ms = reducedMotion ? 0 : duration ?? DURATION.full;
    const has = (...keys) => keys.some((key) => changed.has(key));
    const orderChanged = has('yearIndex', 'sort') || (has('sex') && state.sort === SORT.LOW_SHARE);

    if (has('yearIndex') && source !== 'play') controls.stopPlay();
    if (orderChanged) overview.updateGeometry(ms);
    if (has('yearIndex', 'sex')) overview.updateDiscs(ms);
    if (has('scheme')) { overview.updateColors(); controls.updateScheme(); storeScheme(state.scheme); }
    if (has('band', 'yearIndex', 'sex')) overview.updateBandFocus();
    if (has('band')) controls.updateBand();
    if (has('hover')) overview.updateHover();
    if (has('yearIndex')) controls.updateYear();
    if (has('sex')) controls.updateSex();
    if (has('yearIndex', 'sex', 'scheme')) closeup.render(ms);
  });

  // ---- 表示幅が変わったら配置からやり直す
  function relayout() {
    overview.applyLayout();
    controls.updateFlowLegend(overview.layout.flowWidth);
    overview.updateGeometry(0);
    overview.updateDiscs(0);
  }
  /** テーマ（明暗）が変わったら、テーマに依存する色を引き直す */
  function recolor() {
    overview.updateColors();
    controls.updateScheme();
    closeup.render(0);
  }

  relayout();
  overview.updateColors();
  overview.updateBandFocus();
  controls.updateYear();
  controls.updateSex();
  controls.updateScheme();
  controls.updateBand();

  let lastWidth = Math.floor(chartEl.clientWidth);
  new ResizeObserver(() => {
    const width = Math.floor(chartEl.clientWidth);
    if (width === lastWidth) return;
    lastWidth = width;
    relayout();
  }).observe(chartEl);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
  new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

start().catch((error) => {
  console.error(error);
  const message = document.createElement('p');
  message.className = 'lede';
  message.textContent = 'データを読み込めませんでした。時間をおいて、もう一度開いてください。';
  document.querySelector('.chartwrap').replaceChildren(message);
});
