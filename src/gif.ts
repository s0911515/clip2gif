import { GIFEncoder, applyPalette, quantize, type Encoder, type Palette } from 'gifenc';
import type { EncodeSettings } from './types';

/**
 * 見本のコマをまとめて 1 つのパレット（全コマ共通の色表）を作る。
 * コマごとに色表を変えるより小さく、色のちらつきも出ない。
 * 最後の 1 色は「前のコマと同じ」を表す透明色に空けておく。
 */
export function buildPalette(samples: Uint8ClampedArray[], colors: number): Palette {
  const pixels = samples.reduce((n, s) => n + s.length, 0);
  // 量子化は重いので、合計 40 万画素程度に間引く
  const step = Math.max(1, Math.round(pixels / 4 / 400_000));
  const picked = new Uint8ClampedArray(Math.ceil(pixels / 4 / step) * 4);
  let o = 0;
  for (const s of samples) {
    for (let i = 0; i < s.length; i += 4 * step) {
      picked[o++] = s[i];
      picked[o++] = s[i + 1];
      picked[o++] = s[i + 2];
      picked[o++] = 255;
    }
  }
  const palette = quantize(picked.subarray(0, o), Math.max(2, colors - 1), { format: 'rgb565' });
  palette.push([0, 0, 0]); // 透明色
  return palette;
}

/** GIF を 1 コマずつ組み立てる */
export class GifBuilder {
  private enc: Encoder = GIFEncoder();
  private prev: Uint8Array | null = null;
  private readonly transparentIndex: number;

  constructor(
    private readonly settings: EncodeSettings,
    private readonly palette: Palette,
  ) {
    this.transparentIndex = palette.length - 1;
  }

  add(rgba: Uint8ClampedArray): void {
    const { width, height, delayMs, loop } = this.settings;
    const index = applyPalette(rgba, this.palette, 'rgb565');
    const first = this.prev === null;
    if (!first) {
      // 前のコマと同じ色の画素を透明にして、変わったところだけを書く（大幅に小さくなる）
      const prev = this.prev!;
      const cur = index.slice();
      for (let i = 0; i < index.length; i++) {
        if (index[i] === prev[i]) index[i] = this.transparentIndex;
      }
      this.prev = cur;
    } else {
      this.prev = index.slice();
    }
    this.enc.writeFrame(index, width, height, {
      palette: first ? this.palette : undefined,
      delay: delayMs,
      repeat: loop ? 0 : -1,
      transparent: !first,
      transparentIndex: this.transparentIndex,
      dispose: 1, // 前のコマを残したまま重ねる
    });
  }

  finish(): Uint8Array {
    this.enc.finish();
    return this.enc.bytes();
  }
}
