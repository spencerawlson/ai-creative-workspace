import { describe, expect, it } from "vitest";
import {
  SPEECH_FPS,
  VISEMES,
  lipSync,
  mouthAt,
  type Viseme,
} from "@/lib/studio/lipSync";

const RATE = 44100;

/** A vowel from a formant synthesiser: a glottal pulse train at `f0`
 * through resonators at the formants (Klatt-style, cascade), with a
 * voice's spectral tilt. */
function vowel(
  formants: number[],
  seconds: number,
  f0: number,
  gain = 1,
): Float32Array {
  const n = Math.round(seconds * RATE);
  let x = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += f0 / RATE;
    if (phase >= 1) {
      phase -= 1;
      x[i] = 1;
    }
  }
  const bandwidths = [80, 100, 140, 200];
  formants.forEach((f, k) => {
    const bw = bandwidths[k];
    const r = Math.exp((-Math.PI * bw) / RATE);
    const c = -r * r;
    const b = 2 * r * Math.cos((2 * Math.PI * f) / RATE);
    const a = 1 - b - c;
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++)
      y[i] = a * x[i] + b * (y[i - 1] ?? 0) + c * (y[i - 2] ?? 0);
    x = y;
  });
  // A real voice falls off towards the highs (about −6 dB an octave).
  for (let i = 1; i < n; i++) x[i] += 0.92 * x[i - 1];
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  return x.map((v) => (v / peak) * 0.5 * gain);
}

const silence = (seconds: number) =>
  new Float32Array(Math.round(seconds * RATE));

function concat(parts: Float32Array[]) {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Peterson–Barney style averages (men); women ≈ 1.17×. */
const MEN: Record<Viseme, number[]> = {
  aa: [730, 1090, 2440, 3400],
  ih: [270, 2290, 3010, 3700],
  ou: [300, 870, 2240, 3300],
  ee: [530, 1840, 2480, 3500],
  oh: [570, 840, 2410, 3300],
};

/** The shape that wins over the middle of each half-second vowel. */
function winners(frames: Uint8Array, starts: number[]) {
  return starts.map((s) => {
    const totals = VISEMES.map(() => 0);
    for (let t = s + 0.15; t < s + 0.4; t += 1 / SPEECH_FPS) {
      const m = mouthAt(frames, t)!;
      VISEMES.forEach((v, k) => (totals[k] += m[v]));
    }
    return VISEMES[totals.indexOf(Math.max(...totals))];
  });
}

describe("lip sync from a sound", () => {
  for (const [who, f0, scale] of [
    ["a lower voice", 115, 1],
    ["a higher voice", 210, 1.17],
  ] as const) {
    it(`reads each vowel's shape for ${who}`, () => {
      const parts: Float32Array[] = [silence(0.3)];
      const starts: number[] = [];
      let t = 0.3;
      for (const v of VISEMES) {
        starts.push(t);
        parts.push(
          vowel(
            MEN[v].map((f) => f * scale),
            0.5,
            f0,
          ),
          silence(0.2),
        );
        t += 0.7;
      }
      const r = lipSync([concat(parts)], RATE);
      expect(winners(r.frames, starts)).toEqual([...VISEMES]);
    });
  }

  it("closes the mouth in silence and opens it more for a louder voice", () => {
    const sound = concat([
      silence(0.5),
      vowel(MEN.aa, 0.5, 120, 0.15),
      silence(0.5),
      vowel(MEN.aa, 0.5, 120, 1),
      silence(0.5),
    ]);
    const r = lipSync([sound], RATE);
    expect(r.duration).toBeCloseTo(2.5, 5);
    expect(r.frames.length).toBe(50 * VISEMES.length);
    const open = (t: number) =>
      Object.values(mouthAt(r.frames, t)!).reduce((s, x) => s + x, 0);
    expect(open(0.25)).toBe(0);
    expect(open(1.3)).toBeLessThan(15);
    expect(open(2.3)).toBe(0);
    expect(open(0.75)).toBeGreaterThan(5);
    expect(open(1.75)).toBeGreaterThan(open(0.75) + 30);
    expect(r.voiced).toBeGreaterThan(0.3);
    expect(r.voiced).toBeLessThan(0.5);
  });

  it("is silent for a silent sound, and has nothing outside its length", () => {
    const r = lipSync([silence(1), silence(1)], 48000);
    expect(r.frames.every((x) => x === 0)).toBe(true);
    expect(r.voiced).toBe(0);
    expect(mouthAt(r.frames, -0.1)).toBeNull();
    expect(mouthAt(r.frames, 1.5)).toBeNull();
    expect(mouthAt(r.frames, 0.5)).toEqual({
      aa: 0,
      ih: 0,
      ou: 0,
      ee: 0,
      oh: 0,
    });
  });
});
