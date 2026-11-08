export type Format = 'webp' | 'gif';

/** 書き出しの設定（Worker に渡す） */
export interface EncodeSettings {
  format: Format;
  width: number;
  height: number;
  /** 1 コマの表示時間（ミリ秒） */
  delayMs: number;
  loop: boolean;
  /** WebP の画質（0〜100） */
  quality: number;
  /** GIF の色数（2〜256） */
  colors: number;
}

export type ToWorker =
  | { type: 'start'; settings: EncodeSettings; paletteSamples: ArrayBuffer[] }
  | { type: 'frame'; data: ArrayBuffer }
  | { type: 'finish' }
  /** 見本のコマを圧縮して、1 コマあたりの大きさを返す */
  | { type: 'estimate'; settings: EncodeSettings; samples: ArrayBuffer[] };

export type FromWorker =
  | { type: 'progress'; done: number }
  | { type: 'done'; bytes: ArrayBuffer; mime: string }
  | { type: 'estimate'; bytesPerFrame: number; headerBytes: number }
  | { type: 'error'; message: string };
