/** Typed search over the motion library: "running", "left kick",
 * "walk 3 times slowly", "eat", even "walkng". Pure; no React.
 *
 * Words are matched after light stemming (running -> run, ate -> eat),
 * against each motion's name and its other words; a word still being
 * typed matches by prefix, and small typos are forgiven. Words that
 * change how a move is done (left, twice, slowly, in place,
 * backwards) become options instead of search words. */

import {
  MOTIONS,
  repeatable,
  type Motion,
  type MotionOptions,
} from "./motions";

export interface MotionMatch {
  motion: Motion;
  score: number;
  options: MotionOptions;
}

const IRREGULAR: Record<string, string> = {
  ran: "run",
  running: "run",
  threw: "throw",
  thrown: "throw",
  ate: "eat",
  eaten: "eat",
  drank: "drink",
  drunk: "drink",
  sat: "sit",
  sitting: "sit",
  knelt: "kneel",
  kneeled: "kneel",
  swam: "swim",
  jumped: "jump",
  hopping: "hop",
  stood: "stand",
  clapping: "clap",
  waving: "wave",
  dancing: "dance",
  shook: "shake",
  caught: "catch",
  swung: "swing",
  bowed: "bow",
  hugging: "hug",
  climbed: "climb",
  stepping: "step",
  jogging: "jog",
  nodding: "nod",
  spinning: "spin",
  squatting: "squat",
  typing: "type",
  pulling: "pull",
  pushing: "push",
};

const STOP = new Set([
  "a",
  "an",
  "the",
  "to",
  "do",
  "doing",
  "make",
  "him",
  "her",
  "them",
  "it",
  "is",
  "be",
  "and",
  "with",
  "of",
  "some",
  "please",
  "figure",
  "mannequin",
  "man",
  "woman",
  "person",
  "character",
  "pose",
  "move",
  "animation",
  "animate",
  "motion",
  "like",
  "he",
  "she",
  "they",
  "on",
  "his",
  "their",
  "s",
  "in",
  "at",
  "for",
  "my",
  "your",
  "say",
  "have",
  "go",
]);

const NUMBER_WORDS: Record<string, number> = {
  once: 1,
  twice: 2,
  thrice: 3,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

export function stem(word: string): string {
  const w = word.toLowerCase();
  if (IRREGULAR[w]) return stem(IRREGULAR[w]);
  if (w.length > 5 && w.endsWith("ing")) {
    const base = w.slice(0, -3);
    // running -> run, sitting -> sit; dancing -> danc (as "dance")
    if (/(.)\1$/.test(base)) return base.slice(0, -1);
    return base;
  }
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("es") && /(ss|sh|ch|x)es$/.test(w))
    return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss"))
    return w.slice(0, -1);
  // "dance" and "danc(ing)" meet at "danc".
  if (w.length > 4 && w.endsWith("e")) return w.slice(0, -1);
  return w;
}

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Edit distance (a swap of two neighbours, "wlak", counts as one),
 * stopping early above `max`. */
export function distance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, before[j - 2] + 1);
      cur.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    before = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** The modifiers in a query, and the words left to search with. */
/** "10 seconds", "10s", "2.5 sec", "1 minute", "1.5 mins", "1m30s". */
const DURATION =
  /(\d+(?:[.,]\d+)?)\s*(m|mins?|minutes?)\s*(?:(\d+)\s*(?:s|secs?|seconds?)\b)?|(\d+(?:[.,]\d+)?)\s*(s|secs?|seconds?)\b/i;

/** A length typed into the query, in seconds, and the text without it. */
export function parseSeconds(text: string): { seconds?: number; rest: string } {
  const m = DURATION.exec(text);
  if (!m) return { rest: text };
  const num = (v: string) => Number(v.replace(",", "."));
  const seconds = m[1] ? num(m[1]) * 60 + (m[3] ? Number(m[3]) : 0) : num(m[4]);
  if (!(seconds > 0)) return { rest: text };
  return {
    seconds,
    rest: text.slice(0, m.index) + " " + text.slice(m.index + m[0].length),
  };
}

