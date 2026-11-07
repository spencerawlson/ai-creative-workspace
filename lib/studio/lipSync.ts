/** Lip sync from a sound: the mouth's five shapes (A, I, U, E, O; see
 * the `mouth` joint in pose.ts), frame by frame, read from the sound
 * itself. Plain signal processing, on the device:
 *
 * - how far the mouth opens follows how loud the voice is, relative to
 *   this recording's own quiet and loud parts (silence closes it);
 * - which shape follows the vowel's colour: the voice's first two
 *   resonances (formants F1, F2), found from a linear-prediction (LPC)
 *   spectral envelope, compared with each vowel's, scaled to this
 *   speaker's average voice.
 *
 * It reads vowels, not words: consonants show as the mouth closing
 * between them. Good enough for speech and singing to read as such;
 * not a phoneme recogniser. */

export const SPEECH_FPS = 20;
/** The mouth dofs, in the order frames store them. */
export const VISEMES = ["aa", "ih", "ou", "ee", "oh"] as const;
export type Viseme = (typeof VISEMES)[number];

/** Typical formants (Hz) of each vowel as the controls name them
 * (father, see, you, bed, go), averaged over men and women; a speaker's
 * own are found by scaling these to their voice. */
const VOWEL_FORMANTS: Record<Viseme, [number, number]> = {
  aa: [780, 1150],
  ih: [300, 2300],
  ou: [340, 1050],
  ee: [550, 1850],
  oh: [530, 880],
};
/** The middle of that vowel space, for the speaker's scale. */
const MEAN_F1 = 500;
const MEAN_F2 = 1446;
/** Crossing zero this often (per sample), a frame is a hiss (s, f,
 * sh, t), not a vowel. */
const MAX_VOWEL_ZCR = 0.3;
/** Formants no vowel has (breath, hiss): too open, too front, or both. */
const isVowel = ([f1, f2]: [number, number]) =>
  f1 < 1100 && f2 < 3300 && !(f1 > 700 && f2 > 2600);
/** A speaker's voice against the average: men to children. */
const SCALE = [0.85, 1.3] as const;
/** How open the mouth is on a hiss, against a vowel as loud. */
const CONSONANT_OPEN = 0.35;

/** Analysis rate: formants live below 4 kHz. */
const TARGET_RATE = 11025;
const LPC_ORDER = 10;
const WINDOW_S = 0.03;
/** Lag-window width (Hz): see lpc(). */
const LAG_HZ = 30;

export interface LipSyncResult {
  /** SPEECH_FPS frames of the VISEMES weights, 0–100 each, flattened. */
  frames: Uint8Array;
  /** Seconds. */
  duration: number;
  /** Share of frames where the voice was heard, 0–1. */
  voiced: number;
}

/** Mix to mono and low-pass + decimate to about TARGET_RATE. */
export function downsample(
  channels: Float32Array[],
  rate: number,
): { samples: Float32Array; rate: number } {
  const n = channels[0]?.length ?? 0;
  const mono = new Float32Array(n);
  for (const c of channels)
    for (let i = 0; i < n; i++) mono[i] += c[i] / channels.length;
  const factor = Math.max(1, Math.floor(rate / TARGET_RATE));
  if (factor === 1) return { samples: mono, rate };
  // Windowed-sinc low-pass at 90% of the new Nyquist.
  const half = 4 * factor;
  const cutoff = 0.45 / factor;
  const taps = new Float32Array(2 * half + 1);
  let sum = 0;
  for (let k = -half; k <= half; k++) {
    const sinc =
      k === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * k) / (Math.PI * k);
    const w = 0.54 + 0.46 * Math.cos((Math.PI * k) / half);
    taps[k + half] = sinc * w;
    sum += sinc * w;
  }
  const out = new Float32Array(Math.floor(n / factor));
  for (let j = 0; j < out.length; j++) {
    const c = j * factor;
    let acc = 0;
    for (let k = -half; k <= half; k++) {
      const i = c + k;
      if (i >= 0 && i < n) acc += mono[i] * taps[k + half];
    }
    out[j] = acc / sum;
  }
  return { samples: out, rate: rate / factor };
}

