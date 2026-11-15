# 業種によって給与レンジはどのくらい異なるのか？

業種ごとの就労人数（男女別）と給与レンジの構成を1枚で見るインタラクティブな可視化です。

公開ページ: https://visualizing-jp.github.io/japan-salary-by-industry/

- 上下の線は業種ごとの就労人数で、上半分が男性、下半分が女性です。
- 中央の円盤は、その業種の中で各給与レンジにいる人の割合です。「400万円超 500万円以下」を基準に、多いほど紺、少ないほどオレンジで着色しています。
- 2014〜2024年分を切り替えられます。
- 業種をクリック（タップ）すると、その業種だけを画面中央に拡大し、給与レンジごとの人数と割合を表示します。男性と女性を左右に並べて比べることや、「800万円超」の内訳（6階級）を見ることもできます。
- 線の太さは人数に比例します。細すぎて太さで表せない線は点線で描きます。
- 円盤の面積は、その業種の中でそのレンジにいる人の割合に比例します。

## URL で状態を共有する

表示中の状態は URL の `#` 以降に反映されます。そのままコピーすれば、同じ画面を開けます。既定値と同じ項目は省かれます。

| 項目 | 値 | 例 |
| --- | --- | --- |
| `year` | 年 | `year=2020` |
| `sex` | `male` / `female`（男女計は省略） | `sex=female` |
| `sort` | `salary` / `workers` / `lowShare`（国税庁の統計表の順は省略） | `sort=salary` |
| `scheme` | `RdBu` / `RdYlBu` / `BrBG` / `PiYG` / `PRGn`（オレンジ〜紫は省略） | `scheme=RdBu` |
| `band` | 凡例で選んだ給与レンジ。0（100万円以下）〜8（800万円超） | `band=8` |
| `industry` | 拡大表示する業種。統計表の業種コード 1〜14 | `industry=5` |
| `compare` | 拡大表示で男女を並べるとき `1` | `compare=1` |

例: `https://visualizing-jp.github.io/japan-salary-by-industry/#year=2020&industry=5&compare=1`

## 試作: 回せる立体

[https://visualizing-jp.github.io/japan-salary-by-industry/object/](https://visualizing-jp.github.io/japan-salary-by-industry/object/)

1業種の給与レンジを、積み木のような立体にした試作です（`object/`）。ドラッグで回せ、業種を替えると円盤が上から落ちて積み上がります。描画には同梱の Three.js（`vendor/three/`）を使い、データと配色は本体と共用しています。URL の `industry`・`year`・`sex` で表示内容を指定できます。

## 試作: 14業種の立体を並べる

[https://visualizing-jp.github.io/japan-salary-by-industry/objects/](https://visualizing-jp.github.io/japan-salary-by-industry/objects/)

同じ積み木を14業種ぶん台の上に並べた試作です（`objects/`）。全体を回して見比べ、積み木をクリックするとその業種だけが残り、左に概要、右に各層の給与レンジ・割合・人数が出ます。業種名は、ほかの積み木と重ならない位置に置き、重なるときは隠します。円盤の面積は「業種内の割合」と「人数」を切り替えられ、人数にすると全業種で同じ尺度になります。URL の `size=count`・`year`・`sex`・`industry` で表示内容を指定できます。立体の部品（円盤の形、積み重ね、光）は `object/toy.js` にあり、2つの試作で共用しています。

## データ

国税庁「民間給与実態統計調査」全国計表 第9表（業種別・給与階級別、1年を通じて勤務した給与所得者）。
[e-Stat 統計表 0004009620](https://www.e-stat.go.jp/dbview?sid=0004009620) を、
[dataofjapan/data-of-japan の work-category 配信データ](https://github.com/dataofjapan/data-of-japan/tree/main/apps/society/work-category/public/data)
（`dist.json`、`industry.json`）経由で使用しています。給与階級は元の14区分を9区分にまとめ、`index.html` に埋め込んでいます。

## 構成

| 場所 | 内容 |
| --- | --- |
| `index.html` | ページの骨組み |
| `css/style.css` | スタイル |
| `js/main.js` | 起動と配線。状態の変化を、必要な描画だけにつなぐ |
| `js/config.js` | 定数（円盤・線の尺度、業種名の改行位置など） |
| `js/data.js` | データの読み込みと、割合・表示順の計算 |
| `js/state.js` | 画面の状態（年、対象、並び順、配色など） |
| `js/layout.js` | 表示幅から決まる配置（横並び／縦積み）の座標 |
| `js/discs.js` | 円盤の積み重ねの描画。一覧と拡大表示で共用 |
| `js/overview.js` | 一覧（上下の流れと業種ごとの円盤） |
| `js/closeup.js` | 拡大表示 |
| `js/controls.js` | 操作部と凡例 |
| `js/colors.js` | 配色 |
| `js/format.js` | 数値の表示形式 |
| `js/url.js` | 画面の状態と URL の相互変換 |
| `data/salary.json` | 表示用のデータ（下の手順で生成） |
| `scripts/` | データの生成と検証 |
| `vendor/` | 同梱している D3 v7.9.0 |
| `og-image.png`、`favicon.svg` | 共有時のサムネイル画像と、タブのアイコン |

ビルドは不要で、外部のサーバーからは何も読み込みません（書体は端末のものを使います）。ES モジュールと `fetch` を使っているので、手元で開くときはファイルを直接開かず、簡易サーバーを立ててください。

```
npm run serve   # http://localhost:8000/
```

## データの更新

新しい年分が [data-of-japan](https://github.com/dataofjapan/data-of-japan) に入ったら、そのリポジトリを手元に取得して次を実行します。

```
node scripts/build-data.mjs <data-of-japan>/apps/society/work-category/public/data <コミットID>
```

`data/salary.json` を書き出す前に、次の点を自動で確かめます。問題があれば書き出さずに止まります。`npm run verify` で、いまのデータだけを確かめることもできます。

- 給与レンジ別の人数の合計が、就労人数と一致すること
- 男性と女性の合計が、男女計と一致すること
- どのレンジの割合も、円盤の半径スケールの上限（60%）を超えないこと
- 全体の平均給与が、基準にしている「400万円超 500万円以下」に入っていること
- 「800万円超」の内訳の合計が、「800万円超」の人数と一致すること

元データで数値が入っていないセルは `null` のまま持ち、表示では 0 人として扱います（拡大表示では「該当なし」と示します）。これらを 0 として足した合計は就労人数と一致するため、非公表ではなく該当者なしと判断しています。欠損の数は `data/salary.json` の `source.missingCells` に記録しています。

## 制作

[矢崎裕一](https://notation.co.jp/)
