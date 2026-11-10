import './style.css';
import { FrameGrabber, frameTimes, loadVideo } from './extract';
import type { EncodeSettings, Format, FromWorker, ToWorker } from './types';

const MAX_FRAMES = 300;
const WARN_BYTES = 2 * 1024 * 1024;
/** GIF のパレットを作るときの見本のコマ数 */
const PALETTE_SAMPLES = 6;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fileInput = $<HTMLInputElement>('file');
const drop = $<HTMLLabelElement>('drop');
const edit = $<HTMLElement>('edit');
const video = $<HTMLVideoElement>('video');
const videoMeta = $<HTMLParagraphElement>('video-meta');
const startIn = $<HTMLInputElement>('start');
const endIn = $<HTMLInputElement>('end');
const startRange = $<HTMLInputElement>('start-range');
const endRange = $<HTMLInputElement>('end-range');
const fpsSel = $<HTMLSelectElement>('fps');
const widthSel = $<HTMLSelectElement>('width');
const speedSel = $<HTMLSelectElement>('speed');
const qualitySel = $<HTMLSelectElement>('quality');
const colorsSel = $<HTMLSelectElement>('colors');
const loopChk = $<HTMLInputElement>('loop');
const summary = $<HTMLParagraphElement>('summary');
const makeBtn = $<HTMLButtonElement>('make');
const cancelBtn = $<HTMLButtonElement>('cancel');
const progress = $<HTMLProgressElement>('progress');
const errorP = $<HTMLParagraphElement>('error');
const result = $<HTMLElement>('result');
const outImg = $<HTMLImageElement>('out');
const outMeta = $<HTMLParagraphElement>('out-meta');
const download = $<HTMLAnchorElement>('download');

let fileName = '';
let fileSize = 0;
let busy = false;
let cancelled = false;
let outUrl = '';

const PRESETS = {
  light: { fps: '5', width: '320', quality: '50', colors: '64' },
  normal: { fps: '8', width: '480', quality: '70', colors: '128' },
  quality: { fps: '15', width: '640', quality: '85', colors: '256' },
} as const;

// ---------- 表示の補助 ----------

const fmtSec = (s: number) => s.toFixed(1);
function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
function showError(msg: string | null) {
  errorP.hidden = !msg;
  errorP.textContent = msg ?? '';
}

// ---------- 設定 ----------

const format = (): Format =>
  (document.querySelector<HTMLInputElement>('input[name="format"]:checked')?.value as Format) ?? 'webp';

function outputSize(): { width: number; height: number } {
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const width = Math.min(Number(widthSel.value), vw);
  // 偶数にそろえる（WebP の ANMF の位置は 2 の倍数単位）
  const w = Math.max(2, Math.round(width / 2) * 2);
  const h = Math.max(2, Math.round((w * vh) / vw / 2) * 2);
  return { width: w, height: h };
}

function settings(): EncodeSettings {
  const fps = Number(fpsSel.value);
  return {
    format: format(),
    ...outputSize(),
    delayMs: 1000 / fps,
    loop: loopChk.checked,
    quality: Number(qualitySel.value),
    colors: Number(colorsSel.value),
  };
}

function range(): { start: number; end: number } {
  return { start: Number(startIn.value) || 0, end: Number(endIn.value) || 0 };
}

function times(): number[] {
  const { start, end } = range();
  return frameTimes(start, end, Number(fpsSel.value), Number(speedSel.value));
}

function syncFormatFields() {
  const gif = format() === 'gif';
  $('colors-field').hidden = !gif;
  $('quality-field').hidden = gif;
}

function applyPreset(name: keyof typeof PRESETS) {
  const p = PRESETS[name];
  fpsSel.value = p.fps;
  widthSel.value = p.width;
  qualitySel.value = p.quality;
  colorsSel.value = p.colors;
}

// ---------- 範囲 ----------

function setRange(start: number, end: number, from?: 'start' | 'end') {
  const d = video.duration || 0;
  start = Math.min(Math.max(0, start), d);
  end = Math.min(Math.max(0, end), d);
  if (end < start) {
    if (from === 'end') start = end;
    else end = start;
  }
  startIn.value = fmtSec(start);
  endIn.value = fmtSec(end);
  startRange.value = String(start);
  endRange.value = String(end);
  scheduleEstimate();
}

// ---------- 見積もり ----------

let estimateTimer = 0;
let estimateSeq = 0;
/** 見積もりのためにコマを取り出している間は、書き出しと動画の取り合いにならないよう待つ */
let estimating: Promise<void> = Promise.resolve();

function scheduleEstimate() {
  clearTimeout(estimateTimer);
  updateSummary(null);
  estimateTimer = window.setTimeout(runEstimate, 400);
}