/** LPC coefficients a[1..p] (x[n] ≈ Σ a[k] x[n−k]) by Levinson–Durbin;
 * null for a silent frame. */
export function lpc(
  frame: Float32Array,
  order: number,
  rate: number,
): Float64Array | null {
  const r = new Float64Array(order + 1);
  for (let lag = 0; lag <= order; lag++) {
    let s = 0;
    for (let i = lag; i < frame.length; i++) s += frame[i] * frame[i - lag];
    r[lag] = s;
  }
  if (r[0] <= 1e-12) return null;
  // A lag window smooths the envelope over the voice pitch harmonics
  // (a high voice otherwise drags the formants onto them), and a
  // little white noise keeps it stable.
  for (let lag = 1; lag <= order; lag++)
    r[lag] *= Math.exp(-0.5 * ((2 * Math.PI * LAG_HZ * lag) / rate) ** 2);
  r[0] *= 1 + 1e-4;
  const a = new Float64Array(order + 1);
  let err = r[0];
  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc -= a[j] * r[i - j];
    const k = acc / err;
    const prev = a.slice();
    a[i] = k;
    for (let j = 1; j < i; j++) a[j] = prev[j] - k * prev[i - j];
    err *= 1 - k * k;
    if (err <= 0) return null;
  }
  return a;
}

/** The first two formants (Hz) from the LPC envelope's peaks, or null. */
export function formants(
  a: Float64Array,
  rate: number,
): [number, number] | null {
  const step = 10;
  const top = Math.min(4000, rate / 2 - step);
  const env: number[] = [];
  for (let f = 0; f <= top; f += step) {
    const w = (2 * Math.PI * f) / rate;
    let re = 1;
    let im = 0;
    for (let k = 1; k < a.length; k++) {
      re -= a[k] * Math.cos(w * k);
      im += a[k] * Math.sin(w * k);
    }
    env.push(-Math.log(re * re + im * im));
  }
  const peaks: number[] = [];
  for (let i = 1; i < env.length - 1; i++) {
    const f = i * step;
    if (f < 200) continue;
    if (env[i] > env[i - 1] && env[i] >= env[i + 1]) peaks.push(f);
  }
  return peaks.length < 2 ? null : [peaks[0], peaks[1]];
}

/** Weights of the five vowels (summing to 1) for formants f1, f2 of a
 * speaker whose voice runs `scale` times the average. */
export function vowelWeights(
  f1: number,
  f2: number,
  scale = 1,
): Record<Viseme, number> {
  const d = VISEMES.map((v) => {
    const [r1, r2] = VOWEL_FORMANTS[v];
    // Log distance; F1 (how open) counts a little more than F2.
    const e1 = Math.log(f1 / (r1 * scale)) / 0.25;
    const e2 = Math.log(f2 / (r2 * scale)) / 0.3;
    return e1 * e1 + e2 * e2;
  });
  const min = Math.min(...d);
  const w = d.map((x) => Math.exp(-(x - min) * 1.5));
  const sum = w.reduce((s, x) => s + x, 0);
  return Object.fromEntries(VISEMES.map((v, i) => [v, w[i] / sum])) as Record<
    Viseme,
    number
  >;
}

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const s = [...values].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

