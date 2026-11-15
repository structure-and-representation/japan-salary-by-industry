// 試作: 14業種の積み木を台の上に並べ、全体を回して見比べる。
// 円盤の面積は「業種内の割合」か「人数」を切り替えられる。人数にすると全業種で同じ尺度になる。
// 積み木を選ぶとその業種だけが残り、左に業種の概要、右に各層の給与レンジ・割合・人数が出る。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BAND_COUNT, DISC, SEX, SEX_LABELS, SEX_KEYS } from '../js/config.js';
import { loadData, bandShares, bandCounts } from '../js/data.js';
import { bandColor, storedScheme, storeScheme, DEFAULT_SCHEME } from '../js/colors.js';
import { formatPercent, formatSalary, formatWorkers } from '../js/format.js';
import { readUrlState } from '../js/url.js';
import { STACK_HEIGHT, DISC_HEIGHT, restY, createDiscGeometry, createStack, addLightsAndFloor, createRenderer, setupYearPicker } from '../object/toy.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- 並べ方（単位は円盤の最大半径を約1とする）
// 積み木の横の間隔。行が3つ以上（幅の狭い画面）では、業種名どうしが横でぶつからないよう広げる
const cellWidthFor = (rows) => (rows <= 2 ? 2.1 : 2.6);
const CELL_DEPTH = 6.6; // 奥行きの間隔の下限。業種名が入らないときは、これより広げる
const SHARE_MAX_RADIUS = 0.85; // 割合が上限（60%）のときの半径
const COUNT_MAX_RADIUS = 0.98; // 人数が全体で最大の層の半径
// 視線の傾き（上から見下ろす度合い）。行が2つまでなら横寄りから、3つ以上（幅の狭い画面）なら
// 奥の行が小さくなりすぎないよう上寄りから見る
const viewElevation = (rows) => (rows <= 2 ? 0.65 : 1.0);
const WAVE_DELAY = 0.09; // 最初に積むとき、業種1つごとの遅れ（秒）
/** 画面の縦横比から、1行に並べる数を決める */
const columnsFor = (aspect, count) => (aspect > 3 ? count : aspect > 1.05 ? Math.ceil(count / 2) : 4);

// ---- 業種に寄ったときの組み方
const FOCUS_HEIGHT_RATIO = 0.5; // 積み木の高さが、表示領域の高さに占める割合
const FOCUS_WIDTH_RATIO = 0.42; // 積み木の幅が、表示領域の幅に占める割合の上限
const NARROW_VIEW = 620; // 表示領域の幅がこれより狭いとき、詰めた組み方にする
const LABEL_GAP = 30; // 積み木の端から、層のラベルまでの距離（px）
const COMPARE_AZIMUTH_RANGE = 1.0; // 男女を並べたとき、左右に回せる角度（ラジアン）。左右が入れ替わらない範囲にする
const TIGHT_CELL_PX = 112; // 積み木の間隔がこれ（px）より狭いとき、業種名の幅を詰める
const LABEL_MARGIN = 6;
const LABEL_OFFSETS = [5, 11, 17, 23, 29, 35]; // 業種名を積み木からどれだけ離して置くか（px）。近い順に試す // 業種名と、ほかの積み木との間に空ける余白（px）
/** 幅が狭いときの給与レンジ名 */
const shortBandLabel = (band) => (band === 0 ? '100万以下' : band === BAND_COUNT - 1 ? '800万超' : `${band}00〜${band + 1}00万`);
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

