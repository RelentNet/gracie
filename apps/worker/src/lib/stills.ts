/**
 * Screen-share STILLS extraction (feat: screen-share-stills). The team's only real
 * need for video is to see a graphic someone screen-shared, so instead of keeping the
 * large MP4 we pull a still frame at each slide/screen change and keep those tiny
 * JPEGs forever.
 *
 * Recall exposes no screen-share-only track, so we run ffmpeg SCENE-CHANGE detection
 * over the mixed video (streamed straight from Recall's signed URL — nothing is
 * downloaded whole). The bot is dispatched with `video_mixed_participant_video_when_
 * screenshare: 'hide'` (see `@gracie/shared/recall`) so shared screens are clean
 * full-frame graphics, which keeps scene detection focused on slide changes.
 *
 * Best-effort by contract: the caller wraps this so a stills hiccup NEVER fails
 * meeting generation. The pure bits (`parseSceneTimestamps`, `selectStills`) are
 * unit-tested; the ffmpeg spawn itself needs a real recording (noted e2e gap).
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyBaseLogger } from 'fastify';

/** Scene-change sensitivity (0–1). Higher = only bigger frame changes (slide swaps). */
export const DEFAULT_SCENE_THRESHOLD = 0.4;
/** Hard cap on stills kept per meeting — the rest are dropped (evenly spaced). */
export const DEFAULT_MAX_STILLS = 30;
/** Longest a single ffmpeg pass may run before it's killed (a stuck stream can't wedge the worker). */
const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;
/** Downscale width cap so each still stays kilobytes, not megabytes. */
const MAX_WIDTH = 1280;

/** One extracted still: its timestamp (seconds from recording start) + the JPEG bytes. */
export interface ExtractedStill {
  readonly tsSeconds: number;
  readonly jpeg: Buffer;
}

/**
 * Pull every `pts_time:<seconds>` that ffmpeg's `showinfo` filter prints (one per
 * selected frame, in output order) from ffmpeg's stderr. Pure; unit-tested. The i-th
 * value lines up with the i-th written `still-*.jpg`.
 */
export function parseSceneTimestamps(stderr: string): number[] {
  const out: number[] = [];
  const re = /pts_time:([0-9]+(?:\.[0-9]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    const t = Number(m[1]);
    if (Number.isFinite(t)) out.push(t);
  }
  return out;
}

/**
 * Cap a candidate list to `max`, keeping an EVENLY SPACED subset (always the first and
 * last) so a still late in the meeting — the org chart at minute 55 — is never lost to
 * an early run of changes. Returns all when already within the cap. Pure; unit-tested.
 */
export function selectStills<T>(all: readonly T[], max: number): T[] {
  if (max <= 0) return [];
  if (all.length <= max) return [...all];
  const step = (all.length - 1) / (max - 1);
  const out: T[] = [];
  let lastIndex = -1;
  for (let i = 0; i < max; i += 1) {
    const idx = Math.round(i * step);
    if (idx !== lastIndex) {
      out.push(all[idx] as T);
      lastIndex = idx;
    }
  }
  return out;
}

/** Run ffmpeg, resolving its captured stderr (0 exit) or rejecting (non-zero / timeout / missing binary). */
function runFfmpeg(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('ffmpeg timed out'));
    }, FFMPEG_TIMEOUT_MS);
    proc.stderr.on('data', (chunk: Buffer) => {
      // Bound memory: showinfo prints a line per selected frame — keep only the tail
      // needed to parse timestamps in pathological (thousands-of-changes) inputs.
      stderr = (stderr + chunk.toString()).slice(-4_000_000);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/**
 * Extract screen-share stills from a video URL via ffmpeg scene-change detection.
 * Streams the input (no full download), writes selected frames to a temp dir, pairs
 * each with its `showinfo` timestamp, caps the result, and returns the JPEG bytes.
 * The temp dir is always cleaned up. Returns `[]` when there are no scene changes
 * (e.g. nobody screen-shared). Throws only on an ffmpeg/IO failure (caller is
 * best-effort). Not unit-tested (needs a real recording) — the pure helpers are.
 */
export async function extractScreenShareStills(
  videoUrl: string,
  opts: {
    readonly log: FastifyBaseLogger;
    readonly maxStills?: number;
    readonly sceneThreshold?: number;
  },
): Promise<ExtractedStill[]> {
  const max = opts.maxStills ?? DEFAULT_MAX_STILLS;
  const threshold = opts.sceneThreshold ?? DEFAULT_SCENE_THRESHOLD;
  const dir = await mkdtemp(join(tmpdir(), 'stills-'));
  try {
    const stderr = await runFfmpeg([
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'info',
      '-i',
      videoUrl,
      '-an',
      '-vf',
      `select='gt(scene,${threshold})',showinfo,scale='min(${MAX_WIDTH},iw)':-2`,
      '-vsync',
      'vfr',
      '-q:v',
      '5',
      join(dir, 'still-%04d.jpg'),
    ]);

    const timestamps = parseSceneTimestamps(stderr);
    const files = (await readdir(dir)).filter((f) => f.endsWith('.jpg')).sort();
    // Pair by order: the i-th showinfo pts_time ↔ the i-th written frame.
    const paired = files
      .slice(0, timestamps.length)
      .map((file, i) => ({ tsSeconds: Math.max(0, Math.round(timestamps[i] as number)), file }));

    const chosen = selectStills(paired, max);
    const stills: ExtractedStill[] = [];
    for (const { tsSeconds, file } of chosen) {
      stills.push({ tsSeconds, jpeg: await readFile(join(dir, file)) });
    }
    opts.log.info(
      { candidates: paired.length, kept: stills.length },
      'stills: extracted screen-share frames',
    );
    return stills;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