/** The mouth for every frame of a sound: channels of samples at `rate`. */
export function lipSync(channels: Float32Array[], rate: number): LipSyncResult {
  const { samples, rate: r } = downsample(channels, rate);
  const duration = (channels[0]?.length ?? 0) / rate;
  const count = Math.max(1, Math.ceil(duration * SPEECH_FPS));
  const win = Math.round(WINDOW_S * r);
  const hamming = Float32Array.from(
    { length: win },
    (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (win - 1)),
  );

  // Pass 1: loudness, and formants where the frame is a vowel.
  const db: number[] = [];
  const fm: Array<[number, number] | null> = [];
  const frame = new Float32Array(win);
  for (let i = 0; i < count; i++) {
    const c = Math.round((i / SPEECH_FPS) * r);
    let energy = 0;
    let crossings = 0;
    let before = 0;
    for (let k = 0; k < win; k++) {
      const j = c - (win >> 1) + k;
      const x = j >= 0 && j < samples.length ? samples[j] : 0;
      const prev = j - 1 >= 0 && j - 1 < samples.length ? samples[j - 1] : 0;
      energy += x * x;
      if (k > 0 && x >= 0 !== before >= 0) crossings++;
      before = x;
      // Pre-emphasis lifts the higher formants for LPC.
      frame[k] = (x - 0.8 * prev) * hamming[k];
    }
    db.push(10 * Math.log10(energy / win + 1e-12));
    const a = crossings / win < MAX_VOWEL_ZCR ? lpc(frame, LPC_ORDER, r) : null;
    const f = a && formants(a, r);
    fm.push(f && isVowel(f) ? f : null);
  }

  // Quiet and loud for this recording; silence well below speech.
  const loud = percentile(db, 0.95);
  const floor = Math.max(percentile(db, 0.1) + 6, loud - 40);
  const heard = db.map((d) => d > floor);

  // The speaker's scale: their average formants against the average.
  const voiced = fm.filter((f, i): f is [number, number] => !!f && heard[i]);
  const scale = voiced.length
    ? clamp(
        Math.sqrt(
          (percentile(
            voiced.map((f) => f[0]),
            0.5,
          ) /
            MEAN_F1) *
            (percentile(
              voiced.map((f) => f[1]),
              0.5,
            ) /
              MEAN_F2),
        ),
        ...SCALE,
      )
    : 1;

  // Pass 2: the mouth, smoothed (it opens fast, closes a little slower).
  const out = new Uint8Array(count * VISEMES.length);
  const cur = new Float64Array(VISEMES.length);
  let last: Record<Viseme, number> | null = null;
  for (let i = 0; i < count; i++) {
    const f = fm[i];
    const open = heard[i]
      ? Math.min(1, Math.max(0, (db[i] - floor) / Math.max(6, loud - floor))) *
        (f ? 1 : CONSONANT_OPEN)
      : 0;
    if (f && heard[i]) last = vowelWeights(f[0], f[1], scale);
    const w = last ?? vowelWeights(MEAN_F1, MEAN_F2);
    VISEMES.forEach((v, k) => {
      const target = open * w[v];
      const rate = target > cur[k] ? 0.8 : 0.55;
      cur[k] += (target - cur[k]) * rate;
      if (target === 0 && cur[k] < 0.01) cur[k] = 0;
      out[i * VISEMES.length + k] = Math.round(cur[k] * 100);
    });
  }
  return {
    frames: out,
    duration,
    voiced: heard.filter(Boolean).length / count,
  };
}

/** The mouth at `t` seconds into a track's frames (between frames,
 * blended); null outside it. */
export function mouthAt(
  frames: Uint8Array,
  t: number,
): Record<Viseme, number> | null {
  const n = frames.length / VISEMES.length;
  const x = t * SPEECH_FPS;
  if (n === 0 || x < 0 || x > n - 1 + 1e-6) return null;
  const i = Math.min(n - 1, Math.floor(x));
  const j = Math.min(n - 1, i + 1);
  const u = x - i;
  return Object.fromEntries(
    VISEMES.map((v, k) => [
      v,
      Math.round(
        frames[i * VISEMES.length + k] * (1 - u) +
          frames[j * VISEMES.length + k] * u,
      ),
    ]),
  ) as Record<Viseme, number>;
}
