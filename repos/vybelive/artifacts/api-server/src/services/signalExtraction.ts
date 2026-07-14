/**
 * signalExtraction — honest, FFmpeg-derived context signals over a recording.
 *
 * We extract ONLY signals we can truthfully measure from the media itself:
 *   1. Per-second audio loudness (RMS, dBFS) — a single decode pass.
 *   2. Scene-change timestamps (visual cuts / motion) — a single decode pass.
 *
 * We deliberately do NOT fabricate viewer counts, laughter detection, or
 * face re-identification — those signals are not available from the recording
 * and inventing them would mislead the creator about why a clip was chosen.
 *
 * Both passes are read-only and stream the file once each. They run inside the
 * async clip job, so wall time is acceptable.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";

// Audio quieter than this (dBFS) is treated as effectively silent.
const SILENCE_FLOOR_DB = -120;
// Scene-change sensitivity for the FFmpeg `scene` detector (0..1). Lower = more cuts.
const SCENE_THRESHOLD = 0.3;

const FF_TIMEOUT_MS = 30 * 60 * 1000; // 30 min ceiling per pass
const FF_MAXBUFFER = 256 * 1024 * 1024;

export interface AudioSample {
  /** Whole-second offset into the recording. */
  second: number;
  /** RMS loudness in dBFS (negative; closer to 0 = louder). */
  rmsDb: number;
  /** Linear amplitude 0..1 derived from rmsDb (10^(db/20)). */
  amplitude: number;
}

export interface SignalTimeline {
  /** Per-second loudness samples (empty if the recording has no audio track). */
  audio: AudioSample[];
  /** Seconds at which a visual scene change was detected. */
  sceneChanges: number[];
  /** Peak linear amplitude observed across the whole recording (for normalization). */
  maxAmplitude: number;
}

function dbToAmplitude(db: number): number {
  if (!isFinite(db) || db <= SILENCE_FLOOR_DB) return 0;
  return Math.pow(10, db / 20);
}

/**
 * Extract a per-second audio RMS timeline.
 * Pipeline: downmix→8kHz mono, 1-second frames (asetnsamples), per-frame astats
 * (reset=1), and ametadata print of the RMS level to stdout.
 *
 * Returns [] if the recording has no audio stream (non-fatal).
 */
async function extractAudioTimeline(inputPath: string): Promise<AudioSample[]> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      FFMPEG_BIN,
      [
        "-hide_banner",
        "-nostats",
        "-i",
        inputPath,
        "-map",
        "0:a:0",
        "-af",
        "aresample=8000,asetnsamples=8000:p=0,astats=metadata=1:reset=1,ametadata=mode=print:file=-",
        "-f",
        "null",
        "-",
      ],
      { timeout: FF_TIMEOUT_MS, maxBuffer: FF_MAXBUFFER }
    );
    stdout = result.stdout;
  } catch {
    // No audio stream, or decode failure — treat as silent (honest: no audio signal).
    return [];
  }

  const samples: AudioSample[] = [];
  let currentSecond = -1;
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    const ptsMatch = line.match(/pts_time:([-\d.]+)/);
    if (ptsMatch) {
      currentSecond = Math.round(parseFloat(ptsMatch[1]!));
      continue;
    }
    const rmsMatch = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-?inf)/);
    if (rmsMatch && currentSecond >= 0) {
      const raw = rmsMatch[1]!;
      const rmsDb = raw.includes("inf") ? SILENCE_FLOOR_DB : parseFloat(raw);
      samples.push({ second: currentSecond, rmsDb, amplitude: dbToAmplitude(rmsDb) });
      currentSecond = -1;
    }
  }
  return samples;
}

/**
 * Extract scene-change timestamps using FFmpeg's scene detector + showinfo.
 * Returns the pts_time (seconds) of every detected cut. [] on failure.
 */
async function extractSceneChanges(inputPath: string): Promise<number[]> {
  let stderr: string;
  try {
    const result = await execFileAsync(
      FFMPEG_BIN,
      [
        "-hide_banner",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-vf",
        `select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
        "-an",
        "-f",
        "null",
        "-",
      ],
      { timeout: FF_TIMEOUT_MS, maxBuffer: FF_MAXBUFFER }
    );
    // showinfo logs to stderr.
    stderr = result.stderr;
  } catch {
    return [];
  }

  const times: number[] = [];
  for (const line of stderr.split("\n")) {
    const m = line.match(/Parsed_showinfo.*pts_time:([\d.]+)/);
    if (m) times.push(parseFloat(m[1]!));
  }
  return times;
}

/**
 * Run both signal passes over a recording. Each pass is independent and
 * failure-tolerant — a recording with no audio still yields scene signals.
 */
export async function extractSignalTimeline(inputPath: string): Promise<SignalTimeline> {
  const [audio, sceneChanges] = await Promise.all([
    extractAudioTimeline(inputPath),
    extractSceneChanges(inputPath),
  ]);
  const maxAmplitude = audio.reduce((m, s) => (s.amplitude > m ? s.amplitude : m), 0);
  return { audio, sceneChanges, maxAmplitude };
}