async function start() {
  const data = await loadData();
  const industries = data.industries;
  const count = industries.length;
  const fromUrl = readUrlState(data);
  const state = {
    size: new URLSearchParams(location.hash.slice(1)).get('size') === 'count' ? 'count' : 'share',
    yearIndex: fromUrl.yearIndex ?? data.years.length - 1,
    sex: fromUrl.sex ?? SEX.TOTAL,
    scheme: fromUrl.scheme ?? storedScheme(),
    focus: fromUrl.industryIndex ?? null, // 寄っている業種の添字
    compare: fromUrl.compare ?? false, // 寄ったとき、男性と女性の積み木を左右に並べるか
    hover: null, // { industry, band }
  };

  // 人数の尺度: 全業種・全年・男女計で最大の層を基準にする。年や対象を替えても同じ尺度で比べられる
  const maxCount = Math.max(...industries.flatMap((d) => d.bands[SEX.TOTAL].flatMap((bands) => bands.map((v) => v ?? 0))));
  const radii = (industry, sex) => (state.size === 'count'
    ? bandCounts(industry, sex, state.yearIndex).map((n) => COUNT_MAX_RADIUS * Math.sqrt(n / maxCount))
    : bandShares(industry, sex, state.yearIndex).map((s) => SHARE_MAX_RADIUS * Math.sqrt(s / DISC.maxShare)));
  /** 寄った業種で男女を並べているか */
  const comparing = () => state.focus !== null && state.compare;

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
  // 男女を並べるときに使う、もう1つの積み木（女性）。ふだんは隠しておく
  const mate = createStack(geometry, { industry: -1 });
  mate.setVisible(false, true);
  scene.add(mate.group);
  // 積み木の置き場所。home は格子の位置、goal はいま向かっている位置（男女を並べる間は左右にずれる）
  const homes = stacks.map(() => new THREE.Vector3());
  const goals = stacks.map(() => new THREE.Vector3());

  // 画角を狭くして、端の積み木が傾いて見えるのを抑える
  const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 500);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.screenSpacePanning = false; // 平行移動は床に沿って
  controls.minDistance = 2.6;
  controls.maxDistance = 200;
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
  // 幅が狭いとき、寄った積み木を画面の中でずらして、ラベルの場所を空ける。
  // 1つだけなら左へ（右にラベル）、男女を並べるなら上へ（下にラベル）。値は表示領域に対する割合
  const viewShift = { x: 0, y: 0 };
  const targetViewShift = () => {
    if (state.focus === null || !isNarrow()) return { x: 0, y: 0 };
    return state.compare ? { x: 0, y: 0.09 } : { x: 0.2, y: 0 };
  };
  function applyViewShift() {
    if (Math.abs(viewShift.x) < 0.001 && Math.abs(viewShift.y) < 0.001) camera.clearViewOffset();
    else camera.setViewOffset(viewSize.w, viewSize.h, viewShift.x * viewSize.w, viewShift.y * viewSize.h, viewSize.w, viewSize.h);
  }

  // ---- 並べ方と全体の視点
  let home = null;
  let grid = { columns: 1, rows: 1 };
  function layout() {
    viewSize = { w: view.clientWidth, h: view.clientHeight };
    renderer.setSize(viewSize.w, viewSize.h, false);
    camera.aspect = viewSize.w / viewSize.h;
    applyViewShift();
    camera.updateProjectionMatrix();
    dirty = true;
    const columns = columnsFor(camera.aspect, count);
    const rows = Math.ceil(count / columns);
    grid = { columns, rows };
  }
  /**
   * 積み木の置き場所と、全体の視点を決める。
   * 積み木と、いちばん手前の行の業種名までが表示領域に収まり、
   * 奥の行の業種名が手前の行の積み木に重ならないだけ、行の間隔を空ける。
   * 業種名の高さ（px）を使うので、文字を入れたあとに呼ぶ
   */
  function arrange(retried = false) {
    const direction = new THREE.Vector3(0, viewElevation(grid.rows), 1).normalize();
    const sin = direction.y; // 見下ろす角度の正弦
    const cos = Math.sqrt(1 - sin * sin);
    const labelHeight = Math.max(...labels.map((label) => label.height)) + 8;
    // 床の上で積み木が占める横の範囲（端の積み木の半径ぶんを含む）
    const cellWidth = cellWidthFor(grid.rows);
    const width = (grid.columns - 1) * cellWidth + 2;
    const stackRise = STACK_HEIGHT * cos; // 積み木の高さが、画面上で上へ伸びるぶん
    // 行の間隔と画面上の縮尺は互いに依存するので、数回くり返して決める
    let cellDepth = CELL_DEPTH;
    let depth;
    let pxPerUnit;
    for (let pass = 0; pass < 5; pass += 1) {
      depth = (grid.rows - 1) * cellDepth + 2;
      // 画面上の縦の広がり = 奥行き + 奥の行の積み木の高さ + 手前の行の業種名。
      // 手前の行は遠近法で大きく見えるので、横は余裕を持たせる
      pxPerUnit = Math.min((0.88 * viewSize.w) / width, (0.96 * viewSize.h - labelHeight) / (depth * sin + stackRise));
      // 奥の行の足元から手前の行の積み木の上端までに、業種名が入るだけの間隔
      const needed = (labelHeight + LABEL_MARGIN * 2 + LABEL_OFFSETS.at(-1)) / (pxPerUnit * sin) + stackRise / sin + 1.9;
      if (grid.rows < 2 || needed <= cellDepth) break;
      cellDepth = needed;
    }
    // 積み木の間隔が画面上で狭いときは、業種名の幅を詰める。幅が変わると高さも変わるので、測り直してやり直す
    const tight = cellWidth * pxPerUnit < TIGHT_CELL_PX;
    if (tight !== view.classList.contains('tight')) {
      view.classList.toggle('tight', tight);
      measureLabels();
      if (!retried) { arrange(true); return; }
    }
    stacks.forEach((stack, i) => {
      const column = i % grid.columns;
      const row = Math.floor(i / grid.columns);
      homes[i].set((column - (grid.columns - 1) / 2) * cellWidth, 0, (row - (grid.rows - 1) / 2) * cellDepth);
      goals[i].copy(homes[i]);
      stack.group.position.copy(homes[i]);
    });
    let distance = viewSize.h / 2 / (pxPerUnit * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    // 上に積み木の高さ、下に業種名がはみ出すぶんの差だけ、注視点を前後にずらして上下の余白をそろえる
    const target = new THREE.Vector3(0, 0, (labelHeight / pxPerUnit - stackRise) / (2 * sin));
    // ここまでは遠近法を無視した見積もり。手前の行は大きく映るので、実際に投影して確かめ、
    // 積み木か業種名がはみ出すあいだは少しずつ離れる（円盤が最大の大きさだとして確かめる）
    const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
    const edgePoints = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const fits = () => homes.every((at) => edgePoints.every(([dx, dz]) => [0, STACK_HEIGHT].every((y) => {
      const p = toScreen(at.x + dx, y, at.z + dz);
      return p.x > 4 && p.x < viewSize.w - 4 && p.y > 4 && p.y < viewSize.h - 4 - (y === 0 ? labelHeight : 0);
    })));
    for (let pass = 0; pass < 16; pass += 1) {
      camera.position.copy(target).addScaledVector(direction, distance);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      if (fits()) break;
      distance *= 1.05;
    }
    camera.position.copy(saved.position);
    camera.quaternion.copy(saved.quaternion);
    camera.updateMatrixWorld();
    home = { position: target.clone().addScaledVector(direction, distance), target };
  }
  /** 全体の視点へ戻る */
  const goHome = () => { releasePair(); flyTo(home.position.clone(), home.target.clone()); };
  /** 全部の積み木を格子の位置へ戻し、回せる範囲の制限を外す */
  function releasePair() {
    goals.forEach((goal, i) => goal.copy(homes[i]));
    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;
    dirty = true;
  }
  function goFocus(index) {
    const at = homes[index];
    const target = new THREE.Vector3(at.x, STACK_HEIGHT * 0.5, at.z);
    const direction = camera.position.clone().sub(controls.target).normalize();
    // 真上に近い向きから寄ると層が重なって見えるので、見下ろす角度を抑える
    direction.y = Math.min(direction.y, 0.5);
    direction.normalize();
    releasePair();
    // 積み木が表示領域に対して決めた大きさになる距離まで、いま見ている方向のまま寄る
    let pxPerUnit = Math.min((FOCUS_HEIGHT_RATIO * viewSize.h) / STACK_HEIGHT, (FOCUS_WIDTH_RATIO * viewSize.w) / 2);
    if (state.compare) {
      // 男女を並べる: 左に男性、右に女性を置く。
      // 広いときは間にラベルの列を置けるだけ離す。狭いときは詰めて並べ、ラベルは下に置く
      const stackWidth = 2 * 0.95;
      let offset;
      if (isNarrow()) {
        const gap = 0.3;
        pxPerUnit = (viewSize.w * 0.92) / (2 * stackWidth + gap);
        offset = (stackWidth + gap) / 2;
      } else {
        const columnWidth = compareColumnWidth() + LABEL_GAP * 2;
        // 遠近法で手前が大きく見えるぶん、余裕を持たせる
        pxPerUnit = 0.84 * Math.min((FOCUS_HEIGHT_RATIO * viewSize.h) / STACK_HEIGHT, (viewSize.w - columnWidth - 24) / (2 * stackWidth));
        offset = columnWidth / 2 / pxPerUnit + stackWidth / 2;
      }
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize(); // 画面の右にあたる向き
      goals[index].copy(at).addScaledVector(right, -offset);
      mate.group.position.copy(at).addScaledVector(right, offset);
      // 左右が入れ替わらないよう、回せる範囲を限る
      const azimuth = Math.atan2(direction.x, direction.z);
      controls.minAzimuthAngle = azimuth - COMPARE_AZIMUTH_RANGE;
      controls.maxAzimuthAngle = azimuth + COMPARE_AZIMUTH_RANGE;
    }
    const distance = viewSize.h / 2 / (pxPerUnit * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
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
  /** 矩形が、円盤（上面と底面の楕円と、その間）に重なるか。円盤のまわりに余白ぶんの幅を持たせる */
  function rectHitsDisc(rect, layer) {
    const rx = layer.rx + LABEL_MARGIN;
    const ry = layer.ry + LABEL_MARGIN;
    if (rect.left < layer.cx + rx && rect.right > layer.cx - rx && rect.top < layer.bottomY && rect.bottom > layer.topY) return true;
    return [layer.topY, layer.bottomY].some((cy) => {
      const px = Math.min(Math.max(layer.cx, rect.left), rect.right);
      const py = Math.min(Math.max(cy, rect.top), rect.bottom);
      return ((px - layer.cx) / rx) ** 2 + ((py - cy) / ry) ** 2 < 1;
    });
  }
  function placeLabels() {
    // 積み木ごとの、画面上の形と上下の端
    const shapes = stacks.map((stack) => {
      if (!stack.visible) return null;
      const shape = stackOnScreen(stack);
      const layers = shape.layers.filter((layer) => layer.exists);
      if (!layers.length || shape.behind) return null;
      return {
        layers,
        centerX: shape.baseX,
        top: Math.min(...layers.map((layer) => layer.topY - layer.ry)),
        bottom: Math.max(...layers.map((layer) => layer.bottomY + layer.ry)),
      };
    });
    const placed = [];
    // 手前の積み木から順に場所を取る
    const order = stacks.map((unused, i) => i).sort((a, b) => (shapes[b]?.bottom ?? 0) - (shapes[a]?.bottom ?? 0));
    order.forEach((i) => {
      const label = labels[i];
      const shape = shapes[i];
      let rect = null;
      if (state.focus === null && shape) {
        // 横は表示領域からはみ出さないよう寄せる
        const left = Math.min(Math.max(shape.centerX - label.width / 2, 2), viewSize.w - label.width - 2);
        const at = (top) => ({ left, right: left + label.width, top, bottom: top + label.height });
        const free = (r) => r.top > 0 && r.bottom < viewSize.h
          && shapes.every((other, j) => j === i || !other || !other.layers.some((layer) => rectHitsDisc(r, layer)))
          && placed.every((other) => !overlaps(r, other));
        // 積み木のすぐ下。隣の積み木の張り出しに重なるなら、少しずつ下げる。
        // それでも重なるなら上に置き、上も重なるなら隠す
        const candidates = [
          ...LABEL_OFFSETS.map((offset) => at(shape.bottom + offset)),
          ...LABEL_OFFSETS.map((offset) => at(shape.top - label.height - offset)),
        ];
        rect = candidates.find(free) ?? null;
      }
      label.el.style.opacity = rect ? 1 : 0;
      if (rect) { label.el.style.transform = `translate(${rect.left}px,${rect.top}px)`; placed.push(rect); }
    });
  }

  // ---- 寄ったときの表示。積み木の位置に合わせて、概要と各層のラベルを置く
  //   1つだけ: 左に概要、右に各層のラベル
  //   男女を並べる: 左に男性、右に女性の積み木。その間に各層のラベル、上に概要
  const focusUi = $('focusui');
  const headEl = $('fhead');
  const leads = $('leads');
  const sexCaptions = [$('fmale'), $('ffemale')];
  const newLine = () => { const line = document.createElementNS('http://www.w3.org/2000/svg', 'line'); leads.append(line); return line; };
  const rows = Array.from({ length: BAND_COUNT }, (unused, band) => {
    const el = document.createElement('div');
    el.className = 'frow';
    el.dataset.b = band;
    $('frows').append(el);
    return { el, line: newLine(), line2: newLine() };
  });
  /** 男女を並べるときの、中央のラベルの列の幅（px）。広いとき用。CSS の .compare .frow の幅と合わせる */
  const compareColumnWidth = () => 392;

  /** 積み木の各層が画面上で占める形と、左右の端の位置 */
  function stackOnScreen(stack) {
    const { x, z } = stack.group.position;
    // カメラから見て右向きの、床に沿った方向
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    const tilt = Math.abs(camera.getWorldDirection(new THREE.Vector3()).y); // 見下ろす角度の正弦 = 楕円のつぶれ具合
    const layers = stack.discs.map((disc, band) => {
      const r = Math.max(disc.radius, 0.02);
      const y = restY(band) + DISC_HEIGHT / 2;
      const rightEdge = toScreen(x + right.x * r, y, z + right.z * r);
      const leftEdge = toScreen(x - right.x * r, y, z - right.z * r);
      const top = toScreen(x, restY(band) + DISC_HEIGHT, z);
      const bottom = toScreen(x, restY(band), z);
      const rx = (rightEdge.x - leftEdge.x) / 2;
      return { rightEdge, leftEdge, cx: (top.x + bottom.x) / 2, topY: top.y, bottomY: bottom.y, rx, ry: rx * tilt, exists: disc.targetRadius > 0.001, behind: top.behind || bottom.behind };
    });
    const base = toScreen(x, 0, z);
    // 引き出し線が円盤の上を横切らないよう、線は「その高さで見えている輪郭」から出す
    const reach = (layer, y) => {
      if (!layer.exists) return null;
      const outside = y < layer.topY ? layer.topY - y : y > layer.bottomY ? y - layer.bottomY : 0;
      return outside >= layer.ry ? null : layer.rx * Math.sqrt(1 - (outside / layer.ry) ** 2);
    };
    return {
      layers,
      baseX: base.x, // 積み木の足元の中心
      behind: base.behind || layers.some((layer) => layer.behind),
      /** 高さ y で、いちばん右（side=1）または左（side=-1）に見えている輪郭の x */
      silhouetteX(y, side) {
        const xs = layers.map((layer) => { const half = reach(layer, y); return half === null ? null : layer.cx + side * half; }).filter((v) => v !== null);
        return xs.length ? (side > 0 ? Math.max(...xs) : Math.min(...xs)) : null;
      },
    };
  }
  /** ラベルの行を縦に等間隔に置く高さを返す。層の見かけの間隔が狭いときは、読める行間まで広げる */
  function rowYs(layerYs, rowHeight) {
    const spacing = Math.max(Math.abs(layerYs[0] - layerYs[BAND_COUNT - 1]) / (BAND_COUNT - 1), rowHeight + 3);
    const middle = (layerYs[0] + layerYs[BAND_COUNT - 1]) / 2;
    return layerYs.map((unused, band) => middle - (band - (BAND_COUNT - 1) / 2) * spacing);
  }
  const setLine = (line, x1, y1, x2, y2, shown) => {
    line.style.display = shown ? '' : 'none';
    if (shown) { line.setAttribute('x1', x1); line.setAttribute('y1', y1); line.setAttribute('x2', x2); line.setAttribute('y2', y2); }
  };

  function placeFocusUi() {
    const focused = state.focus !== null;
    focusUi.classList.toggle('on', focused);
    focusUi.classList.toggle('narrow', isNarrow());
    focusUi.classList.toggle('compare', comparing());
    if (!focused) return;
    const main = stacks[state.focus];
    const rowHeight = rows[0].el.offsetHeight;
    const rowWidth = rows[0].el.offsetWidth;

    if (!state.compare) {
      const shape = stackOnScreen(main);
      const edges = shape.layers.map((layer) => layer.rightEdge);
      const ys = rowYs(edges.map((p) => p.y), rowHeight);
      const labelX = Math.min(Math.max(...edges.map((p) => p.x)) + LABEL_GAP, viewSize.w - rowWidth - 8);
      rows.forEach(({ el, line, line2 }, band) => {
        el.style.transform = `translate(${labelX}px,${ys[band] - rowHeight / 2}px)`;
        const from = Math.max(edges[band].x, shape.silhouetteX(edges[band].y, 1) ?? edges[band].x);
        setLine(line, from + 4, edges[band].y, labelX - 6, ys[band], shape.layers[band].exists);
        setLine(line2, 0, 0, 0, 0, false);
      });
      // 概要は、広いときは積み木の左に右寄せで、狭いときは左上に置く。
      // 床の影は左下へ伸びるので、積み木の上端にそろえて影を避ける
      const box = screenBox(main);
      headEl.style.transform = isNarrow()
        ? 'translate(12px,12px)'
        : `translate(${Math.max(12, box.left - LABEL_GAP - headEl.offsetWidth)}px,${Math.max(12, box.top)}px)`;
      return;
    }

    // 「男性」「女性」は、それぞれの積み木の真上に置く
    [main, mate].forEach((stack, i) => {
      const box = screenBox(stack);
      sexCaptions[i].style.transform = `translate(${(box.left + box.right) / 2 - sexCaptions[i].offsetWidth / 2}px,${box.top - sexCaptions[i].offsetHeight - 8}px)`;
    });
    if (isNarrow()) {
      // 狭いとき: ラベルは積み木の下に表としてまとめる（引き出し線はなし）。概要は左上
      const step = rowHeight + 2;
      const top = viewSize.h - BAND_COUNT * step - 50;
      rows.forEach(({ el, line, line2 }, band) => {
        el.style.transform = `translate(${(viewSize.w - rowWidth) / 2}px,${top + (BAND_COUNT - 1 - band) * step}px)`;
        setLine(line, 0, 0, 0, 0, false);
        setLine(line2, 0, 0, 0, 0, false);
      });
      headEl.style.transform = 'translate(12px,12px)';
      return;
    }

    // 広いとき: 左が男性（寄った業種の積み木）、右が女性（もう1つの積み木）。その間にラベルの列
    const left = stackOnScreen(main);
    const right = stackOnScreen(mate);
    const leftEdges = left.layers.map((layer) => layer.rightEdge);
    const rightEdges = right.layers.map((layer) => layer.leftEdge);
    const ys = rowYs(leftEdges.map((p, band) => (p.y + rightEdges[band].y) / 2), rowHeight);
    const centerX = (Math.max(...leftEdges.map((p) => p.x)) + Math.min(...rightEdges.map((p) => p.x))) / 2;
    const rowLeft = centerX - rowWidth / 2;
    rows.forEach(({ el, line, line2 }, band) => {
      el.style.transform = `translate(${rowLeft}px,${ys[band] - rowHeight / 2}px)`;
      const fromLeft = Math.max(leftEdges[band].x, left.silhouetteX(leftEdges[band].y, 1) ?? leftEdges[band].x);
      const fromRight = Math.min(rightEdges[band].x, right.silhouetteX(rightEdges[band].y, -1) ?? rightEdges[band].x);
      setLine(line, fromLeft + 4, leftEdges[band].y, rowLeft - 4, ys[band], left.layers[band].exists);
      setLine(line2, fromRight - 4, rightEdges[band].y, rowLeft + rowWidth + 4, ys[band], right.layers[band].exists);
    });
    // 概要は、ラベルの列の上に中央寄せで置く
    headEl.style.transform = `translate(${centerX - headEl.offsetWidth / 2}px,${Math.max(8, Math.min(...ys) - rowHeight / 2 - headEl.offsetHeight - 18)}px)`;
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
    mate.setHighlight((band) => band === hoverBand);
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
    // 「男女を並べる」は、業種に寄っているときだけ使える
    document.querySelectorAll('#sex button').forEach((b) => {
      const isPair = b.dataset.s === 'compare';
      b.setAttribute('aria-pressed', isPair ? comparing() : !comparing() && +b.dataset.s === sex);
      if (isPair) b.disabled = state.focus === null;
    });
    document.querySelectorAll('#size button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === state.size));
    $('reset').hidden = state.focus === null;
    if (state.focus !== null) {
      const industry = industries[state.focus];
      const swatch = (band) => `<i style="background:${bandColor(state.scheme, band)}"></i>`;
      const range = (band) => (isNarrow() ? shortBandLabel(band) : data.bandLabels[band]);
      // 元の統計表に数値がない層は「該当なし」
      const cells = (s) => {
        const shares = bandShares(industry, s, y);
        const counts = industry.bands[s][y];
        return (band) => ({
          percent: counts[band] === null ? '—' : formatPercent(shares[band]),
          count: counts[band] === null ? '該当なし' : formatWorkers(counts[band]),
        });
      };
      const stat = (title, format, values) => (state.compare
        ? `<div><dt>${title}</dt><dd>男性 ${format(values[SEX.MALE][y])}<span>/</span>女性 ${format(values[SEX.FEMALE][y])}</dd></div>`
        : `<div><dt>${title}</dt><dd>${format(values[sex][y])}</dd></div>`);
      headEl.innerHTML = `<h2>${industry.displayName}</h2><p>${data.years[y]}年分・${state.compare ? '男女別' : SEX_LABELS[sex]}</p>
        <dl>${stat('平均給与', formatSalary, industry.salaryAvg)}${stat('就労人数', formatWorkers, industry.workers)}</dl>`;
      if (state.compare) {
        const male = cells(SEX.MALE);
        const female = cells(SEX.FEMALE);
        rows.forEach(({ el }, band) => {
          const m = male(band);
          const f = female(band);
          el.innerHTML = `<span class="n">${m.count}</span><b>${m.percent}</b><span class="r">${swatch(band)}${range(band)}</span><b>${f.percent}</b><span class="n">${f.count}</span>`;
        });
      } else {
        const one = cells(sex);
        rows.forEach(({ el }, band) => {
          const c = one(band);
          el.innerHTML = `${swatch(band)}<span class="r">${range(band)}</span><b>${c.percent}</b><span class="n">${c.count}</span>`;
        });
      }
    }
    applyHighlight();
  }
  function writeUrl() {
    const params = new URLSearchParams();
    if (state.size === 'count') params.set('size', 'count');
    if (state.yearIndex !== data.years.length - 1) params.set('year', data.years[state.yearIndex]);
    if (state.sex !== SEX.TOTAL) params.set('sex', SEX_KEYS[state.sex]);
    if (state.focus !== null) params.set('industry', industries[state.focus].code);
    if (comparing()) params.set('compare', '1');
    if (state.scheme !== DEFAULT_SCHEME) params.set('scheme', state.scheme);
    const hash = params.toString();
    try { history.replaceState(null, '', location.pathname + (hash ? `#${hash}` : '')); } catch (e) { /* 書き換えられない環境でも表示は続ける */ }
  }
  /** wave: 端の業種から順に、円盤を落として積む（最初の表示） */
  function update(patch, { wave = false } = {}) {
    Object.assign(state, patch);
    stacks.forEach((stack, i) => {
      // 男女を並べている業種の積み木は、男性を表す
      const sex = comparing() && state.focus === i ? SEX.MALE : state.sex;
      stack.setRadii(radii(industries[i], sex), { drop: wave && !reducedMotion, instant: reducedMotion, startDelay: i * WAVE_DELAY });
      // 寄っている間は、その業種だけを残す
      stack.setVisible(state.focus === null || state.focus === i, reducedMotion);
    });
    if (comparing()) mate.setRadii(radii(industries[state.focus], SEX.FEMALE), { instant: reducedMotion || !mate.visible });
    mate.setVisible(comparing(), reducedMotion);
    mate.setColors(state.scheme);
    renderText();
    writeUrl();
  }
  function setFocus(index) {
    // 全体に戻るときは、男女を並べるのもやめる
    update(index === null ? { focus: null, hover: null, compare: false } : { focus: index, hover: null });
    if (index === null) goHome(); else goFocus(index);
  }

  // ---- 操作
  // 対象を選び直したら、男女を並べるのはやめて、その対象の積み木に戻す
  document.querySelectorAll('#sex button').forEach((b) => {
    b.onclick = () => {
      const wasComparing = comparing();
      if (b.dataset.s === 'compare') update({ compare: true });
      else update({ sex: +b.dataset.s, compare: false });
      if (comparing() !== wasComparing) goFocus(state.focus);
    };
  });
  document.querySelectorAll('#size button').forEach((b) => { b.onclick = () => update({ size: b.dataset.v }); });
  $('reset').onclick = () => setFocus(null);
  // 配色を替えたら、積み木・凡例・ラベルの色見本を塗り直し、次に開いたときのために覚えておく
  $('scheme').value = state.scheme;
  $('scheme').onchange = (e) => { state.scheme = e.target.value; storeScheme(state.scheme); recolor(); };
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.focus !== null) setFocus(null); });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const hitAt = (e) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects([...stacks.flatMap((s) => s.meshes), ...mate.meshes])[0];
    if (!hit) return null;
    // もう1つの積み木（女性）は、寄っている業種のものとして扱う
    const industry = hit.object.userData.industry === -1 ? state.focus : hit.object.userData.industry;
    return { industry, band: hit.object.userData.band };
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
    stacks.forEach((stack, i) => {
      if (stack.step(dt)) moving = true;
      // 置き場所へなめらかに動かす
      const position = stack.group.position;
      if (position.distanceToSquared(goals[i]) > 1e-8) {
        if (reducedMotion || position.distanceTo(goals[i]) < 0.002) position.copy(goals[i]);
        else position.lerp(goals[i], Math.min(1, dt * 7));
        moving = true;
      }
    });
    if (mate.step(dt)) moving = true;
    if (flight) {
      const k = Math.min(1, dt * 5);
      camera.position.lerp(flight.position, k);
      controls.target.lerp(flight.target, k);
      if (camera.position.distanceTo(flight.position) < 0.01) flight = null;
      moving = true;
    }
    const shiftGoal = targetViewShift();
    if (viewShift.x !== shiftGoal.x || viewShift.y !== shiftGoal.y) {
      for (const axis of ['x', 'y']) {
        const gap = shiftGoal[axis] - viewShift[axis];
        viewShift[axis] = reducedMotion || Math.abs(gap) < 0.002 ? shiftGoal[axis] : viewShift[axis] + gap * Math.min(1, dt * 6);
      }
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
    arrange();
    if (state.focus === null) { camera.position.copy(home.position); controls.target.copy(home.target); } else goFocus(state.focus);
  }).observe(view);
  layout();
  stacks.forEach((stack) => stack.setColors(state.scheme));
  mate.setColors(state.scheme);
  update({}, { wave: true });
  arrange();
  camera.position.copy(home.position);
  controls.target.copy(home.target);
  if (state.focus !== null) goFocus(state.focus);
  frame();

  /** 配色やテーマ（明暗）が変わったとき、色に関わるものをすべて塗り直す */
  function recolor() {
    stacks.forEach((stack) => stack.setColors(state.scheme));
    $('bandlegend').innerHTML = Array.from({ length: BAND_COUNT }, (unused, i) => BAND_COUNT - 1 - i)
      .map((band) => `<span><i style="background:${bandColor(state.scheme, band)}"></i>${data.bandLabels[band]}</span>`).join('');
    update({});
    dirty = true;
  }
  recolor();
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
