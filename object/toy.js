// 積み木の立体の共通部品: 円盤の形、1業種ぶんの積み重ね、光と床。
// object/（1業種）と objects/（14業種）の両方が使う。
import * as THREE from 'three';
import { BAND_COUNT } from '../js/config.js';
import { bandColor } from '../js/colors.js';

// ---- 寸法（単位は任意。割合が上限のときの円盤の半径を 1 とする）
export const DISC_HEIGHT = 0.17;
const DISC_GAP = 0.006; // 円盤どうしのわずかな隙間。積んだ物に見せる
const EDGE = 0.028; // 角の丸み
const PEG_RADIUS = 0.035; // 中心の芯棒
const PEG_TOP = 0.07; // 芯棒が最上段から出る長さ
const DROP_HEIGHT = 2.6; // 円盤が落ちてくる高さ
const DROP_STAGGER = 0.07; // 円盤1枚ごとの落下の遅れ（秒）

/** 層 band の円盤の、置かれたときの底の高さ */
export const restY = (band) => band * (DISC_HEIGHT + DISC_GAP);
export const STACK_HEIGHT = restY(BAND_COUNT - 1) + DISC_HEIGHT;

/** 角を丸めた円盤（半径1）。x・z を拡大して半径を変える */
export function createDiscGeometry() {
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
  return new THREE.LatheGeometry(points, 72);
}

const pegGeometry = new THREE.CylinderGeometry(PEG_RADIUS, PEG_RADIUS, STACK_HEIGHT + PEG_TOP, 24);
const pegMaterial = new THREE.MeshStandardMaterial({ color: 0xcaa574, roughness: 0.7 });

/**
 * 1業種ぶんの積み重ね。芯棒に9枚の円盤を通す。
 * 半径と高さは目標値を持ち、step() のたびに目標へ近づく。
 */
export function createStack(geometry, userData = {}) {
  const group = new THREE.Group();
  const peg = new THREE.Mesh(pegGeometry, pegMaterial);
  peg.position.y = (STACK_HEIGHT + PEG_TOP) / 2;
  peg.castShadow = true;
  group.add(peg);

  const discs = Array.from({ length: BAND_COUNT }, (unused, band) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { ...userData, band };
    group.add(mesh);
    return { mesh, radius: 0, targetRadius: 0, y: restY(band), velocity: 0, delay: 0 };
  });

  // 大きさ。ほかの業種に寄っている間は、目標を 0 にして、その場で縮めて消す。
  // 半透明にして消すと、円盤どうしや芯棒が透けて見えてしまうので、物として縮める
  let scale = 1;
  let targetScale = 1;
  function applyScale() {
    group.scale.setScalar(Math.max(scale, 0.0001));
    group.visible = scale > 0.01;
  }

  return {
    group,
    discs,
    /** 形があり、見えている円盤（当たり判定に使う） */
    get meshes() { return scale > 0.5 ? discs.filter((d) => d.radius > 0.001).map((d) => d.mesh) : []; },
    /** いちばん大きい円盤の半径（画面上の占める範囲を求めるのに使う） */
    get maxRadius() { return Math.max(...discs.map((d) => d.targetRadius)); },
    get visible() { return targetScale > 0.5; },
    /** 見せる・消すを切り替える。instant なら動きなし */
    setVisible(visible, instant = false) {
      targetScale = visible ? 1 : 0;
      if (instant) { scale = targetScale; applyScale(); }
    },
    setColors(scheme) {
      discs.forEach((disc, band) => disc.mesh.material.color.set(bandColor(scheme, band)));
    },
    /** highlight(band) が真の円盤を明るくする */
    setHighlight(highlight) {
      discs.forEach((disc, band) => disc.mesh.material.emissive.set(highlight(band) ? 0x303030 : 0x000000));
    },
    /**
     * 各層の半径の目標を与える。
     * drop: 下の円盤から順に上から落として積む（startDelay 秒後に始める） / instant: 動きなしで即座に反映
     */
    setRadii(radii, { drop = false, instant = false, startDelay = 0 } = {}) {
      discs.forEach((disc, band) => {
        disc.targetRadius = radii[band];
        if (instant) {
          disc.radius = disc.targetRadius;
          disc.y = restY(band);
          disc.velocity = 0;
          disc.delay = 0;
        } else if (drop) {
          disc.radius = disc.targetRadius;
          disc.y = restY(band) + DROP_HEIGHT;
          disc.velocity = 0;
          disc.delay = startDelay + band * DROP_STAGGER;
        }
      });
    },
    /** dt 秒ぶん進める。まだ動いている円盤があれば true を返す */
    step(dt) {
      let moving = false;
      if (scale !== targetScale) {
        scale += (targetScale - scale) * Math.min(1, dt * 9);
        if (Math.abs(targetScale - scale) < 0.004) scale = targetScale;
        applyScale();
        moving = true;
      }
      discs.forEach((disc, band) => {
        // 半径: 目標へなめらかに近づける
        disc.radius += (disc.targetRadius - disc.radius) * Math.min(1, dt * 9);
        // 高さ: 重さのあるばね。落ちてきて、少しだけ沈んで止まる
        if (disc.delay > 0) disc.delay -= dt;
        else {
          disc.velocity += ((restY(band) - disc.y) * 150 - disc.velocity * 17) * dt;
          disc.y += disc.velocity * dt;
        }
        disc.mesh.visible = disc.radius > 0.001 && disc.delay <= 0;
        const r = Math.max(disc.radius, 0.001);
        disc.mesh.scale.set(r, 1, r);
        disc.mesh.position.y = disc.y;
        if (disc.delay > 0 || Math.abs(disc.targetRadius - disc.radius) > 1e-4
          || Math.abs(restY(band) - disc.y) > 1e-4 || Math.abs(disc.velocity) > 1e-3) moving = true;
      });
      return moving;
    },
  };
}

