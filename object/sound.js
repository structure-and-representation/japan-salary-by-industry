// 積み木の効果音。円盤が着地した瞬間に、木琴のような短い音を鳴らす。
// 音声ファイルは使わず、Web Audio でその場で合成する。
//
// ブラウザは、ページを開いただけでは音を出させない。最初にクリックやキー操作があってから鳴り始める。
// そのため、開いた直後に積み木が落ちてくる動きには音が付かない（「積みなおす」を押すと音付きで見られる）。

const STORAGE_KEY = 'sound';
/** 層ごとの音の高さ（Hz）。下の層ほど低い。五音音階なので、どの順に鳴っても濁らない */
const NOTES = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3, 659.3, 784.0];
/** 木の板を叩いたときに混ざる、高い成分の比率（木琴らしい響きになる） */
const OVERTONE = 3.9;
const MASTER_VOLUME = 0.5;
/** 続けて鳴らすときの最短の間隔（秒）。一度にたくさん落ちるときに、音が団子にならないようにする */
const MIN_GAP = 0.018;

export function createSound() {
  let enabled = true;
  try { enabled = localStorage.getItem(STORAGE_KEY) !== 'off'; } catch (e) { /* 保存領域が使えなければ、オンのまま */ }
  let context = null;
  let output = null;
  let noise = null; // 叩いた瞬間の「コツッ」に使う雑音
  let lastTime = 0;

  function prepare() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    context = new AudioContext();
    // 音が重なっても割れないよう、最後に音量をならす
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 6;
    output = context.createGain();
    output.gain.value = MASTER_VOLUME;
    output.connect(limiter).connect(context.destination);
    noise = context.createBuffer(1, Math.floor(context.sampleRate * 0.03), context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
  }
  /** 利用者の操作をきっかけに、音を出せる状態にする */
  function unlock() {
    if (!enabled) return;
    if (!context) prepare();
    if (context && context.state === 'suspended') context.resume();
  }
  ['pointerdown', 'keydown'].forEach((type) => addEventListener(type, unlock, { capture: true, passive: true }));

  /** 一定の時間で消えていく音を1つ鳴らす */
  function tone(frequency, volume, duration, when) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(gain).connect(output);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.02);
  }

  return {
    get enabled() { return enabled; },
    setEnabled(value) {
      enabled = value;
      try { localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off'); } catch (e) { /* 保存できなくても動作は続ける */ }
      if (value) unlock();
    },
    /**
     * 円盤が着地した音。
     * band: 層の番号（高い層ほど高い音） / radius: 円盤の半径（大きいほど低く、大きな音） / speed: 着地の速さ（0〜1）
     */
    land({ band, radius, speed }) {
      if (!enabled || !context || context.state !== 'running') return;
      const now = context.currentTime;
      if (now - lastTime < MIN_GAP) return;
      lastTime = now;
      const size = Math.min(1, Math.max(0.1, radius));
      const frequency = NOTES[band] * (1.08 - 0.16 * size); // 大きい円盤は少し低く
      const volume = (0.1 + 0.22 * size) * (0.5 + 0.5 * Math.min(1, speed));
      tone(frequency, volume, 0.22 + 0.2 * size, now);
      tone(frequency * OVERTONE, volume * 0.28, 0.07, now);
      // 叩いた瞬間の短い雑音。木と木が当たる感じを足す
      const click = context.createBufferSource();
      click.buffer = noise;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1400 + 600 * (1 - size);
      const gain = context.createGain();
      gain.gain.setValueAtTime(volume * 0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
      click.connect(filter).connect(gain).connect(output);
      click.start(now);
    },
  };
}

/** 音のオン・オフを切り替えるボタンを、効果音につなぐ */
export function setupSoundButton(sound, button) {
  const render = () => {
    button.setAttribute('aria-pressed', sound.enabled);
    button.textContent = sound.enabled ? '♪ 音あり' : '♪ 音なし';
  };
  button.onclick = () => { sound.setEnabled(!sound.enabled); render(); };
  render();
}