export function parseQuery(text: string): {
  terms: string[];
  options: MotionOptions;
  /** The last word is still being typed (no space after it). */
  partial: boolean;
} {
  const timed = parseSeconds(text);
  const all = words(timed.rest);
  const options: MotionOptions = {};
  if (timed.seconds) options.seconds = Math.min(120, timed.seconds);
  const terms: string[] = [];
  for (let i = 0; i < all.length; i++) {
    const w = all[i];
    const next = all[i + 1];
    if (w === "left" || w === "lefty") options.mirror = true;
    else if (w === "right") options.mirror = false;
    else if ((/^\d+$/.test(w) || NUMBER_WORDS[w]) && w !== "360") {
      const n = /^\d+$/.test(w) ? Number(w) : NUMBER_WORDS[w];
      if (["once", "twice", "thrice"].includes(w)) options.repeat = n;
      else if (next === "time" || next === "times" || next === "x") {
        options.repeat = n;
        i++;
      } else options.repeat = n;
    } else if (/^\d+x$/.test(w)) options.repeat = Number(w.slice(0, -1));
    else if (["slow", "slowly", "slower"].includes(w)) options.slow = 1.6;
    else if (["fast", "quick", "quickly", "faster"].includes(w))
      options.slow = 0.7;
    else if (w === "in" && next === "place") {
      options.inPlace = true;
      i++;
    } else if (["stationary", "treadmill", "spot"].includes(w))
      options.inPlace = true;
    else if (["backwards", "backward", "back"].includes(w) && terms.length)
      options.backwards = true;
    else if (!STOP.has(w)) terms.push(w);
  }
  if (options.repeat !== undefined)
    options.repeat = Math.max(1, Math.min(100, options.repeat));
  return { terms, options, partial: !/\s$/.test(text) };
}

interface Indexed {
  motion: Motion;
  name: string[];
  other: string[];
}

const INDEX: Indexed[] = MOTIONS.map((motion) => ({
  motion,
  name: [...words(motion.name), ...words(motion.id)].map(stem),
  other: motion.words.flatMap(words).map(stem),
}));

/** How well one query word matches one of a motion's words. Typos only
 * count when `fuzzy` (no motion has the word as typed). */
function wordScore(q: string, w: string, last: boolean, fuzzy = false): number {
  if (q === w) return 3;
  if (last && q.length >= 2 && w.startsWith(q)) return 2;
  if (fuzzy && q.length >= 4 && w.length >= 4) {
    const d = distance(q, w, 2);
    if (d === 1) return 1.6;
    if (d === 2 && q.length >= 6) return 1;
  }
  return 0;
}

/** Motions matching the typed text, best first. Empty text: none. */
export function searchMotions(text: string, limit = 8): MotionMatch[] {
  const { terms, options, partial } = parseQuery(text);
  if (terms.length === 0) return [];
  const stems = terms.map(stem);
  const raws = terms.map((t, i) =>
    i === terms.length - 1 && partial ? t : null,
  );
  const exact = (i: number, w: string) =>
    Math.max(
      wordScore(stems[i], w, false),
      raws[i] ? wordScore(raws[i]!, w, true) : 0,
    );
  // "Did you mean": typos are forgiven only for words nothing matches.
  const fuzzy = stems.map(
    (_, i) =>
      !INDEX.some(({ name, other }) =>
        [...name, ...other].some((w) => exact(i, w) > 0),
      ),
  );
  const out: MotionMatch[] = [];
  for (const { motion, name, other } of INDEX) {
    let score = 0;
    let matched = 0;
    stems.forEach((q, i) => {
      // A word still being typed also matches by prefix, as typed.
      const raw = raws[i];
      const score1 = (w: string) =>
        Math.max(
          wordScore(q, w, false, fuzzy[i]),
          raw ? wordScore(raw, w, true, fuzzy[i]) : 0,
        );
      const best = Math.max(
        0,
        ...name.map((w) => score1(w) * 1.2),
        ...other.map(score1),
      );
      if (best > 0) matched++;
      score += best;
    });
    if (matched === 0) continue;
    // Every word matching beats one strong word among several.
    score *= matched / stems.length;
    out.push({ motion, score, options: { ...options } });
  }
  return out
    .sort(
      (a, b) =>
        b.score - a.score ||
        MOTIONS.indexOf(a.motion) - MOTIONS.indexOf(b.motion),
    )
    .slice(0, limit);
}

/** A short description of the options, for the result row. */
export function describeOptions(m: MotionMatch): string {
  const o = m.options;
  const bits: string[] = [];
  if (o.mirror && m.motion.sided) bits.push("left");
  if (o.seconds && m.motion.kind === "move") bits.push(`${o.seconds} s`);
  else if (o.repeat && repeatable(m.motion)) bits.push(`${o.repeat}×`);
  if (o.slow && o.slow > 1) bits.push("slow");
  if (o.slow && o.slow < 1) bits.push("fast");
  if (o.inPlace && m.motion.travel) bits.push("in place");
  if (o.backwards && m.motion.travel) bits.push("backwards");
  return bits.join(", ");
}
