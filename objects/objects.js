// 試作: 14業種の積み木を台の上に並べ、全体を回して見比べる。
// 円盤の面積は「業種内の割合」か「人数」を切り替えられる。人数にすると全業種で同じ尺度になる。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BAND_COUNT, DISC, SEX, SEX_LABELS, SEX_KEYS } from '../js/config.js';
import { loadData, bandShares, bandCounts } from '../js/data.js';
import { bandColor, storedScheme } from '../js/colors.js';
import { formatPercent, formatSalary, formatWorkers } from '../js/format.js';
import { readUrlState } from '../js/url.js';
import { STACK_HEIGHT, createDiscGeometry, createStack, addLightsAndFloor, createRenderer, setupYearPicker, bandTableRows } from '../object/toy.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- 並べ方（単位は円盤の最大半径を約1とする）
const CELL_WIDTH = 2.1; // 積み木の横の間隔
const CELL_DEPTH = 4.6; // 奥行きの間隔。手前に業種名を置く余白を含む
const SHARE_MAX_RADIUS = 0.85; // 割合が上限（60%）のときの半径
const COUNT_MAX_RADIUS = 0.98; // 人数が全体で最大の層の半径
const VIEW_ELEVATION = 0.9; // 視線の傾き（上から見下ろす度合い）
const FOCUS_DISTANCE = 5.4; // 業種に寄ったときの距離
const WAVE_DELAY = 0.09; // 最初に積むとき、業種1つごとの遅れ（秒）
/** 画面の縦横比から、1行に並べる数を決める */
const columnsFor = (aspect, count) => (aspect > 3 ? count : aspect > 1.05 ? Math.ceil(count / 2) : 4);

