import encode from '@jsquash/webp/encode';
import type { EncodeSettings } from './types';

// アニメーション WebP の組み立て。1 コマずつ libwebp（wasm）で静止画の WebP にし、
// 中の画像データ（VP8 / VP8L / ALPH のチャンク）を取り出して ANMF に詰め直す。
// 仕様: https://developers.google.com/speed/webp/docs/riff_container

interface Chunk {
  fourcc: string;
  data: Uint8Array;
}

function readChunks(webp: Uint8Array): Chunk[] {
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  const tag = (o: number) => String.fromCharCode(webp[o], webp[o + 1], webp[o + 2], webp[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP') throw new Error('WebP の形式ではありません');
  const chunks: Chunk[] = [];
  let o = 12;
  while (o + 8 <= webp.length) {
    const size = view.getUint32(o + 4, true);
    chunks.push({ fourcc: tag(o), data: webp.subarray(o + 8, o + 8 + size) });
    o += 8 + size + (size & 1);
  }
  return chunks;
}

const u24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];

function chunk(fourcc: string, payload: Uint8Array[]): Uint8Array {
  const size = payload.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(8 + size + (size & 1));
  for (let i = 0; i < 4; i++) out[i] = fourcc.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, size, true);
  let o = 8;
  for (const p of payload) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export async function encodeFrame(rgba: Uint8ClampedArray, settings: EncodeSettings): Promise<Uint8Array> {
  const image = new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, settings.width, settings.height);
  const webp = new Uint8Array(await encode(image, { quality: settings.quality, method: 4 }));
  // 画像データのチャンクだけを残す（VP8X や EXIF などは捨てる）
  const body = readChunks(webp).filter((c) => c.fourcc === 'VP8 ' || c.fourcc === 'VP8L' || c.fourcc === 'ALPH');
  return Uint8Array.from(body.flatMap((c) => [...chunk(c.fourcc, [c.data])]));
}

export class WebpBuilder {
  private frames: Uint8Array[] = [];

  constructor(private readonly settings: EncodeSettings) {}

  async add(rgba: Uint8ClampedArray): Promise<void> {
    const { width, height, delayMs } = this.settings;
    const body = await encodeFrame(rgba, this.settings);
    const header = new Uint8Array([
      ...u24(0), // X / 2
      ...u24(0), // Y / 2
      ...u24(width - 1),
      ...u24(height - 1),
      ...u24(Math.round(delayMs)),
      0b10, // 重ねずに置き換える（blending なし）、消さない
    ]);
    this.frames.push(chunk('ANMF', [header, body]));
  }

  finish(): Uint8Array {
    const { width, height, loop } = this.settings;
    const vp8x = chunk('VP8X', [new Uint8Array([0b10, 0, 0, 0, ...u24(width - 1), ...u24(height - 1)])]);
    // 背景色（使わない）と、繰り返し回数（0 = ずっと）
    const anim = chunk('ANIM', [new Uint8Array([0, 0, 0, 0, loop ? 0 : 1, 0])]);
    const parts = [new TextEncoder().encode('WEBP'), vp8x, anim, ...this.frames];
    const riff = chunk('RIFF', parts);
    return riff;
  }
}

/** ヘッダー部分のおおよその大きさ（見積もり用） */
export const WEBP_HEADER_BYTES = 12 + 18 + 14;
