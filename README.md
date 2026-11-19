# 業種によって給与レンジはどのくらい異なるのか？

日本の14業種について、給与レンジの構成を積み木のような立体で見比べるインタラクティブな可視化です。

| ページ | 内容 |
| --- | --- |
| [トップ](https://japan-salary-by-industry.structure-and-representation.com/) | 14業種の積み木を台の上に並べて見比べる。積み木を選ぶとその業種に寄り、男女を左右に並べることもできる |
| [1業種ずつ見る](https://japan-salary-by-industry.structure-and-representation.com/object/) | 1つの積み木を大きく出し、回して眺める |

- 積み木1つが業種1つ、円盤1枚が給与レンジ1つです。下が低い給与、上が高い給与です。
- 円盤の面積は、「業種内の割合」と「人数」を切り替えられます。人数にすると全業種で同じ尺度になり、働く人が多い業種ほど大きな積み木になります。
- 「400万円超 500万円以下」を基準に、給与が高いレンジほど紺、低いレンジほどオレンジで着色しています。配色は、ほかの分岐的カラースキームに切り替えられます。
- 2014〜2024年分と、男女計・男性・女性を切り替えられます。

以前の平面版は `/2d/` に残しています。どのページからもリンクしておらず、検索エンジンにも載せない指定にしています。

## URL で状態を共有する

表示中の状態は URL の `#` 以降に反映されます。そのままコピーすれば、同じ画面を開けます。既定値と同じ項目は省かれます。

| 項目 | 値 | 例 |
| --- | --- | --- |
| `size` | 円盤の面積を人数にするとき `count` | `size=count` |
| `year` | 年 | `year=2020` |
| `sex` | `male` / `female`（男女計は省略） | `sex=female` |
| `industry` | 寄る業種。統計表の業種コード 1〜14 | `industry=5` |
| `compare` | 寄った業種で男女を並べるとき `1` | `compare=1` |
| `scheme` | 配色。`RdBu` / `RdYlBu` / `BrBG` / `PiYG` / `PRGn`（オレンジ〜紫は省略） | `scheme=RdBu` |

例: `https://japan-salary-by-industry.structure-and-representation.com/#size=count&industry=11&compare=1`

## データ

国税庁「民間給与実態統計調査」全国計表 第9表（業種別・給与階級別、1年を通じて勤務した給与所得者）。
[e-Stat 統計表 0004009620](https://www.e-stat.go.jp/dbview?sid=0004009620) を、
[dataofjapan/data-of-japan の work-category 配信データ](https://github.com/dataofjapan/data-of-japan/tree/main/apps/society/work-category/public/data)
（`dist.json`、`industry.json`）経由で使用しています。給与階級は元の14区分を9区分にまとめ、`index.html` に埋め込んでいます。

## 構成

| 場所 | 内容 |
| --- | --- |
| `index.html` | トップ（14業種の立体）の骨組み |
| `objects/` | トップのスクリプトとスタイル。`objects/index.html` は、以前のURLからトップへ転送するだけのページ |
| `object/` | 1業種ずつ見るページ。`toy.js` は立体の共通部品（円盤の形、積み重ね、光と床）で、トップも使う |
| `2d/index.html` | 平面版の骨組み |
| `js/` | 共通のスクリプトと、平面版のスクリプト |
| `js/config.js`・`data.js`・`colors.js`・`format.js`・`url.js` | 全ページ共通: 定数、データの読み込みと計算、配色、数値の表示形式、URL との相互変換 |
| `js/main.js`・`state.js`・`layout.js`・`discs.js`・`overview.js`・`closeup.js`・`controls.js` | 平面版だけが使う |
| `css/style.css` | 全ページ共通のスタイル |
| `data/salary.json` | 表示用のデータ（下の手順で生成） |
| `scripts/` | データの生成と検証、版の番号付け |
| `vendor/` | 同梱している D3 v7.9.0 と Three.js r170 |
| `og-image.png`、`favicon.svg` | 共有時のサムネイル画像と、タブのアイコン |

ビルドは不要です。表示に必要なファイルはすべてこのリポジトリにあり、書体は端末のものを使います。外部から読み込むのは、アクセス解析用の Google タグ マネージャー（`GTM-K84SW2VR`）だけです。タグは `index.html`・`object/index.html`・`2d/index.html` の `<head>` にあります。ES モジュールと `fetch` を使っているので、手元で開くときはファイルを直接開かず、簡易サーバーを立ててください。

```
npm run serve   # http://localhost:8000/
```

## 公開前の手順

ファイルを変更したら、push の前に次を実行します。

```
npm run stamp    # HTML から読み込むファイルに、内容から決まる版の番号（?v=...）を付け直す
npm run verify   # データの検証と、版の番号が最新かどうかの確認
```

GitHub Pages は各ファイルを約10分キャッシュさせます。版の番号がないと、更新の直後に「新しい HTML と古いスクリプト」が組み合わさって動かなくなることがあります。番号は全ファイルの内容から計算し、スクリプトどうしの `import` にも HTML の importmap で同じ番号を付けるので、HTML と同じ版のファイルだけが読み込まれます。

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

## 効果音

円盤が着地するたびに、木琴のような短い音が鳴ります（`object/sound.js`。音声ファイルは使わず、Web Audio で合成）。
層が上がるほど高い音、円盤が大きいほど低く大きな音です。ブラウザの決まりで、ページを開いてから最初の操作があるまでは音が出ません。
表示領域の右下の「♪ 音あり／音なし」で切り替えられ、選んだ状態はブラウザに記憶されます。「積みなおす」で、もう一度落として積めます。
