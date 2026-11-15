// 試作: 1業種の給与レンジを、回して眺められる積み木のような立体にする。
// 円盤1枚が給与レンジ1つ。半径は平方根スケールなので、円盤の面積が割合に比例する。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DISC, SEX, SEX_LABELS, SEX_KEYS } from '../js/config.js';
import { loadData, bandShares } from '../js/data.js';
import { storedScheme } from '../js/colors.js';
import { formatPercent, formatSalary, formatWorkers } from '../js/format.js';
import { readUrlState } from '../js/url.js';
import { STACK_HEIGHT, createDiscGeometry, createStack, addLightsAndFloor, createRenderer, setupYearPicker, bandTableRows } from './toy.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const radiusOf = (share) => Math.sqrt(share / DISC.maxShare);

async function start() {
  const data = await loadData();
  const fromUrl = readUrlState(data);
  const state = {
    industryIndex: fromUrl.industryIndex ?? 0,
    yearIndex: fromUrl.yearIndex ?? data.years.length - 1,
    sex: fromUrl.sex ?? SEX.TOTAL,
    scheme: fromUrl.scheme ?? storedScheme(),
    hoverBand: null,
  };

  // ---- 場面
  const canvas = $('canvas');
  const view = $('view');
  const renderer = createRenderer(canvas);
  const scene = new THREE.Scene();
  addLightsAndFloor(scene, 2.6);
  const stack = createStack(createDiscGeometry());
  scene.add(stack.group);

  const target = new THREE.Vector3(0, STACK_HEIGHT * 0.45, 0);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  const HOME = new THREE.Vector3(2.9, 2.2, 3.7);
  camera.position.copy(HOME);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 2.6;
  controls.maxDistance = 9;
  controls.maxPolarAngle = Math.PI / 2 - 0.03; // 床の下には回り込ませない
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.7;
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  // 何かが動いたときだけ描く（止まっている間は電力を使わない）
  let dirty = true;

  // ---- 状態 → 立体と文字
  const updateYearPicker = setupYearPicker(data, (yearIndex) => update({ yearIndex }));
  function applyHover() {
    dirty = true;
    stack.setHighlight((band) => band === state.hoverBand);
    document.querySelectorAll('#bands tbody tr').forEach((row) => row.classList.toggle('on', +row.dataset.b === state.hoverBand));
  }
  function renderPanel(shares) {
    const industry = data.industries[state.industryIndex];
    const y = state.yearIndex;
    const sex = state.sex;
    $('name').textContent = industry.displayName;
    $('meta').textContent = `${data.years[y]}年分・${SEX_LABELS[sex]}`;
    $('stats').innerHTML =
      `<div><dt>平均給与</dt><dd>${formatSalary(industry.salaryAvg[sex][y])}</dd></div>
       <div><dt>就労人数</dt><dd>${formatWorkers(industry.workers[sex][y])}</dd></div>`;
    $('bands').tBodies[0].innerHTML = bandTableRows(data, industry, sex, y, shares, state.scheme, { formatPercent, formatWorkers });
    updateYearPicker(y);
    document.querySelectorAll('#sex button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.s === sex));
    $('industry').value = state.industryIndex;
    applyHover();
  }
  function writeUrl() {
    const params = new URLSearchParams();
    params.set('industry', data.industries[state.industryIndex].code);
    if (state.yearIndex !== data.years.length - 1) params.set('year', data.years[state.yearIndex]);
    if (state.sex !== SEX.TOTAL) params.set('sex', SEX_KEYS[state.sex]);
    try { history.replaceState(null, '', `${location.pathname}#${params}`); } catch (e) { /* 書き換えられない環境でも表示は続ける */ }
  }
  /** drop: 円盤を上から落として積み直す（業種を替えたとき） */
  function update(patch, { drop = false } = {}) {
    Object.assign(state, patch);
    const shares = bandShares(data.industries[state.industryIndex], state.sex, state.yearIndex);
    stack.setRadii(shares.map(radiusOf), { drop: drop && !reducedMotion, instant: reducedMotion });
    renderPanel(shares);
    writeUrl();
  }

  // ---- 操作
  $('industry').innerHTML = data.industries.map((d) => `<option value="${d.index}">${d.displayName}</option>`).join('');
  $('industry').onchange = (e) => update({ industryIndex: +e.target.value }, { drop: true });
  const stepIndustry = (offset) => {
    const count = data.industries.length;
    update({ industryIndex: (state.industryIndex + offset + count) % count }, { drop: true });
  };
  $('prev').onclick = () => stepIndustry(-1);
  $('next').onclick = () => stepIndustry(1);
  document.querySelectorAll('#sex button').forEach((b) => { b.onclick = () => update({ sex: +b.dataset.s }); });
  $('reset').onclick = () => { camera.position.copy(HOME); controls.target.copy(target); controls.autoRotate = false; };

  // 円盤と表の行を、互いに強調する
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const setHover = (band) => { if (band !== state.hoverBand) { state.hoverBand = band; applyHover(); } };
  const pick = (e) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(stack.meshes)[0];
    setHover(hit ? hit.object.userData.band : null);
  };
  canvas.addEventListener('pointermove', pick);
  canvas.addEventListener('pointerdown', pick);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') setHover(null); });
  $('bands').addEventListener('pointerover', (e) => { const row = e.target.closest('tbody tr'); setHover(row ? +row.dataset.b : null); });
  $('bands').addEventListener('pointerleave', () => setHover(null));

  // ---- 描画の繰り返し
  function resize() {
    const { clientWidth: w, clientHeight: h } = view;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 縦長の画面では立体が切れないよう、画角を広げる
    camera.fov = w / h < 0.9 ? 44 : 32;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  new ResizeObserver(resize).observe(view);
  resize();

  const clock = new THREE.Clock();
  function frame() {
    const moving = stack.step(Math.min(clock.getDelta(), 0.05));
    const viewChanged = controls.update();
    if (moving || viewChanged || dirty) { renderer.render(scene, camera); dirty = false; }
    requestAnimationFrame(frame);
  }

  stack.setColors(state.scheme);
  update({}, { drop: true });
  frame();

  const recolor = () => { stack.setColors(state.scheme); update({}); dirty = true; };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
  new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

start().catch((error) => {
  console.error(error);
  const probe = document.createElement('canvas');
  const hasWebGL = !!(probe.getContext('webgl2') || probe.getContext('webgl'));
  const message = document.createElement('p');
  message.className = 'lede';
  message.style.padding = '20px';
  message.textContent = hasWebGL
    ? `立体を表示できませんでした。ページを再読み込みしてください。（詳細: ${error && error.message ? error.message : error}）`
    : '立体を表示できませんでした。このブラウザでは WebGL が使えないようです。';
  $('view').replaceChildren(message);
});