function updateSummary(bytes: number | null) {
  const n = times().length;
  const { start, end } = range();
  const s = settings();
  if (n === 0) {
    summary.textContent = '開始と終了を指定してください。';
    summary.className = 'summary';
    makeBtn.disabled = true;
    return;
  }
  const length = (end - start) / Number(speedSel.value);
  let text = `${fmtSec(end - start)} 秒の場面 → ${n} コマ（${s.width}×${s.height}、再生 ${fmtSec(length)} 秒）`;
  let warn = false;
  if (n > MAX_FRAMES) {
    text += `。コマ数が多すぎます（${MAX_FRAMES} コマまで）。範囲を短くするか、コマ数を減らしてください。`;
    warn = true;
  } else if (bytes != null) {
    text += `、約 ${fmtBytes(bytes)}`;
    if (bytes > WARN_BYTES) {
      text += '。大きめなので、範囲を短くするか、幅やコマ数を減らすと軽くなります。';
      warn = true;
    }
  } else {
    text += '、大きさを計算中…';
  }
  summary.textContent = text;
  summary.className = warn ? 'summary warn' : 'summary';
  makeBtn.disabled = busy || n > MAX_FRAMES;
}

function runEstimate() {
  estimating = estimating.then(estimate).catch(() => updateSummary(null));
}

async function estimate() {
  if (busy || !video.duration) return;
  const ts = times();
  if (ts.length === 0 || ts.length > MAX_FRAMES) {
    updateSummary(null);
    return;
  }
  const seq = ++estimateSeq;
  const s = settings();
  // 見本として、範囲の中から続きのコマを 3 つ取る（GIF は差分の大きさも見たいので連続させる）
  const mid = Math.floor(ts.length / 2);
  const picks = ts.slice(Math.max(0, mid - 1), mid + 2);
  const grabber = new FrameGrabber(video, s.width, s.height);
  const samples: ArrayBuffer[] = [];
  const resume = video.currentTime;
  for (const t of picks) samples.push((await grabber.grab(t)).slice().buffer);
  video.currentTime = resume;
  if (seq !== estimateSeq) return;
  // 動画を使い終わったので、Worker の結果は待たずに次へ進めるようにする
  void finishEstimate(seq, s, samples, ts.length);
}

async function finishEstimate(seq: number, s: EncodeSettings, samples: ArrayBuffer[], frames: number) {
  const worker = newWorker();
  const res = await request(worker, { type: 'estimate', settings: s, samples }, samples);
  worker.terminate();
  if (seq !== estimateSeq || res.type !== 'estimate') return;
  updateSummary(res.headerBytes + res.bytesPerFrame * frames);
}

// ---------- Worker ----------

function newWorker(): Worker {
  return new Worker(new URL('./encode-worker.ts', import.meta.url), { type: 'module' });
}

function request(worker: Worker, msg: ToWorker, transfer: ArrayBuffer[] = []): Promise<FromWorker> {
  return new Promise((resolve) => {
    worker.addEventListener('message', (e: MessageEvent<FromWorker>) => resolve(e.data), { once: true });
    worker.postMessage(msg, transfer);
  });
}

// ---------- 書き出し ----------

