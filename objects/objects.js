// 試作: 14業種の積み木を台の上に並べ、全体を回して見比べる。
// 円盤の面積は「業種内の割合」か「人数」を切り替えられる。人数にすると全業種で同じ尺度になる。
// 積み木を選ぶとその業種だけが残り、左に業種の概要、右に各層の給与レンジ・割合・人数が出る。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BAND_COUNT, DISC, SEX, SEX_LABELS, SEX_KEYS } from '../js/config.js';
import { loadData, bandShares, bandCounts } from '../js/data.js';
import { bandColor, storedScheme } from '../js/colors.js';
import { formatPercent, formatSalary, formatWorkers } from '../js/format.js';
import { readUrlState } from '../js/url.js';
import { STACK_HEIGHT, DISC_HEIGHT, restY, createDiscGeometry, createStack, addLightsAndFloor, createRenderer, setupYearPicker } from '../object/toy.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- 並べ方（単位は円盤の最大半径を約1とする）
const CELL_WIDTH = 2.1; // 積み木の横の間隔
const CELL_DEPTH = 5.4; // 奥行きの間隔。手前に業種名を置く余白を含む
const SHARE_MAX_RADIUS = 0.85; // 割合が上限（60%）のときの半径
const COUNT_MAX_RADIUS = 0.98; // 人数が全体で最大の層の半径
const VIEW_ELEVATION = 1.0; // 視線の傾き（上から見下ろす度合い）
const WAVE_DELAY = 0.09; // 最初に積むとき、業種1つごとの遅れ（秒）
/** 画面の縦横比から、1行に並べる数を決める */
const columnsFor = (aspect, count) => (aspect > 3 ? count : aspect > 1.05 ? Math.ceil(count / 2) : 4);

