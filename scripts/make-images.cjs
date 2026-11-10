// public/og.png（URL を貼ったときのカード）と public/apple-touch-icon.png（iPhone のホーム画面）を書き出す。
// 見た目を変えたときだけ手で実行する: node scripts/make-images.cjs （Playwright が必要）
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await p.goto('file://' + path.join(__dirname, 'og.html'));
  await p.screenshot({ path: path.join(__dirname, '../public/og.png') });
  await p.setViewportSize({ width: 180, height: 180 });
  await p.setContent(`<style>html,body{margin:0;background:#e8590c}</style><img src="file://${path.join(__dirname, '../public/icon.svg')}" width="180" height="180" style="display:block">`);
  await p.screenshot({ path: path.join(__dirname, '../public/apple-touch-icon.png') });
  await b.close();
})();
