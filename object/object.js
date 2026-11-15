// 試作: 1業種の給与レンジを、回して眺められる積み木のような立体にする。
// 円盤1枚が給与レンジ1つ。半径は平方根スケールなので、円盤の面積が割合に比例する。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BAND_COUNT, DISC, SEX, SEX_LABELS } from '../js/config.js';
import { loadData, bandShares } from '../js/data.js';
import { bandColor, storedScheme } from '../js/colors.js';
import { formatPercent, formatSalary, formatWorkers } from '../js/format.js';
import { readUrlState } from '../js/url.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- 立体の寸法（単位は任意。最大の円盤の半径を 1 とする）
const MAX_RADIUS = 1;
const DISC_HEIGHT = 0.17;
const DISC_GAP = 0.006; // 円盤どうしのわずかな隙間。積んだ物に見せる
const EDGE = 0.028; // 角の丸み
const PEG_RADIUS = 0.035; // 中心の芯棒
const DROP_HEIGHT = 2.6; // 業種を替えたとき、円盤が落ちてくる高さ
const DROP_STAGGER = 0.07; // 円盤1枚ごとの落下の遅れ（秒）

const radiusOf = (share) => MAX_RADIUS * Math.sqrt(share / DISC.maxShare);
const restY = (band) => band * (DISC_HEIGHT + DISC_GAP);

/** 角を丸めた円盤（半径1、高さ DISC_HEIGHT）。x・z を拡大して半径を変える */
function discGeometry() {
  const points = [new THREE.Vector2(0, 0), new THREE.Vector2(1 - EDGE, 0)];
  const corner = (cx, cy, from, to) => {
    for (let i = 1; i <= 6; i += 1) {
      const a = from + ((to - from) * i) / 6;
      points.push(new THREE.Vector2(cx + Math.cos(a) * EDGE, cy + Math.sin(a) * EDGE));
    }
  };
  corner(1 - EDGE, EDGE, -Math.PI / 2, 0);
  corner(1 - EDGE, DISC_HEIGHT - EDGE, 0, Math.PI / 2);
  points.push(new THREE.Vector2(0, DISC_HEIGHT));
  return new THREE.LatheGeometry(points, 96);
}

