// 動画から指定の時刻のコマを取り出す。ブラウザの <video> で再生できる動画なら何でも扱える。

export function loadVideo(video: HTMLVideoElement, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.src) URL.revokeObjectURL(video.src);
    video.onloadedmetadata = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      resolve();
    };
    video.onerror = () => reject(new Error('この動画はブラウザで再生できない形式です'));
    video.src = URL.createObjectURL(file);
  });
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    // 同じ時刻への移動では seeked が来ないことがあるので、少しでもずれていれば動かす
    if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) {
      resolve();
      return;
    }
    video.addEventListener('seeked', () => resolve(), { once: true });
    video.currentTime = t;
  });
}

export class FrameGrabber {
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

  constructor(
    private readonly video: HTMLVideoElement,
    readonly width: number,
    readonly height: number,
  ) {
    this.canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas が使えません');
    this.ctx = ctx as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
    this.ctx.imageSmoothingQuality = 'high';
  }

  /** 時刻 t（秒）のコマを RGBA で返す */
  async grab(t: number): Promise<Uint8ClampedArray> {
    await seek(this.video, t);
    this.ctx.drawImage(this.video, 0, 0, this.width, this.height);
    return this.ctx.getImageData(0, 0, this.width, this.height).data;
  }
}

/** 開始〜終了を、出力のコマ数と速さに合わせて区切った時刻の一覧 */
export function frameTimes(start: number, end: number, fps: number, speed: number): number[] {
  const step = speed / fps;
  const times: number[] = [];
  for (let t = start; t < end - 1e-6; t += step) times.push(t);
  return times;
}
