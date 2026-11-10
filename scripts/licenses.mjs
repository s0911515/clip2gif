// 画面に同梱しているライブラリのライセンス文を public/licenses.txt にまとめる（ビルドの前に実行）。
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').trim();
const parts = [
  ['clip2gif', 'MIT', 'LICENSE'],
  ['gifenc（GIF の書き出し）', 'MIT', 'node_modules/gifenc/LICENSE.md'],
  ['@jsquash/webp（WebP の書き出し）', 'Apache-2.0', 'node_modules/@jsquash/webp/LICENSE'],
  ['libwebp（@jsquash/webp に含まれる WebP の圧縮処理）', 'BSD-3-Clause', 'node_modules/@jsquash/webp/codec/LICENSE.codec.md'],
];
const line = '='.repeat(72);
const text =
  'clip2gif で使っているソフトウェアのライセンス\n\n' +
  parts.map(([name, id, file]) => `${line}\n${name} — ${id}\n${line}\n\n${read(file)}\n`).join('\n');
fs.writeFileSync(new URL('../public/licenses.txt', import.meta.url), text);
