// 画面の状態。変更があると、変わった項目名と動きの長さを購読者に知らせる。

export function createStore(initial) {
  const state = { ...initial };
  const listeners = [];
  return {
    state,
    subscribe(listener) { listeners.push(listener); },
    /**
     * patch のうち実際に値が変わった項目だけを通知する。
     * duration は動きの長さ（省略時は購読者の既定）、source は変更のきっかけ（自動再生なら 'play'）
     */
    set(patch, { duration, source } = {}) {
      const changed = Object.keys(patch).filter((key) => state[key] !== patch[key]);
      if (!changed.length) return;
      changed.forEach((key) => { state[key] = patch[key]; });
      listeners.forEach((listener) => listener(new Set(changed), { duration, source }));
    },
  };
}
