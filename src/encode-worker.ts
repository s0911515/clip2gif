/// <reference lib="webworker" />
// 書き出しを受け持つ Worker。画面が固まらないよう、圧縮はすべてここで行う。
import { GifBuilder, buildPalette } from './gif';
import { WEBP_HEADER_BYTES, WebpBuilder, encodeFrame } from './webp';
import type { EncodeSettings, FromWorker, ToWorker } from './types';

declare const self: DedicatedWorkerGlobalScope;

let builder: GifBuilder | WebpBuilder | null = null;
let done = 0;
// メッセージを 1 つずつ順に処理する（WebP の圧縮は非同期なので）
let queue: Promise<void> = Promise.resolve();

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

async function estimate(settings: EncodeSettings, samples: Uint8ClampedArray[]): Promise<FromWorker> {
  if (settings.format === 'webp') {
    let total = 0;
    for (const s of samples) total += (await encodeFrame(s, settings)).length + 32;
    return { type: 'estimate', bytesPerFrame: total / samples.length, headerBytes: WEBP_HEADER_BYTES };
  }
  // GIF は 2 コマ目以降が差分になるので、見本を続けて書いた大きさから 1 コマ目を除いて割る
  const palette = buildPalette(samples, settings.colors);
  const first = new GifBuilder(settings, palette);
  first.add(samples[0]);
  const firstBytes = first.finish().length;
  if (samples.length < 2) return { type: 'estimate', bytesPerFrame: firstBytes, headerBytes: 0 };
  const all = new GifBuilder(settings, palette);
  for (const s of samples) all.add(s);
  const rest = (all.finish().length - firstBytes) / (samples.length - 1);
  return { type: 'estimate', bytesPerFrame: rest, headerBytes: firstBytes - rest };
}

async function handle(msg: ToWorker): Promise<void> {
  switch (msg.type) {
    case 'estimate': {
      post(await estimate(msg.settings, msg.samples.map((b) => new Uint8ClampedArray(b))));
      return;
    }
    case 'start': {
      done = 0;
      const s = msg.settings;
      builder =
        s.format === 'gif'
          ? new GifBuilder(s, buildPalette(msg.paletteSamples.map((b) => new Uint8ClampedArray(b)), s.colors))
          : new WebpBuilder(s);
      return;
    }
    case 'frame': {
      if (!builder) throw new Error('start の前に frame が来ました');
      await builder.add(new Uint8ClampedArray(msg.data));
      post({ type: 'progress', done: ++done });
      return;
    }
    case 'finish': {
      if (!builder) throw new Error('start の前に finish が来ました');
      const bytes = builder.finish();
      const mime = builder instanceof GifBuilder ? 'image/gif' : 'image/webp';
      builder = null;
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      post({ type: 'done', bytes: buf, mime }, [buf]);
      return;
    }
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  queue = queue
    .then(() => handle(e.data))
    .catch((err: unknown) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
};