// ---- 業種に寄ったときの組み方
const FOCUS_HEIGHT_RATIO = 0.5; // 積み木の高さが、表示領域の高さに占める割合
const FOCUS_WIDTH_RATIO = 0.42; // 積み木の幅が、表示領域の幅に占める割合の上限
const NARROW_VIEW = 620; // 表示領域の幅がこれより狭いとき、詰めた組み方にする
const LABEL_GAP = 30; // 積み木の端から、層のラベルまでの距離（px）
const LABEL_MARGIN = 6; // 業種名と、ほかの積み木との間に空ける余白（px）
/** 幅が狭いときの給与レンジ名 */
const shortBandLabel = (band) => (band === 0 ? '100万以下' : band === BAND_COUNT - 1 ? '800万超' : `${band}00〜${band + 1}00万`);
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

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
  addLightsAndFloor(scene, 20);
  const geometry = createDiscGeometry();
  const stacks = industries.map((d) => {
    const stack = createStack(geometry, { industry: d.index });
    scene.add(stack.group);
    return stack;
  });

  // 画角を狭くして、端の積み木が傾いて見えるのを抑える
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 400);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.screenSpacePanning = false; // 平行移動は床に沿って
  controls.minDistance = 2.6;
  controls.maxDistance = 140;
  controls.maxPolarAngle = Math.PI / 2 - 0.03; // 床の下には回り込ませない

  let dirty = true; // 次のフレームで描き直す必要があるか
  let viewSize = { w: 1, h: 1 };
  const isNarrow = () => viewSize.w < NARROW_VIEW;

  // 視点の移動先。毎フレーム、目標へ近づける。操作を始めたら移動をやめる
  let flight = null;
  controls.addEventListener('start', () => { flight = null; });
  const flyTo = (position, target) => {
    dirty = true;
    if (reducedMotion) { camera.position.copy(position); controls.target.copy(target); flight = null; } else flight = { position, target };
  };
  // 幅が狭いとき、寄った積み木を左へずらして、右にラベルの場所を空ける
  let viewShift = 0;
  const targetViewShift = () => (state.focus !== null && isNarrow() ? 0.2 : 0);
  function applyViewShift() {
    if (Math.abs(viewShift) < 0.001) camera.clearViewOffset();
    else camera.setViewOffset(viewSize.w, viewSize.h, viewShift * viewSize.w, 0, viewSize.w, viewSize.h);
  }

  // ---- 並べ方と全体の視点
  let home = null;
  function layout() {
    viewSize = { w: view.clientWidth, h: view.clientHeight };
    renderer.setSize(viewSize.w, viewSize.h, false);
    camera.aspect = viewSize.w / viewSize.h;
    applyViewShift();
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
    const vertical = depth * Math.sin(elevation) + STACK_HEIGHT * Math.cos(elevation);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = Math.max(width / 2 / (tanV * camera.aspect), vertical / 2 / tanV) * 1.03;
    // 手前の行の業種名が入るよう、注視点を少し手前に置く
    const target = new THREE.Vector3(0, 0, CELL_DEPTH * 0.16);
    home = { position: target.clone().addScaledVector(direction, distance), target };
  }
  const goHome = () => flyTo(home.position.clone(), home.target.clone());
  function goFocus(index) {
    const at = stacks[index].group.position;
    const target = new THREE.Vector3(at.x, STACK_HEIGHT * 0.5, at.z);
    // 積み木が表示領域に対して決めた大きさになる距離まで、いま見ている方向のまま寄る
    const pxPerUnit = Math.min((FOCUS_HEIGHT_RATIO * viewSize.h) / STACK_HEIGHT, (FOCUS_WIDTH_RATIO * viewSize.w) / 2);
    const distance = viewSize.h / 2 / (pxPerUnit * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const direction = camera.position.clone().sub(controls.target).normalize();
    // 真上に近い向きから寄ると層が重なって見えるので、見下ろす角度を抑える
    direction.y = Math.min(direction.y, 0.5);
    direction.normalize();
    flyTo(target.clone().addScaledVector(direction, distance), target);
  }

  // ---- 画面上の位置
  const projected = new THREE.Vector3();
  const toScreen = (x, y, z) => {
    projected.set(x, y, z).project(camera);
    return { x: ((projected.x + 1) / 2) * viewSize.w, y: ((1 - projected.y) / 2) * viewSize.h, behind: projected.z > 1 };
  };
  /** 積み木が画面上で占める矩形 */
  function screenBox(stack) {
    const { x, z } = stack.group.position;
    const r = Math.max(stack.maxRadius, 0.12);
    const box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity, behind: false };
    for (const dx of [-r, r]) for (const dz of [-r, r]) for (const y of [0, STACK_HEIGHT]) {
      const p = toScreen(x + dx, y, z + dz);
      if (p.behind) box.behind = true;
      box.left = Math.min(box.left, p.x); box.right = Math.max(box.right, p.x);
      box.top = Math.min(box.top, p.y); box.bottom = Math.max(box.bottom, p.y);
    }
    return box;
  }

  // ---- 全体表示の業種名。積み木のすぐ下に置き、ほかの積み木や業種名に重なるときは上に、それも重なるなら隠す
  const labels = industries.map(() => {
    const el = document.createElement('div');
    el.className = 'lab';
    $('labels').append(el);
    return { el, width: 0, height: 0 };
  });
  const measureLabels = () => labels.forEach((label) => { label.width = label.el.offsetWidth; label.height = label.el.offsetHeight; });
  function placeLabels() {
    const boxes = stacks.map((stack) => (stack.visible ? screenBox(stack) : null));
    const placed = [];
    // 手前の積み木から順に場所を取る
    const order = stacks.map((unused, i) => i).sort((a, b) => (boxes[b]?.bottom ?? 0) - (boxes[a]?.bottom ?? 0));
    order.forEach((i) => {
      const label = labels[i];
      const box = boxes[i];
      let rect = null;
      if (state.focus === null && box && !box.behind) {
        // 横は表示領域からはみ出さないよう寄せる
        const left = Math.min(Math.max((box.left + box.right) / 2 - label.width / 2, 2), viewSize.w - label.width - 2);
        const at = (top) => ({ left, right: left + label.width, top, bottom: top + label.height });
        const free = (r) => r.top > 0 && r.bottom < viewSize.h
          && boxes.every((other, j) => j === i || !other || !overlaps(r, { left: other.left - LABEL_MARGIN, right: other.right + LABEL_MARGIN, top: other.top - LABEL_MARGIN, bottom: other.bottom + LABEL_MARGIN }))
          && placed.every((other) => !overlaps(r, other));
        rect = [at(box.bottom + 5), at(box.top - label.height - 5)].find(free) ?? null;
      }
      label.el.style.opacity = rect ? 1 : 0;
      if (rect) { label.el.style.transform = `translate(${rect.left}px,${rect.top}px)`; placed.push(rect); }
    });
  }

  // ---- 寄ったときの表示。左に業種の概要、右に各層のラベルを、積み木の位置に合わせて置く
  const focusUi = $('focusui');
  const headEl = $('fhead');
  const leads = $('leads');
  const rows = Array.from({ length: BAND_COUNT }, (unused, band) => {
    const el = document.createElement('div');
    el.className = 'frow';
    el.dataset.b = band;
    $('frows').append(el);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    leads.append(line);
    return { el, line };
  });
  function placeFocusUi() {
    const focused = state.focus !== null;
    focusUi.classList.toggle('on', focused);
    focusUi.classList.toggle('narrow', isNarrow());
    if (!focused) return;
    const stack = stacks[state.focus];
    const box = screenBox(stack);
    const { x, z } = stack.group.position;
    // カメラから見て右向きの、床に沿った方向。各層の右端はこの向きにある
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    const edges = stack.discs.map((disc, band) => {
      const r = Math.max(disc.radius, 0.02);
      return toScreen(x + right.x * r, restY(band) + DISC_HEIGHT / 2, z + right.z * r);
    });
    // 各円盤が画面上で占める形（上面と底面の楕円と、その間）。引き出し線が円盤の上を横切らないよう、
    // 線は「その高さで、いちばん右に見えている輪郭」から出す
    const tilt = Math.abs(camera.getWorldDirection(new THREE.Vector3()).y); // 見下ろす角度の正弦 = 楕円のつぶれ具合
    const shapes = stack.discs.map((disc, band) => {
      const top = toScreen(x, restY(band) + DISC_HEIGHT, z);
      const bottom = toScreen(x, restY(band), z);
      const rx = edges[band].x - (top.x + bottom.x) / 2;
      return { cx: (top.x + bottom.x) / 2, topY: top.y, bottomY: bottom.y, rx, ry: rx * tilt, exists: disc.targetRadius > 0.001 };
    });
    const silhouetteX = (y) => Math.max(...shapes.map((s) => {
      if (!s.exists) return -Infinity;
      const outside = y < s.topY ? s.topY - y : y > s.bottomY ? y - s.bottomY : 0;
      return outside >= s.ry ? -Infinity : s.cx + s.rx * Math.sqrt(1 - (outside / s.ry) ** 2);
    }));
    // ラベルは縦に等間隔。層の見かけの間隔が狭いときは、読める行間まで広げる
    const rowHeight = rows[0].el.offsetHeight;
    const spacing = Math.max(Math.abs(edges[0].y - edges[BAND_COUNT - 1].y) / (BAND_COUNT - 1), rowHeight + 3);
    const middleY = (edges[0].y + edges[BAND_COUNT - 1].y) / 2;
    const labelX = Math.min(Math.max(...edges.map((p) => p.x)) + LABEL_GAP, viewSize.w - rows[0].el.offsetWidth - 8);
    rows.forEach(({ el, line }, band) => {
      const y = middleY - (band - (BAND_COUNT - 1) / 2) * spacing;
      el.style.transform = `translate(${labelX}px,${y - rowHeight / 2}px)`;
      line.setAttribute('x1', Math.max(edges[band].x, silhouetteX(edges[band].y)) + 4); line.setAttribute('y1', edges[band].y);
      line.setAttribute('x2', labelX - 6); line.setAttribute('y2', y);
      line.style.display = stack.discs[band].targetRadius > 0.001 ? '' : 'none';
    });
    // 概要は、広いときは積み木の左に右寄せで、狭いときは左上に置く
    if (isNarrow()) headEl.style.transform = 'translate(12px,12px)';
    // 床の影は左下へ伸びるので、概要は積み木の上端にそろえて影を避ける
    else headEl.style.transform = `translate(${Math.max(12, box.left - LABEL_GAP - headEl.offsetWidth)}px,${Math.max(12, box.top)}px)`;
  }

  // ---- 状態 → 立体と文字
  const updateYearPicker = setupYearPicker(data, (yearIndex) => update({ yearIndex }));
  function applyHighlight() {
    dirty = true;
    stacks.forEach((stack, i) => {
      // 寄っている業種では層ごと、それ以外では積み木ごとに強調する
      stack.setHighlight((band) => state.hover !== null && state.hover.industry === i && (state.focus !== i || state.hover.band === band));
    });
    const hoverBand = state.hover && state.hover.industry === state.focus ? state.hover.band : null;
    rows.forEach(({ el }, band) => el.classList.toggle('on', band === hoverBand));
    canvas.style.cursor = state.hover ? 'pointer' : '';
  }
  function renderText() {
    const y = state.yearIndex;
    const sex = state.sex;
    $('sizetext').textContent = state.size === 'count'
      ? '円盤の面積は、そのレンジにいる人数に比例します（全業種で同じ尺度）。'
      : '円盤の面積は、その業種の中でそのレンジにいる人の割合に比例します。';
    labels.forEach(({ el }, i) => {
      el.innerHTML = `${industries[i].displayName}<small>${formatWorkers(industries[i].workers[sex][y])}</small><small>平均 ${formatSalary(industries[i].salaryAvg[sex][y])}</small>`;
    });
    measureLabels();
    updateYearPicker(y);
    document.querySelectorAll('#sex button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.s === sex));
    document.querySelectorAll('#size button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === state.size));
    $('reset').hidden = state.focus === null;
    if (state.focus !== null) {
      const industry = industries[state.focus];
      const shares = bandShares(industry, sex, y);
      const counts = industry.bands[sex][y];
      headEl.innerHTML = `<h2>${industry.displayName}</h2><p>${data.years[y]}年分・${SEX_LABELS[sex]}</p>
        <dl><div><dt>平均給与</dt><dd>${formatSalary(industry.salaryAvg[sex][y])}</dd></div>
        <div><dt>就労人数</dt><dd>${formatWorkers(industry.workers[sex][y])}</dd></div></dl>`;
      rows.forEach(({ el }, band) => {
        const missing = counts[band] === null;
        el.innerHTML = `<i style="background:${bandColor(state.scheme, band)}"></i><span class="r">${isNarrow() ? shortBandLabel(band) : data.bandLabels[band]}</span>`
          + `<b>${missing ? '—' : formatPercent(shares[band])}</b><span class="n">${missing ? '該当なし' : formatWorkers(counts[band])}</span>`;
      });
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
    stacks.forEach((stack, i) => {
      stack.setRadii(radii(industries[i]), { drop: wave && !reducedMotion, instant: reducedMotion, startDelay: i * WAVE_DELAY });
      // 寄っている間は、その業種だけを残す
      stack.setVisible(state.focus === null || state.focus === i, reducedMotion);
    });
    renderText();
    writeUrl();
  }
  function setFocus(index) {
    update({ focus: index, hover: null });
    if (index === null) goHome(); else goFocus(index);
  }

  // ---- 操作
  document.querySelectorAll('#sex button').forEach((b) => { b.onclick = () => update({ sex: +b.dataset.s }); });
  document.querySelectorAll('#size button').forEach((b) => { b.onclick = () => update({ size: b.dataset.v }); });
  $('reset').onclick = () => setFocus(null);
  $('bandlegend').innerHTML = Array.from({ length: BAND_COUNT }, (unused, i) => BAND_COUNT - 1 - i)
    .map((band) => `<span><i style="background:${bandColor(state.scheme, band)}"></i>${data.bandLabels[band]}</span>`).join('');
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.focus !== null) setFocus(null); });

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
    else if (state.focus !== null) setFocus(null); // 何もない所を押したら全体に戻る
  });
  $('frows').addEventListener('pointerover', (e) => {
    const row = e.target.closest('.frow');
    setHover(row && state.focus !== null ? { industry: state.focus, band: +row.dataset.b } : null);
  });
  $('frows').addEventListener('pointerleave', () => setHover(null));

  // ---- 描画の繰り返し
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
    const shiftGoal = targetViewShift();
    if (viewShift !== shiftGoal) {
      viewShift = reducedMotion || Math.abs(shiftGoal - viewShift) < 0.002 ? shiftGoal : viewShift + (shiftGoal - viewShift) * Math.min(1, dt * 6);
      applyViewShift();
      camera.updateProjectionMatrix();
      moving = true;
    }
    const viewChanged = controls.update();
    // 何かが動いたときだけ描く（止まっている間は電力を使わない）
    if (moving || viewChanged || dirty) {
      renderer.render(scene, camera);
      placeLabels();
      placeFocusUi();
      dirty = false;
    }
    requestAnimationFrame(frame);
  }

  new ResizeObserver(() => {
    layout();
    renderText();
    if (state.focus === null) { camera.position.copy(home.position); controls.target.copy(home.target); } else goFocus(state.focus);
  }).observe(view);
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
