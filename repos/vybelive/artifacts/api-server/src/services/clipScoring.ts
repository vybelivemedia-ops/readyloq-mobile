/**
 * clipScoring — turns markers + honest signals into ranked, scored clip windows.
 *
 * Pipeline (deterministic, no randomness):
 *   1. Seed candidate centers from: P2 markers, audio-loudness peaks, and
 *      scene-change clusters.
 *   2. Merge nearby centers (co-occurrence: a voice marker on a loud moment
 *      reinforces, rather than duplicates).
 *   3. Score each candidate:
 *        intentScore  — markers × source base weight × marker confidence ×
 *                       learned (creator + universal) source weights.
 *        signalScore  — audio energy + scene density × learned signal weights.
 *        confidence   — clamp01(0.6·intentNorm + 0.4·signalScore).
 *   4. Rank by confidence × learned format weight; greedily pick the top N
 *      non-overlapping windows.
 *   5. Assign a format by confidence tier (highlight/reel/short/story), which
 *      sets duration, aspect ratio, and crop mode.
 *
 * Fallback: when there are no markers and no meaningful signals, fall back to
 * even-distribution sampling (low confidence, clearly labeled as such).
 */

import type { SignalTimeline } from "./signalExtraction";
import type { WeightSet } from "./clipLearning";
import { getWeight } from "./clipLearning";

export type ClipFormat = "highlight" | "reel" | "short" | "story";
export type MarkerSource = "voice" | "gesture" | "manual" | "ai";
export type AspectRatio = "vertical" | "horizontal" | "square";

export interface ScoringMarker {
  source: MarkerSource;
  streamSecond: number;
  contextWindowSeconds: number;
  score: number | null;
}

export interface SelectedClip {
  startSec: number;
  durationSec: number;
  format: ClipFormat;
  aspectRatio: AspectRatio;
  cropMode: string;
  confidence: number;
  confidenceReason: string;
  intentScore: number;
  signalScore: number;
  /** Dominant marker source, or null for a signal-only / fallback clip. */
  source: MarkerSource | null;
  /** Context signals that contributed (e.g. ["audio_spike", "scene_change"]). */
  signals: string[];
}

// Base trust per marker source — explicit creator intent ranks above AI guesses.
const SOURCE_BASE: Record<MarkerSource, number> = {
  voice: 1.0,
  gesture: 0.9,
  manual: 0.85,
  ai: 0.5,
};

const FORMAT_SPEC: Record<ClipFormat, { durationSec: number; aspectRatio: AspectRatio; cropMode: string }> = {
  highlight: { durationSec: 60, aspectRatio: "horizontal", cropMode: "fit 16:9" },
  reel: { durationSec: 45, aspectRatio: "vertical", cropMode: "center-crop 9:16" },
  short: { durationSec: 30, aspectRatio: "vertical", cropMode: "center-crop 9:16" },
  story: { durationSec: 15, aspectRatio: "vertical", cropMode: "center-crop 9:16" },
};

// A single strong marker (voice, score 1, neutral weights) reaches this intent.
const INTENT_REF = 1.0;
// Candidate centers within this many seconds are merged into one.
const MERGE_GAP_SEC = 10;
// Selected clips must be at least this far apart to avoid near-duplicates.
const MIN_SEPARATION_SEC = 20;
// Window (seconds) used to gather signal energy around a candidate center.
const SCORING_WINDOW_SEC = 30;

