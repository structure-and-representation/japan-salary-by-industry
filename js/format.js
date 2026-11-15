// 数値の表示形式。

/** 人数を「万人」で。10万人未満は小数1桁まで、1万人未満は「人」でそのまま */
export const formatWorkers = (n) => (n < 1e4
  ? n.toLocaleString('ja-JP') + '人'
  : (n / 1e4).toLocaleString('ja-JP', { maximumFractionDigits: n < 1e5 ? 1 : 0 }) + '万人');

/** 平均給与（千円単位）を「万円」で */
export const formatSalary = (thousandYen) => Math.round(thousandYen / 10).toLocaleString('ja-JP') + '万円';

export const formatPercent = (share) => (share * 100).toFixed(1) + '%';
