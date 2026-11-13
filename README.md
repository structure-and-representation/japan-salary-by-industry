# 業種によって給与レンジはどのくらい異なるのか？

業種ごとの就労人数（男女別）と給与レンジの構成を1枚で見るインタラクティブな可視化です。

公開ページ: https://visualizing-jp.github.io/japan-salary-by-industry/

- 上下の線は業種ごとの就労人数で、上半分が男性、下半分が女性です。
- 中央の円盤は、その業種の中で各給与レンジにいる人の割合です。「400万円超 500万円以下」を基準に、多いほど紺、少ないほどオレンジで着色しています。
- 2014〜2024年分を切り替えられます。

## データ

国税庁「民間給与実態統計調査」全国計表 第9表（業種別・給与階級別、1年を通じて勤務した給与所得者）。
[e-Stat 統計表 0004009620](https://www.e-stat.go.jp/dbview?sid=0004009620) を、
[dataofjapan/data-of-japan の work-category 配信データ](https://github.com/dataofjapan/data-of-japan/tree/main/apps/society/work-category/public/data)
（`dist.json`、`industry.json`）経由で使用しています。給与階級は元の14区分を9区分にまとめ、`index.html` に埋め込んでいます。

## 構成

`index.html` 1ファイルで動きます。描画には D3 v7（CDN）を使っています。