/**
 * 光と床を場面に加える。extent は、影を落とす範囲の半径（場面の広さ）。
 * 円盤の上面が凡例の色とほぼ同じ明るさになるよう、光の強さを決めている。
 */
export function addLightsAndFloor(scene, extent) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9c2b6, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(3.4, 3.9, 4.0).multiplyScalar(Math.max(1, extent / 2.6)); // 斜め前から。張り出した円盤の下にも光が回る
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 7;
  sun.shadow.bias = -0.0004;
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 0.5, far: extent * 6 });
  scene.add(sun);
  // 影を落とさない補助光。影になった側面の色がつぶれないようにする
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(-3, 1.6, 2.5);
  scene.add(fill);
  // 床は影だけを受ける（色は背景に任せる）
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.2 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
}

/** 階調の圧縮をしない描画器。円盤の色を凡例の色に近く保つ */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  return renderer;
}

/** 再生で年を進める間隔（ミリ秒） */
const PLAY_INTERVAL = 1300;

/**
 * 年の選択（スライダー、年ラベル、再生ボタン）を組み立てる。年を替えるたびに onPick(yearIndex) を呼ぶ。
 * 再生は一定の間隔で1年ずつ進め、最後の年で止まる。スライダーや年ラベルで年を選ぶと、再生は止まる
 */
export function setupYearPicker(data, onPick) {
  const slider = document.getElementById('year');
  const ticks = document.getElementById('yticks');
  const playButton = document.getElementById('play');
  const lastYear = data.years.length - 1;
  let current = lastYear;
  let timer = null;
  function stopPlay() {
    clearInterval(timer);
    timer = null;
    playButton.textContent = '▶ 再生';
    playButton.setAttribute('aria-pressed', 'false');
  }
  playButton.onclick = () => {
    if (timer) { stopPlay(); return; }
    // 最後の年にいるときは、最初の年から始める
    if (current >= lastYear) onPick(0);
    playButton.textContent = '■ 停止';
    playButton.setAttribute('aria-pressed', 'true');
    timer = setInterval(() => {
      if (current >= lastYear) { stopPlay(); return; }
      onPick(current + 1);
      if (current >= lastYear) stopPlay();
    }, PLAY_INTERVAL);
  };
  /** 手で年を選んだとき: 再生を止めてから反映する */
  const pickByHand = (yearIndex) => { if (timer) stopPlay(); onPick(yearIndex); };
  slider.max = lastYear;
  ticks.innerHTML = data.years
    .map((year, i) => `<span class="yt"><i></i><button type="button" tabindex="-1" data-y="${i}" aria-label="${year}年分">'${String(year).slice(-2)}</button></span>`).join('');
  ticks.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pickByHand(+b.dataset.y); });
  slider.oninput = (e) => pickByHand(+e.target.value);
  return (yearIndex) => {
    current = yearIndex;
    document.getElementById('yearlabel').innerHTML = `${data.years[yearIndex]}<small>年分</small>`;
    slider.value = yearIndex;
    ticks.querySelectorAll('.yt').forEach((el, i) => el.classList.toggle('cur', i === yearIndex));
  };
}

/** 給与レンジの内訳の表（上が高い給与）の行を返す */
export function bandTableRows(data, industry, sex, yearIndex, shares, scheme, { formatPercent, formatWorkers }) {
  const counts = industry.bands[sex][yearIndex];
  return Array.from({ length: BAND_COUNT }, (unused, i) => BAND_COUNT - 1 - i).map((band) => {
    const missing = counts[band] === null;
    return `<tr data-b="${band}"><td><i style="background:${bandColor(scheme, band)}"></i>${data.bandLabels[band]}</td>
      <td class="p">${missing ? '—' : formatPercent(shares[band])}</td><td class="n">${missing ? '該当なし' : formatWorkers(counts[band])}</td></tr>`;
  }).join('');
}
