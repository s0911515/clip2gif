# clip2gif

動画の一場面を切り取って、軽い GIF・アニメーション WebP にする Web アプリ。
動画はブラウザの中だけで処理し、どこにも送信しない（サーバー側の処理はない）。

公開先: https://clip2gif.pages.dev （検索エンジンには載せない）

## 使い方

1. 動画を選ぶ（ドラッグ＆ドロップでもよい）。
2. 開始と終了を決める。スライダー、秒数の入力、「今の位置」ボタンのどれでも指定できる。「範囲を再生」で確かめられる。
3. 形式（WebP / GIF）、コマ数、幅、速さ、画質を選ぶ。迷ったら「おまかせ」から選ぶ。作る前に、だいたいの大きさが表示される。
4. 「作る」→ できあがりを確かめて「保存する」。

- WebP は同じ画質なら GIF よりかなり小さい。GIF は古い環境でも表示できる。
- 300 コマまで。2MB を超えそうなときは警告する。
- ブラウザで再生できない形式の動画は扱えない（例: HEVC の動画を、HEVC に対応していない環境の Chrome で開くとき）。

## 仕組み

| ファイル | 役割 |
| --- | --- |
| `src/extract.ts` | `<video>` を指定の時刻へ動かし、canvas に描いてコマ（RGBA）を取り出す |
| `src/encode-worker.ts` | 圧縮を受け持つ Web Worker。画面が固まらないよう、コマを 1 枚ずつ受け取って圧縮する |
| `src/gif.ts` | GIF の組み立て（[gifenc](https://github.com/mattdesl/gifenc)）。全コマ共通の色表を見本のコマから作り、前のコマと同じ画素は透明にして差分だけを書く |
| `src/webp.ts` | アニメーション WebP の組み立て。1 コマずつ libwebp（[@jsquash/webp](https://github.com/jamsinclair/jSquash) の wasm）で圧縮し、RIFF の ANIM/ANMF に詰め直す |
| `src/main.ts` | 画面の操作、大きさの見積もり（見本の 3 コマを実際に圧縮して掛け算する） |
| `public/_headers` | Cloudflare Pages の応答ヘッダー（noindex、CSP など） |

Safari は canvas から WebP を書き出せないので、どのブラウザでも wasm の libwebp を使う。

## 開発

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # 型チェック → dist/ に書き出し
npm run preview    # dist/ を http://localhost:4173 で確かめる
```

## 公開（Cloudflare Pages）

GitHub と連携していて、main に push すると本番に、PR ではプレビューの URL にデプロイされる。

最初の 1 回だけ、Cloudflare の管理画面で設定する:

1. Workers & Pages →「作成」→「Pages」→「Git に接続」→ `s0911515/clip2gif` を選ぶ。
2. プロジェクト名 `clip2gif`、本番ブランチ `main`、フレームワーク「なし」。
3. ビルドコマンド `npm run build`、出力ディレクトリ `dist`。Node のバージョンは `.node-version`（22）が使われる。

## ライセンス

MIT