const SOURCE_LABEL: Record<MarkerSource, string> = {
  voice: "voice command",
  gesture: "gesture",
  manual: "manual tap",
  ai: "AI",
};
const SIGNAL_LABEL: Record<string, string> = {
  audio_spike: "audio spike",
  scene_change: "scene change",
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function tierFormat(confidence: number): ClipFormat {
  if (confidence >= 0.75) return "highlight";
  if (confidence >= 0.55) return "reel";
  if (confidence >= 0.4) return "short";
  return "story";
}

interface Candidate {
  center: number;
  markers: ScoringMarker[];
}

/** Audio-loudness peaks: seconds whose amplitude exceeds mean + 1σ and 30% of peak. */
function audioPeakCenters(timeline: SignalTimeline): number[] {
  const { audio, maxAmplitude } = timeline;
  if (audio.length === 0 || maxAmplitude <= 0) return [];

  const amps = audio.map((s) => s.amplitude);
  const mean = amps.reduce((a, b) => a + b, 0) / amps.length;
  const variance = amps.reduce((a, b) => a + (b - mean) * (b - mean), 0) / amps.length;
  const std = Math.sqrt(variance);
  const threshold = Math.max(mean + std, maxAmplitude * 0.3);

  const centers: number[] = [];
  let runBestSecond = -1;
  let runBestAmp = -1;
  let lastSecond = -10;
  for (const s of audio) {
    if (s.amplitude >= threshold) {
      const contiguous = s.second - lastSecond <= 2;
      if (!contiguous && runBestSecond >= 0) {
        centers.push(runBestSecond);
        runBestAmp = -1;
        runBestSecond = -1;
      }
      if (s.amplitude > runBestAmp) {
        runBestAmp = s.amplitude;
        runBestSecond = s.second;
      }
      lastSecond = s.second;
    }
  }
  if (runBestSecond >= 0) centers.push(runBestSecond);
  return centers;
}

/** Scene-change clusters: group cuts within 5s; anchor at the cluster's middle. */
function sceneClusterCenters(timeline: SignalTimeline): number[] {
  const times = [...timeline.sceneChanges].sort((a, b) => a - b);
  if (times.length === 0) return [];
  const centers: number[] = [];
  let group: number[] = [];
  const flush = () => {
    if (group.length > 0) {
      centers.push(Math.round(group[Math.floor(group.length / 2)]!));
      group = [];
    }
  };
  for (const t of times) {
    if (group.length > 0 && t - group[group.length - 1]! > 5) flush();
    group.push(t);
  }
  flush();
  return centers;
}

/** Merge candidate centers that fall within MERGE_GAP_SEC of each other. */
function mergeCandidates(
  markers: ScoringMarker[],
  signalCenters: number[]
): Candidate[] {
  const points: Array<{ center: number; marker?: ScoringMarker }> = [];
  for (const m of markers) points.push({ center: m.streamSecond, marker: m });
  for (const c of signalCenters) points.push({ center: c });
  points.sort((a, b) => a.center - b.center);

  const merged: Candidate[] = [];
  for (const p of points) {
    const last = merged[merged.length - 1];
    if (last && p.center - last.center <= MERGE_GAP_SEC) {
      if (p.marker) last.markers.push(p.marker);
      // keep the cluster center as the earliest seed (stable)
    } else {
      merged.push({ center: p.center, markers: p.marker ? [p.marker] : [] });
    }
  }
  return merged;
}

function amplitudeInWindow(timeline: SignalTimeline, start: number, end: number): number {
  let max = 0;
  for (const s of timeline.audio) {
    if (s.second >= start && s.second <= end && s.amplitude > max) max = s.amplitude;
  }
  return max;
}

function sceneCountInWindow(timeline: SignalTimeline, start: number, end: number): number {
  let n = 0;
  for (const t of timeline.sceneChanges) if (t >= start && t <= end) n++;
  return n;
}

function buildReason(source: MarkerSource | null, sources: Set<MarkerSource>, signals: string[]): string {
  const parts: string[] = [];
  if (sources.size > 0) {
    const labels = [...sources].map((s) => SOURCE_LABEL[s]);
    parts.push(`Marked by ${labels.join(" + ")}`);
  }
  for (const sig of signals) parts.push(SIGNAL_LABEL[sig] ?? sig);
  if (parts.length === 0) return "Evenly sampled (no markers or strong signals detected)";
  if (sources.size === 0) {
    return `Detected ${parts.join(" + ")}`;
  }
  return parts.join(" + ");
}

export interface SelectClipsInput {
  markers: ScoringMarker[];
  timeline: SignalTimeline;
  totalDuration: number;
  maxClips: number;
  fallbackDurationSec: number;
  creatorWeights: WeightSet;
  universalWeights: WeightSet;
}

interface Scored {
  center: number;
  confidence: number;
  intentScore: number;
  signalScore: number;
  source: MarkerSource | null;
  sources: Set<MarkerSource>;
  signals: string[];
  format: ClipFormat;
  rankScore: number;
}

function clampWindow(center: number, durationSec: number, totalDuration: number): { startSec: number; durationSec: number } {
  const dur = Math.min(durationSec, Math.floor(totalDuration));
  let start = Math.round(center - dur / 2);
  start = Math.max(0, Math.min(start, Math.floor(totalDuration) - dur));
  return { startSec: start, durationSec: dur };
}

/**
 * Main entry point. Returns the chosen clip windows, scored and formatted,
 * ordered by confidence (highest first).
 */
export function selectClips(input: SelectClipsInput): SelectedClip[] {
  const { markers, timeline, totalDuration, maxClips, fallbackDurationSec, creatorWeights, universalWeights } = input;

  const candidates = mergeCandidates(markers, [
    ...audioPeakCenters(timeline),
    ...sceneClusterCenters(timeline),
  ]);

  const scored: Scored[] = [];
  for (const cand of candidates) {
    const half = SCORING_WINDOW_SEC / 2;
    const wStart = Math.max(0, cand.center - half);
    const wEnd = Math.min(totalDuration, cand.center + half);

    // ── Intent score from markers (with learned source weights) ──────────────
    let intentScore = 0;
    const sources = new Set<MarkerSource>();
    for (const m of cand.markers) {
      const base = SOURCE_BASE[m.source];
      const markerConf = m.score ?? 1;
      const learned =
        getWeight(creatorWeights.sourceMap, m.source) * getWeight(universalWeights.sourceMap, m.source);
      intentScore += base * markerConf * learned;
      sources.add(m.source);
    }
    const intentNorm = clamp01(intentScore / INTENT_REF);

    // ── Signal score from honest audio/scene measurements ────────────────────
    const peakAmp = timeline.maxAmplitude > 0 ? amplitudeInWindow(timeline, wStart, wEnd) / timeline.maxAmplitude : 0;
    const scenes = sceneCountInWindow(timeline, wStart, wEnd);
    const signals: string[] = [];
    if (peakAmp >= 0.6) signals.push("audio_spike");
    if (scenes >= 1) signals.push("scene_change");

    const audioLearned =
      getWeight(creatorWeights.signalMap, "audio_spike") * getWeight(universalWeights.signalMap, "audio_spike");
    const sceneLearned =
      getWeight(creatorWeights.signalMap, "scene_change") * getWeight(universalWeights.signalMap, "scene_change");
    const audioComponent = clamp01(peakAmp * audioLearned);
    const sceneComponent = clamp01(Math.min(1, scenes / 3) * sceneLearned);
    const signalScore = clamp01(0.6 * audioComponent + 0.4 * sceneComponent);

    // Skip candidates that have neither intent nor any real signal.
    if (intentScore <= 0 && signals.length === 0) continue;

    const confidence = clamp01(0.6 * intentNorm + 0.4 * signalScore);
    const dominant = [...sources].sort((a, b) => SOURCE_BASE[b] - SOURCE_BASE[a])[0] ?? null;
    const format = tierFormat(confidence);
    const formatLearned =
      getWeight(creatorWeights.formatMap, format) * getWeight(universalWeights.formatMap, format);

    scored.push({
      center: cand.center,
      confidence,
      intentScore,
      signalScore,
      source: dominant,
      sources,
      signals,
      format,
      rankScore: confidence * formatLearned,
    });
  }

  // ── Fallback: nothing to go on — evenly sample, clearly labeled ────────────
  if (scored.length === 0) {
    return evenDistributionFallback(totalDuration, maxClips, fallbackDurationSec);
  }

  // ── Rank by learned-weighted confidence, pick non-overlapping windows ──────
  scored.sort((a, b) => b.rankScore - a.rankScore);
  const chosen: Scored[] = [];
  for (const s of scored) {
    if (chosen.length >= maxClips) break;
    if (chosen.some((c) => Math.abs(c.center - s.center) < MIN_SEPARATION_SEC)) continue;
    chosen.push(s);
  }

  chosen.sort((a, b) => b.confidence - a.confidence);
  return chosen.map((s) => {
    const spec = FORMAT_SPEC[s.format];
    const win = clampWindow(s.center, spec.durationSec, totalDuration);
    return {
      startSec: win.startSec,
      durationSec: win.durationSec,
      format: s.format,
      aspectRatio: spec.aspectRatio,
      cropMode: spec.cropMode,
      confidence: Number(s.confidence.toFixed(3)),
      confidenceReason: buildReason(s.source, s.sources, s.signals),
      intentScore: Number(s.intentScore.toFixed(3)),
      signalScore: Number(s.signalScore.toFixed(3)),
      source: s.source,
      signals: s.signals,
    };
  });
}

function evenDistributionFallback(
  totalDuration: number,
  maxClips: number,
  fallbackDurationSec: number
): SelectedClip[] {
  const numClips = Math.min(maxClips, Math.floor(totalDuration / fallbackDurationSec));
  if (numClips <= 0) return [];
  const spec = FORMAT_SPEC.short;
  const dur = Math.min(fallbackDurationSec, spec.durationSec);
  return Array.from({ length: numClips }, (_, i) => {
    const start = Math.floor((i / numClips) * (totalDuration - dur));
    return {
      startSec: start,
      durationSec: dur,
      format: "short" as ClipFormat,
      aspectRatio: spec.aspectRatio,
      cropMode: spec.cropMode,
      confidence: 0.3,
      confidenceReason: "Evenly sampled (no markers or strong signals detected)",
      intentScore: 0,
      signalScore: 0,
      source: null,
      signals: [],
    };
  });
}