async function start() {
  const data = await loadData('../data/salary.json');
  const industries = data.industries;
  const count = industries.length;
  const fromUrl = readUrlState(data);
  const state = {
    size: new URLSearchParams(location.hash.slice(1)).get('size') === 'count' ? 'count' : 'share',
    yearIndex: fromUrl.yearIndex ?? data.years.length - 1,
    sex: fromUrl.sex ?? SEX.TOTAL,
    scheme: fromUrl.scheme ?? storedScheme(),
    focus: fromUrl.industryIndex ?? null, // 寄っている業種の添字
    hover: null, // { industry, band }
  };

  // 人数の尺度: 全業種・全年・男女計で最大の層を基準にする。年や対象を替えても同じ尺度で比べられる
  const maxCount = Math.max(...industries.flatMap((d) => d.bands[SEX.TOTAL].flatMap((bands) => bands.map((v) => v ?? 0))));
  const radii = (industry) => (state.size === 'count'
    ? bandCounts(industry, state.sex, state.yearIndex).map((n) => COUNT_MAX_RADIUS * Math.sqrt(n / maxCount))
    : bandShares(industry, state.sex, state.yearIndex).map((s) => SHARE_MAX_RADIUS * Math.sqrt(s / DISC.maxShare)));

  // ---- 場面
  const canvas = $('canvas');
  const view = $('view');
  const renderer = createRenderer(canvas);
  const scene = new THREE.Scene();
  addLightsAndFloor(scene, 17);
  const geometry = createDiscGeometry();
  const stacks = industries.map((d) => {
    const stack = createStack(geometry, { industry: d.index });
    scene.add(stack.group);
    return stack;
  });

  // 画角を狭くして、端の積み木が傾いて見えるのを抑える
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 300);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.screenSpacePanning = false; // 平行移動は床に沿って
  controls.minDistance = 2.6;
  controls.maxDistance = 110;
  controls.maxPolarAngle = Math.PI / 2 - 0.03; // 床の下には回り込ませない

  // 視点の移動先。毎フレーム、目標へ近づける。操作を始めたら移動をやめる
  let flight = null;
  controls.addEventListener('start', () => { flight = null; });
  const flyTo = (position, target) => {
    dirty = true;
    if (reducedMotion) { camera.position.copy(position); controls.target.copy(target); flight = null; } else flight = { position, target };
  };

  // ---- 並べ方と全体の視点
  const labels = industries.map((d) => {
    const el = document.createElement('div');
    el.className = 'lab';
    $('labels').append(el);
    return el;
  });
  let home = null;
  function layout() {
    const { clientWidth: w, clientHeight: h } = view;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
    const columns = columnsFor(camera.aspect, count);
    const rows = Math.ceil(count / columns);
    stacks.forEach((stack, i) => {
      const column = i % columns;
      const row = Math.floor(i / columns);
      stack.group.position.set((column - (columns - 1) / 2) * CELL_WIDTH, 0, (row - (rows - 1) / 2) * CELL_DEPTH);
    });
    // 全体が収まる距離: 横幅と、見下ろしたときの奥行き＋高さの両方で決める
    const width = columns * CELL_WIDTH + 0.6;
    const depth = rows * CELL_DEPTH;
    const direction = new THREE.Vector3(0, VIEW_ELEVATION, 1).normalize();
    const elevation = Math.asin(direction.y);
    const vertical = depth * Math.sin(elevation) + (STACK_HEIGHT + 0.9) * Math.cos(elevation);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = Math.max(width / 2 / (tanV * camera.aspect), vertical / 2 / tanV) * 1.04;
    const target = new THREE.Vector3(0, STACK_HEIGHT * 0.3, 0.7);
    home = { position: target.clone().addScaledVector(direction, distance), target };
  }
  const goHome = () => flyTo(home.position.clone(), home.target.clone());
  const goFocus = (index) => {
    const at = stacks[index].group.position;
    const target = new THREE.Vector3(at.x, STACK_HEIGHT * 0.45, at.z);
    // いま見ている方向のまま寄る
    const direction = camera.position.clone().sub(controls.target).normalize();
    flyTo(target.clone().addScaledVector(direction, FOCUS_DISTANCE), target);
  };

  let dirty = true; // 次のフレームで描き直す必要があるか

  // ---- 状態 → 立体と文字
  const updateYearPicker = setupYearPicker(data, (yearIndex) => update({ yearIndex }));
  function applyHighlight() {
    dirty = true;
    stacks.forEach((stack, i) => {
      // 寄っている業種では層ごと、それ以外では積み木ごとに強調する
      stack.setHighlight((band) => state.hover !== null && state.hover.industry === i && (state.focus !== i || state.hover.band === band));
    });
    labels.forEach((el, i) => el.classList.toggle('dim', state.focus !== null && state.focus !== i));
    const hoverBand = state.hover && state.hover.industry === state.focus ? state.hover.band : null;
    document.querySelectorAll('#bands tbody tr').forEach((row) => row.classList.toggle('on', +row.dataset.b === hoverBand));
    canvas.style.cursor = state.hover ? 'pointer' : '';
  }
  function renderText() {
    const y = state.yearIndex;
    const sex = state.sex;
    $('sizetext').textContent = state.size === 'count'
      ? '円盤の面積は、そのレンジにいる人数に比例します（全業種で同じ尺度）。'
      : '円盤の面積は、その業種の中でそのレンジにいる人の割合に比例します。';
    labels.forEach((el, i) => {
      el.innerHTML = `${industries[i].displayName}<small>${formatWorkers(industries[i].workers[sex][y])}</small><small>平均 ${formatSalary(industries[i].salaryAvg[sex][y])}</small>`;
    });
    updateYearPicker(y);
    document.querySelectorAll('#sex button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.s === sex));
    document.querySelectorAll('#size button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === state.size));
    $('reset').hidden = false;
    $('detail').hidden = state.focus === null;
    if (state.focus !== null) {
      const industry = industries[state.focus];
      $('name').textContent = industry.displayName;
      $('meta').textContent = `${data.years[y]}年分・${SEX_LABELS[sex]}`;
      $('stats').innerHTML =
        `<div><dt>平均給与</dt><dd>${formatSalary(industry.salaryAvg[sex][y])}</dd></div>
         <div><dt>就労人数</dt><dd>${formatWorkers(industry.workers[sex][y])}</dd></div>`;
      $('bands').tBodies[0].innerHTML = bandTableRows(data, industry, sex, y, bandShares(industry, sex, y), state.scheme, { formatPercent, formatWorkers });
    }
    applyHighlight();
  }
  function writeUrl() {
    const params = new URLSearchParams();
    if (state.size === 'count') params.set('size', 'count');
    if (state.yearIndex !== data.years.length - 1) params.set('year', data.years[state.yearIndex]);
    if (state.sex !== SEX.TOTAL) params.set('sex', SEX_KEYS[state.sex]);
    if (state.focus !== null) params.set('industry', industries[state.focus].code);
    const hash = params.toString();
    try { history.replaceState(null, '', location.pathname + (hash ? `#${hash}` : '')); } catch (e) { /* 書き換えられない環境でも表示は続ける */ }
  }
  /** wave: 端の業種から順に、円盤を落として積む（最初の表示） */
  function update(patch, { wave = false } = {}) {
    Object.assign(state, patch);
    stacks.forEach((stack, i) => stack.setRadii(radii(industries[i]), {
      drop: wave && !reducedMotion, instant: reducedMotion, startDelay: i * WAVE_DELAY,
    }));
    renderText();
    writeUrl();
  }
  function setFocus(index) {
    update({ focus: index });
    if (index === null) goHome(); else goFocus(index);
  }

  // ---- 操作
  document.querySelectorAll('#sex button').forEach((b) => { b.onclick = () => update({ sex: +b.dataset.s }); });
  document.querySelectorAll('#size button').forEach((b) => { b.onclick = () => update({ size: b.dataset.v }); });
  $('reset').onclick = () => setFocus(null);
  $('bandlegend').innerHTML = Array.from({ length: BAND_COUNT }, (unused, i) => BAND_COUNT - 1 - i)
    .map((band) => `<span><i style="background:${bandColor(state.scheme, band)}"></i>${data.bandLabels[band]}</span>`).join('');

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const hitAt = (e) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(stacks.flatMap((s) => s.meshes))[0];
    return hit ? { industry: hit.object.userData.industry, band: hit.object.userData.band } : null;
  };
  const sameHover = (a, b) => (a === null || b === null ? a === b : a.industry === b.industry && a.band === b.band);
  const setHover = (hover) => { if (!sameHover(hover, state.hover)) { state.hover = hover; applyHighlight(); } };
  // ドラッグ（回転）とクリックを、押してから離すまでの移動量で見分ける
  let pressedAt = null;
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') setHover(hitAt(e)); });
  canvas.addEventListener('pointerleave', () => setHover(null));
  canvas.addEventListener('pointerdown', (e) => { pressedAt = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!pressedAt || Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y) > 6) return;
    const hit = hitAt(e);
    if (hit) setFocus(hit.industry === state.focus ? null : hit.industry);
  });
  $('bands').addEventListener('pointerover', (e) => {
    const row = e.target.closest('tbody tr');
    setHover(row && state.focus !== null ? { industry: state.focus, band: +row.dataset.b } : null);
  });
  $('bands').addEventListener('pointerleave', () => setHover(null));

  // ---- 描画の繰り返し
  const projected = new THREE.Vector3();
  function placeLabels() {
    const { clientWidth: w, clientHeight: h } = view;
    stacks.forEach((stack, i) => {
      // 業種名は、積み木の手前の床の位置に置く
      projected.copy(stack.group.position);
      projected.z += 1.3;
      projected.project(camera);
      const visible = projected.z < 1;
      labels[i].style.display = visible ? '' : 'none';
      if (visible) labels[i].style.transform = `translate(${((projected.x + 1) / 2) * w}px,${((1 - projected.y) / 2) * h}px)`;
    });
  }
  const clock = new THREE.Clock();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    let moving = false;
    stacks.forEach((stack) => { if (stack.step(dt)) moving = true; });
    if (flight) {
      const k = Math.min(1, dt * 5);
      camera.position.lerp(flight.position, k);
      controls.target.lerp(flight.target, k);
      if (camera.position.distanceTo(flight.position) < 0.01) flight = null;
      moving = true;
    }
    const viewChanged = controls.update();
    // 何かが動いたときだけ描く（止まっている間は電力を使わない）
    if (moving || viewChanged || dirty) {
      renderer.render(scene, camera);
      placeLabels();
      dirty = false;
    }
    requestAnimationFrame(frame);
  }

  new ResizeObserver(() => { layout(); if (state.focus === null) { camera.position.copy(home.position); controls.target.copy(home.target); } }).observe(view);
  layout();
  camera.position.copy(home.position);
  controls.target.copy(home.target);
  stacks.forEach((stack) => stack.setColors(state.scheme));
  update({}, { wave: true });
  if (state.focus !== null) goFocus(state.focus);
  frame();

  const recolor = () => { stacks.forEach((stack) => stack.setColors(state.scheme)); update({}); dirty = true; };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
  new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

start().catch((error) => {
  console.error(error);
  $('view').innerHTML = '<p class="lede" style="padding:20px">立体を表示できませんでした。WebGL に対応したブラウザで開いてください。</p>';
});
