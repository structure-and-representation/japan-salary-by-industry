// 表示に関わる定数。数値の意味をここに集める。

export const BAND_COUNT = 9;
export const SEX = { TOTAL: 0, MALE: 1, FEMALE: 2 };
export const SEX_LABELS = ['男女計', '男性', '女性'];
/** URL に書くときの名前 */
export const SEX_KEYS = ['total', 'male', 'female'];

/** 並び順の選択肢。値は select の value と対応する */
export const SORT = { NTA: 'nta', SALARY: 'salary', WORKERS: 'workers', LOW_SHARE: 'lowShare' };
/** 「300万円以下の割合が高い順」で数える層の数（100万円以下〜300万円以下） */
export const LOW_SHARE_BANDS = 3;

/** 切り替え時の動きの長さ（ミリ秒） */
export const DURATION = { full: 650, quick: 250, closeup: 300, closeupMax: 450, open: 380 };

/** 円盤の面積の凡例に出す割合 */
export const DISC_LEGEND_SHARES = [0.1, 0.3, 0.5];

export const DISC = {
  /** 楕円の縦横比。斜め上から見た円に見せる */
  tilt: 0.27,
  /** 半径スケールが想定する割合の上限。scripts/verify-data.mjs がこの値を超えないことを確かめる */
  maxShare: 0.6,
  /** 側面を上面よりどれだけ暗くするか（d3.color().darker の係数） */
  sideDarken: 0.55,
};

export const FLOW = {
  /** 1人あたりの線の太さ（px）。500万人で13px */
  pxPerWorker: 2.6e-6,
  /** 太さがこれ（px）に満たない線は、太さでは表さず点線で描く */
  minWidth: 0.5,
  /** 点線で描くときの線の太さ（px）と点の間隔 */
  thinStroke: 0.8,
  thinDash: '1.5 3',
  legendValues: [5e5, 1e6, 5e6],
};

/**
 * 業種名の表示用の改行位置（| で改行）。キーは統計表の業種コード。
 * wide: 通常の横並び / narrow: 横並びで業種の間隔が狭いとき
 */
export const INDUSTRY_LABELS = {
  1: { wide: '建設業', narrow: '建設業' },
  2: { wide: '製造業', narrow: '製造業' },
  3: { wide: '卸売業・小売業', narrow: '卸売業・|小売業' },
  4: { wide: '宿泊業、|飲食サービス業', narrow: '宿泊業、|飲食|サービス業' },
  5: { wide: '金融業・保険業', narrow: '金融業・|保険業' },
  6: { wide: '不動産業、|物品賃貸業', narrow: '不動産業、|物品賃貸業' },
  7: { wide: '運輸業、郵便業', narrow: '運輸業、|郵便業' },
  8: { wide: '電気・ガス・|熱供給・水道業', narrow: '電気・ガス・|熱供給・|水道業' },
  9: { wide: '情報通信業', narrow: '情報通信業' },
  10: { wide: '学術研究、|専門・技術サービス業、|教育、学習支援業', narrow: '学術研究、|専門・技術|サービス業、|教育、|学習支援業' },
  11: { wide: '医療、福祉', narrow: '医療、福祉' },
  12: { wide: '複合サービス|事業', narrow: '複合サービス|事業' },
  13: { wide: 'サービス業', narrow: 'サービス業' },
  14: { wide: '農林水産・鉱業', narrow: '農林水産・|鉱業' },
};