async function start() {
  const data = await loadData('../data/salary.json');
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
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  // 円盤の色を凡例の色に近く保つため、階調の圧縮はしない
  renderer.toneMapping = THREE.NoToneMapping;

  const stackHeight = restY(BAND_COUNT - 1) + DISC_HEIGHT;
  const target = new THREE.Vector3(0, stackHeight * 0.45, 0);
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

  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9c2b6, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(3.4, 3.9, 4.0); // 斜め前から。張り出した円盤の下にも光が回る
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 7;
  sun.shadow.bias = -0.0004;
  Object.assign(sun.shadow.camera, { left: -2.6, right: 2.6, top: 2.6, bottom: -2.6, near: 0.5, far: 14 });
  scene.add(sun);
  // 影を落とさない補助光。影になった側面の色がつぶれないようにする
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(-3, 1.6, 2.5);
  scene.add(fill);

  // 床は影だけを受ける（色は背景に任せる）
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.2 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // 芯棒
  const peg = new THREE.Mesh(
    new THREE.CylinderGeometry(PEG_RADIUS, PEG_RADIUS, stackHeight + 0.07, 32),
    new THREE.MeshStandardMaterial({ color: 0xcaa574, roughness: 0.7 }),
  );
  peg.position.y = (stackHeight + 0.07) / 2;
  peg.castShadow = true;
  scene.add(peg);

  // 円盤。位置と半径は毎フレーム目標へ近づける
  const geometry = discGeometry();
  const discs = Array.from({ length: BAND_COUNT }, (unused, band) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.band = band;
    scene.add(mesh);
    return { mesh, radius: 0, targetRadius: 0, y: restY(band), velocity: 0, delay: 0 };
  });

  // ---- 状態 → 立体
  function applyShares({ drop }) {
    const industry = data.industries[state.industryIndex];
    const shares = bandShares(industry, state.sex, state.yearIndex);
    discs.forEach((disc, band) => {
      disc.targetRadius = radiusOf(shares[band]);
      if (reducedMotion) { disc.radius = disc.targetRadius; disc.y = restY(band); return; }
      if (drop) {
        // 下の円盤から順に、上から落として積む
        disc.radius = disc.targetRadius;
        disc.y = restY(band) + DROP_HEIGHT;
        disc.velocity = 0;
        disc.delay = band * DROP_STAGGER;
      }
    });
  }
  function applyColors() {
    discs.forEach((disc, band) => disc.mesh.material.color.set(bandColor(state.scheme, band)));
  }
  function applyHover() {
    discs.forEach((disc, band) => disc.mesh.material.emissive.set(band === state.hoverBand ? 0x333333 : 0x000000));
    document.querySelectorAll('#bands tbody tr').forEach((row) => row.classList.toggle('on', +row.dataset.b === state.hoverBand));
  }

  // ---- 状態 → 文字
  function renderPanel() {
    const industry = data.industries[state.industryIndex];
    const y = state.yearIndex;
    const sex = state.sex;
    const shares = bandShares(industry, sex, y);
    const counts = industry.bands[sex][y];
    $('name').textContent = industry.displayName;
    $('meta').textContent = `${data.years[y]}年分・${SEX_LABELS[sex]}`;
    $('stats').innerHTML =
      `<div><dt>平均給与</dt><dd>${formatSalary(industry.salaryAvg[sex][y])}</dd></div>
       <div><dt>就労人数</dt><dd>${formatWorkers(industry.workers[sex][y])}</dd></div>`;
    // 表は立体と同じく、上が高い給与
    $('bands').tBodies[0].innerHTML = Array.from({ length: BAND_COUNT }, (unused, i) => BAND_COUNT - 1 - i).map((band) => {
      const missing = counts[band] === null;
      return `<tr data-b="${band}"><td><i style="background:${bandColor(state.scheme, band)}"></i>${data.bandLabels[band]}</td>
        <td class="p">${missing ? '—' : formatPercent(shares[band])}</td><td class="n">${missing ? '該当なし' : formatWorkers(counts[band])}</td></tr>`;
    }).join('');
    $('yearlabel').innerHTML = `${data.years[y]}<small>年分</small>`;
    $('year').value = y;
    document.querySelectorAll('#yticks .yt').forEach((el, i) => el.classList.toggle('cur', i === y));
    document.querySelectorAll('#sex button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.s === sex));
    $('industry').value = state.industryIndex;
    applyHover();
  }
  function writeUrl() {
    const params = new URLSearchParams();
    params.set('industry', data.industries[state.industryIndex].code);
    if (state.yearIndex !== data.years.length - 1) params.set('year', data.years[state.yearIndex]);
    if (state.sex !== SEX.TOTAL) params.set('sex', ['total', 'male', 'female'][state.sex]);
    try { history.replaceState(null, '', `${location.pathname}#${params}`); } catch (e) { /* 書き換えられない環境でも表示は続ける */ }
  }
  function update(patch, { drop = false } = {}) {
    Object.assign(state, patch);
    applyShares({ drop });
    renderPanel();
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
  $('year').max = data.years.length - 1;
  $('yticks').innerHTML = data.years
    .map((year, i) => `<span class="yt"><i></i><button type="button" tabindex="-1" data-y="${i}" aria-label="${year}年分">${year}</button></span>`).join('');
  $('yticks').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ yearIndex: +b.dataset.y }); });
  $('year').oninput = (e) => update({ yearIndex: +e.target.value });
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
    const hit = raycaster.intersectObjects(discs.filter((d) => d.radius > 0.001).map((d) => d.mesh))[0];
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
  }
  new ResizeObserver(resize).observe(view);
  resize();

  const clock = new THREE.Clock();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    discs.forEach((disc, band) => {
      // 半径: 目標へなめらかに近づける
      disc.radius += (disc.targetRadius - disc.radius) * Math.min(1, dt * 9);
      // 高さ: 重さのあるばね。落ちてきて、少しだけ沈んで止まる
      if (disc.delay > 0) disc.delay -= dt;
      else {
        disc.velocity += ((restY(band) - disc.y) * 150 - disc.velocity * 17) * dt;
        disc.y += disc.velocity * dt;
      }
      disc.mesh.visible = disc.radius > 0.001;
      disc.mesh.scale.set(Math.max(disc.radius, 0.001), 1, Math.max(disc.radius, 0.001));
      disc.mesh.position.y = disc.y;
    });
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  applyColors();
  update({}, { drop: true });
  frame();

  const recolor = () => { applyColors(); renderPanel(); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
  new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

start().catch((error) => {
  console.error(error);
  $('view').innerHTML = '<p class="lede" style="padding:20px">立体を表示できませんでした。WebGL に対応したブラウザで開いてください。</p>';
});