async function make() {
  const ts = times();
  if (ts.length === 0 || ts.length > MAX_FRAMES) return;
  busy = true;
  cancelled = false;
  estimateSeq++;
  showError(null);
  makeBtn.disabled = true;
  cancelBtn.hidden = false;
  progress.hidden = false;
  progress.value = 0;
  video.pause();
  await estimating;

  const s = settings();
  const grabber = new FrameGrabber(video, s.width, s.height);
  const worker = newWorker();
  try {
    let done = 0;
    let failed = false;
    let finished: (r: FromWorker) => void = () => {};
    const finishedP = new Promise<FromWorker>((r) => (finished = r));
    let waiters: (() => void)[] = [];
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'progress') {
        done = m.done;
        progress.value = done / ts.length;
        waiters.forEach((w) => w());
        waiters = [];
      } else {
        if (m.type === 'error') failed = true;
        finished(m);
        waiters.forEach((w) => w());
      }
    };

    // GIF は全コマ共通の色表を作るため、先に見本のコマを渡す
    const paletteSamples: ArrayBuffer[] = [];
    if (s.format === 'gif') {
      const k = Math.min(PALETTE_SAMPLES, ts.length);
      for (let i = 0; i < k; i++) {
        const t = ts[Math.floor(((i + 0.5) * ts.length) / k)];
        paletteSamples.push((await grabber.grab(t)).slice().buffer);
      }
    }
    worker.postMessage({ type: 'start', settings: s, paletteSamples } satisfies ToWorker, paletteSamples);

    for (let i = 0; i < ts.length; i++) {
      if (cancelled) return;
      if (failed) break;
      const data = (await grabber.grab(ts[i])).slice().buffer;
      worker.postMessage({ type: 'frame', data } satisfies ToWorker, [data]);
      // 圧縮が追いつくまで待つ（コマをため込んでメモリを使いすぎないように）
      while (i + 1 - done > 3 && !failed && !cancelled) await new Promise<void>((r) => waiters.push(r));
    }
    if (!failed) worker.postMessage({ type: 'finish' } satisfies ToWorker);
    const res = await finishedP;
    if (cancelled) return;
    if (res.type === 'error') throw new Error(res.message);
    if (res.type !== 'done') throw new Error('思わぬ応答がありました');
    showResult(new Blob([res.bytes], { type: res.mime }), s);
  } catch (err) {
    showError(`作れませんでした: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    worker.terminate();
    busy = false;
    cancelBtn.hidden = true;
    progress.hidden = true;
    updateSummary(null);
    scheduleEstimate();
  }
}

function showResult(blob: Blob, s: EncodeSettings) {
  if (outUrl) URL.revokeObjectURL(outUrl);
  outUrl = URL.createObjectURL(blob);
  outImg.src = outUrl;
  outImg.width = s.width;
  outImg.height = s.height;
  const ext = s.format === 'gif' ? 'gif' : 'webp';
  download.href = outUrl;
  download.download = `${outName()}.${ext}`;
  outMeta.textContent = `${s.format === 'gif' ? 'GIF' : 'WebP'}・${s.width}×${s.height}・${fmtBytes(blob.size)}（元の動画は ${fmtBytes(fileSize)}）`;
  result.hidden = false;
  result.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** 保存するファイル名。元の動画の名前に、切り取った開始秒を付ける */
function outName(): string {
  const base = fileName.replace(/\.[^.]+$/, '') || 'clip';
  return `${base}-${fmtSec(range().start).replace('.', '_')}s`;
}

// ---------- 動画を開く ----------

async function open(file: File) {
  showError(null);
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm|mkv|3gp)$/i.test(file.name)) {
    showError('動画のファイルを選んでください。');
    edit.hidden = false;
    return;
  }
  fileName = file.name;
  fileSize = file.size;
  // 選んだ後は、選ぶ場所を小さくたたむ
  $('pick').classList.add('compact');
  $('drop-main').textContent = '別の動画を選ぶ';
  $('drop-sub').textContent = file.name;
  edit.hidden = false;
  result.hidden = true;
  try {
    await loadVideo(video, file);
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    return;
  }
  const d = video.duration;
  for (const r of [startRange, endRange]) {
    r.min = '0';
    r.max = String(d);
  }
  startIn.max = endIn.max = String(d);
  videoMeta.textContent = `${file.name}・${video.videoWidth}×${video.videoHeight}・${fmtSec(d)} 秒・${fmtBytes(file.size)}`;
  setRange(0, Math.min(d, 3));
  edit.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- イベント ----------

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) void open(f);
});
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer?.files[0];
  if (f) void open(f);
});

startIn.addEventListener('change', () => setRange(Number(startIn.value), range().end, 'start'));
endIn.addEventListener('change', () => setRange(range().start, Number(endIn.value), 'end'));
startRange.addEventListener('input', () => {
  setRange(Number(startRange.value), range().end, 'start');
  video.currentTime = Number(startRange.value);
});
endRange.addEventListener('input', () => {
  setRange(range().start, Number(endRange.value), 'end');
  video.currentTime = Number(endRange.value);
});
$('set-start').addEventListener('click', () => setRange(video.currentTime, range().end, 'start'));
$('set-end').addEventListener('click', () => setRange(range().start, video.currentTime, 'end'));

let stopAt = 0;
$('play-range').addEventListener('click', () => {
  const { start, end } = range();
  stopAt = end;
  video.playbackRate = Number(speedSel.value);
  video.currentTime = start;
  void video.play();
});
video.addEventListener('timeupdate', () => {
  if (stopAt && video.currentTime >= stopAt) {
    video.pause();
    stopAt = 0;
  }
});
video.addEventListener('pause', () => (stopAt = 0));

for (const el of document.querySelectorAll<HTMLInputElement>('input[name="format"]')) {
  el.addEventListener('change', () => {
    syncFormatFields();
    scheduleEstimate();
  });
}
for (const el of document.querySelectorAll<HTMLInputElement>('input[name="preset"]')) {
  el.addEventListener('change', () => {
    applyPreset(el.value as keyof typeof PRESETS);
    scheduleEstimate();
  });
}
for (const el of [fpsSel, widthSel, speedSel, qualitySel, colorsSel, loopChk]) {
  el.addEventListener('change', () => {
    // 手で変えたら「おまかせ」の選択を外す
    if (el !== speedSel && el !== loopChk) {
      for (const p of document.querySelectorAll<HTMLInputElement>('input[name="preset"]')) p.checked = false;
    }
    scheduleEstimate();
  });
}

makeBtn.addEventListener('click', () => void make());
cancelBtn.addEventListener('click', () => {
  cancelled = true;
});

applyPreset('normal');
syncFormatFields();
