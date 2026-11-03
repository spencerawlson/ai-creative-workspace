"use client";

/** Graph editor, after Maya's: the animated values (channels) of one
 * figure, light or the camera, drawn as curves over time with a point
 * at each keyframe. Drag a point up/down to change that value in that
 * key, or sideways to retime the key; click a point to choose how it
 * travels to the next key (smooth, linear, step); click the background
 * to move the playhead. Every edit is a normal, undoable action. */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Selection } from "@/lib/engine/StudioEngine";
import {
  channelId,
  channelValue,
  evaluate,
  keyAt,
  keyValue,
  splineSlope,
} from "@/lib/studio/animation";
import {
  channelRange,
  channelsOf,
  fitValue,
  ownerId,
  owners,
  type ChannelOwner,
} from "@/lib/studio/channels";
import {
  EASES,
  type Channel,
  type Figure,
  type Keyframe,
} from "@/lib/studio/schema";
import { jointFromSelection } from "./PoseInspector";
import type { Studio } from "./useStudio";
import { Segmented, cx } from "./ui";

const COLOURS = [
  "#f87171",
  "#4ade80",
  "#60a5fa",
  "#facc15",
  "#c084fc",
  "#2dd4bf",
  "#fb923c",
  "#f472b6",
];
const PAD = { l: 44, r: 12, t: 10, b: 20 };
const SAMPLES = 120;

/** What the studio has selected → which object's channels to show. */
function ownerFor(selection: Selection, figure: Figure): ChannelOwner {
  if (selection === "camera") return { kind: "camera" };
  if (
    selection &&
    !["model", "pose", "backdrop"].includes(selection) &&
    !selection.startsWith("pose:")
  )
    return { kind: "light", id: selection };
  return { kind: "figure", id: figure.id };
}

/** Channels shown by default for an owner (and selected joint). */
function defaults(
  list: { channel: Channel }[],
  selection: Selection,
): Set<string> {
  const joint = jointFromSelection(selection);
  const picked = joint
    ? list.filter(
        (c) => c.channel.kind === "joint" && c.channel.joint === joint,
      )
    : list.filter(
        (c) =>
          c.channel.kind !== "joint" &&
          (c.channel.kind !== "light" ||
            ["azimuth", "elevation", "intensity"].includes(c.channel.field)),
      );
  return new Set(picked.map((c) => channelId(c.channel)));
}

export function GraphEditor({
  studio,
  figure,
  selection,
  time,
  onSeek,
  fill = false,
}: {
  studio: Studio;
  figure: Figure;
  selection: Selection;
  time: number;
  onSeek: (t: number) => void;
  /** Fill the parent (phones) instead of a fixed-height strip. */
  fill?: boolean;
}) {
  const { scene, dispatch, seal } = studio;
  const { duration, keys } = scene.animation;

  const [owner, setOwner] = useState<ChannelOwner>(() =>
    ownerFor(selection, figure),
  );
  // Follow the studio's selection.
  const selKey = `${selection}|${figure.id}`;
  useEffect(() => setOwner(ownerFor(selection, figure)), [selKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => channelsOf(scene, owner), [scene, owner]);
  const [shown, setShown] = useState<Set<string>>(() =>
    defaults(list, selection),
  );
  // Reset the shown channels when the object or selection changes (not
  // on every edit, which would undo the user's ticks).
  const ownerKey = ownerId(owner);
  useEffect(
    () => setShown(defaults(list, selection)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownerKey, selKey],
  );
  const visible = list.filter((c) => shown.has(channelId(c.channel)));
  const colour = (ch: Channel) =>
    COLOURS[
      list.findIndex((c) => channelId(c.channel) === channelId(ch)) %
        COLOURS.length
    ];

  // Curves: the scene sampled across the animation.
  const samples = useMemo(() => {
    const times = Array.from(
      { length: SAMPLES + 1 },
      (_, i) => (i / SAMPLES) * duration,
    );
    return times.map((t) => ({ t, scene: evaluate(scene, t).scene }));
  }, [scene, duration]);

  // Plot size follows the element. Measured before the first paint, so
  // the plot never shows (or takes input) at a placeholder size.
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Value range: everything visible, padded.
  const values = visible
    .flatMap((c) => [
      ...samples.map((s) => channelValue(s.scene, c.channel)),
      ...keys.map((k) => keyValue(k, c.channel)),
    ])
    .filter((v): v is number => v !== undefined);
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 1;
  if (hi - lo < 1) {
    lo -= 0.5;
    hi += 0.5;
  }
  const padV = (hi - lo) * 0.1;
  lo -= padV;
  hi += padV;
  // While a point or handle is held, the scale stays put (as in Maya):
  // refitting under the pointer fed back into the drag, badly on a
  // phone's short plot.
  const [frozen, setFrozen] = useState<{ lo: number; hi: number } | null>(null);
  if (frozen) ({ lo, hi } = frozen);

  // Until measured nothing is drawn; these just keep the maths finite.
  const sw = size?.w ?? 1;
  const sh = size?.h ?? 1;
  const W = Math.max(1, sw - PAD.l - PAD.r);
  const H = Math.max(1, sh - PAD.t - PAD.b);
  const x = (t: number) => PAD.l + (t / duration) * W;
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * H;
  const tAt = (px: number) =>
    Math.round(Math.min(1, Math.max(0, (px - PAD.l) / W)) * duration * 100) /
    100;
  const vAt = (py: number) => lo + (1 - (py - PAD.t) / H) * (hi - lo);

  const [picked, setPicked] = useState<number | null>(null);
  const pickedKey =
    picked === null ? undefined : keyAt(scene.animation, picked);
  const drag = useRef<{
    t: number;
    channel: Channel;
    x: number;
    y: number;
    axis: "time" | "value" | null;
  } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const local = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };

  /** The slope (value/s) the curve has through a key, as drawn. */
  const slopeAt = (k: Keyframe, ch: Channel): number => {
    const own = k.tangents?.[channelId(ch)]?.out;
    if (own !== undefined) return own;
    const i = keys.indexOf(k);
    const next = keys.slice(i + 1).find((n) => keyValue(n, ch) !== undefined);
    if (k.ease === "spline") {
      const prev = keys
        .slice(0, i)
        .reverse()
        .find((n) => keyValue(n, ch) !== undefined);
      return splineSlope(prev ?? null, k, next ?? null, ch);
    }
    if (k.ease !== "linear") return 0;
    return next ? (keyValue(next, ch)! - keyValue(k, ch)!) / (next.t - k.t) : 0;
  };
  function setTangents(t: number, slope: number | null) {
    const key = keyAt(scene.animation, t);
    if (!key) return;
    for (const c of visible)
      if (keyValue(key, c.channel) !== undefined)
        dispatch({ type: "setKeyTangent", t, channel: c.channel, slope });
  }
  const handleDrag = useRef<{ t: number; channel: Channel } | null>(null);

  const timeTicks = Array.from(
    { length: Math.floor(duration / (duration > 20 ? 5 : 1)) + 1 },
    (_, i) => i * (duration > 20 ? 5 : 1),
  );
  const valueTicks = Array.from(
    { length: 5 },
    (_, i) => lo + ((hi - lo) * i) / 4,
  );

  return (
    <section
      aria-label="Graph editor"
      data-testid="graph-editor"
      className={cx(
        "flex border-t border-ink-800 bg-ink-950 text-2xs text-ink-300",
        // Narrow screens: channels above the plot, so the plot gets the
        // full width.
        "flex-col sm:flex-row",
        fill ? "min-h-0 flex-1" : "h-56 shrink-0 md:h-64",
      )}
    >
      <div className="flex max-h-28 shrink-0 flex-col border-b border-ink-800 sm:max-h-none sm:w-44 sm:border-b-0 sm:border-r md:w-52">
        <select
          aria-label="Object"
          value={ownerId(owner)}
          onChange={(e) =>
            setOwner(
              owners(scene).find((o) => ownerId(o.owner) === e.target.value)!
                .owner,
            )
          }
          className="m-1 h-7 rounded border border-ink-700 bg-ink-850 px-1 text-xs text-ink-100"
          data-testid="graph-owner"
        >
          {owners(scene).map((o) => (
            <option key={ownerId(o.owner)} value={ownerId(o.owner)}>
              {o.label}
            </option>
          ))}
        </select>
        <ul
          className="min-h-0 flex-1 overflow-y-auto px-1 pb-1"
          aria-label="Channels"
        >
          {list.map((c, i) => {
            const id = channelId(c.channel);
            const on = shown.has(id);
            const header = i === 0 || list[i - 1].group !== c.group;
            return (
              <li key={id}>
                {header && (
                  <div className="mt-1 px-1 font-semibold uppercase tracking-wider text-ink-500">
                    {c.group}
                  </div>
                )}
                <label className="flex h-6 cursor-pointer items-center gap-1.5 rounded px-1 hover:bg-ink-800">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const next = new Set(shown);
                      if (on) next.delete(id);
                      else next.add(id);
                      setShown(next);
                    }}
                    data-testid={`graph-channel-${id}`}
                  />
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: COLOURS[i % COLOURS.length] }}
                  />
                  <span className={cx("truncate", on && "text-ink-100")}>
                    {c.label}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex min-h-40 min-w-0 flex-1 flex-col">
        {/* Same height whether or not a key is picked: on a phone the key's
            controls wrap to two lines, and a toolbar that grew on press
            shifted the plot under the finger mid-drag. */}
        <div className="flex h-[4.25rem] shrink-0 flex-wrap content-center items-center gap-x-2 gap-y-1 overflow-hidden border-b border-ink-800 px-2 py-1 sm:h-9 sm:flex-nowrap">
          {pickedKey ? (
            <>
              <span className="text-ink-200">
                Key at {pickedKey.t.toFixed(2)} s → next:
              </span>
              <div className="w-48">
                <Segmented
                  label="Interpolation"
                  hideLabel
                  value={pickedKey.ease ?? "smooth"}
                  testIdPrefix="graph-ease"
                  options={EASES.map((e) => ({
                    value: e,
                    label: e[0].toUpperCase() + e.slice(1),
                  }))}
                  onChange={(ease) =>
                    dispatch({ type: "setKeyEase", t: pickedKey.t, ease })
                  }
                />
              </div>
              <span className="ml-1 text-ink-400">Tangents:</span>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-ink-200 hover:bg-ink-800"
                title="Flat tangents on the shown curves at this key"
                data-testid="graph-tangent-flat"
                onClick={() => setTangents(pickedKey.t, 0)}
              >
                Flat
              </button>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-ink-200 hover:bg-ink-800"
                title="Back to the key's interpolation"
                data-testid="graph-tangent-reset"
                onClick={() => setTangents(pickedKey.t, null)}
              >
                Reset
              </button>
            </>
          ) : (
            <span className="text-ink-400">
              {keys.length === 0
                ? "No keyframes yet: set one on the timeline (K)."
                : "Drag a point up/down to change its value, sideways to retime. Click a point for its interpolation and tangent handles."}
            </span>
          )}
        </div>
        <div ref={box} className="relative min-h-0 flex-1">
          {size && (
            <svg
              ref={svg}
              width={sw}
              height={sh}
              className="absolute inset-0 touch-none select-none"
              data-testid="graph-plot"
              onPointerDown={(e) => {
                if (e.target !== e.currentTarget) return;
                setPicked(null);
                onSeek(tAt(local(e).px));
              }}
            >
              {/* grid */}
              {timeTicks.map((t) => (
                <g key={`t${t}`}>
                  <line
                    x1={x(t)}
                    x2={x(t)}
                    y1={PAD.t}
                    y2={PAD.t + H}
                    stroke="#262a33"
                  />
                  <text x={x(t)} y={sh - 6} textAnchor="middle" fill="#6b7280">
                    {t}s
                  </text>
                </g>
              ))}
              {valueTicks.map((v) => (
                <g key={`v${v}`}>
                  <line
                    x1={PAD.l}
                    x2={PAD.l + W}
                    y1={y(v)}
                    y2={y(v)}
                    stroke="#1f232b"
                  />
                  <text
                    x={PAD.l - 4}
                    y={y(v) + 3}
                    textAnchor="end"
                    fill="#6b7280"
                  >
                    {Math.abs(hi - lo) < 10 ? v.toFixed(2) : Math.round(v)}
                  </text>
                </g>
              ))}
              {/* curves */}
              {visible.map((c) => {
                const pts = samples
                  .map((s) => [s.t, channelValue(s.scene, c.channel)] as const)
                  .filter(
                    (p): p is readonly [number, number] => p[1] !== undefined,
                  )
                  .map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`);
                return (
                  <polyline
                    key={channelId(c.channel)}
                    points={pts.join(" ")}
                    fill="none"
                    stroke={colour(c.channel)}
                    strokeWidth={1.5}
                    pointerEvents="none"
                  />
                );
              })}
              {/* playhead */}
              <line
                x1={x(time)}
                x2={x(time)}
                y1={PAD.t}
                y2={PAD.t + H}
                stroke="#f59e0b"
                strokeWidth={1}
                pointerEvents="none"
              />
              {/* key points */}
              {visible.flatMap((c) =>
                keys.map((k) => {
                  const v = keyValue(k, c.channel);
                  if (v === undefined) return null;
                  const active =
                    picked !== null && Math.abs(k.t - picked) < 0.005;
                  const { unit } = channelRange(c.channel);
                  return (
                    <circle
                      key={`${channelId(c.channel)}@${k.t}`}
                      cx={x(k.t)}
                      cy={y(v)}
                      r={active ? 6 : 4.5}
                      fill={active ? "#ffffff" : colour(c.channel)}
                      stroke="#0b0c10"
                      strokeWidth={1.5}
                      className="cursor-grab"
                      data-testid={`graph-key-${channelId(c.channel)}@${k.t.toFixed(2)}`}
                      aria-label={`${c.label} ${v}${unit} at ${k.t.toFixed(2)} s`}
                      onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setPicked(k.t);
                        setFrozen({ lo, hi });
                        drag.current = {
                          t: k.t,
                          channel: c.channel,
                          x: e.clientX,
                          y: e.clientY,
                          axis: null,
                        };
                      }}
                      onPointerMove={(e) => {
                        const d = drag.current;
                        if (!d) return;
                        const dx = e.clientX - d.x;
                        const dy = e.clientY - d.y;
                        if (!d.axis) {
                          if (Math.hypot(dx, dy) < 4) return;
                          d.axis =
                            Math.abs(dx) > Math.abs(dy) ? "time" : "value";
                        }
                        const { px, py } = local(e);
                        if (d.axis === "value") {
                          dispatch(
                            {
                              type: "setKeyValue",
                              t: d.t,
                              channel: d.channel,
                              value: fitValue(d.channel, vAt(py)),
                            },
                            { gesture: true },
                          );
                        } else {
                          const to = tAt(px);
                          if (to === d.t || keyAt(scene.animation, to)) return;
                          dispatch(
                            { type: "moveKey", from: d.t, to },
                            { gesture: true },
                          );
                          d.t = to;
                          setPicked(to);
                        }
                      }}
                      onPointerUp={() => {
                        const d = drag.current;
                        drag.current = null;
                        setFrozen(null);
                        if (!d) return;
                        if (d.axis) seal();
                        onSeek(d.t);
                      }}
                    />
                  );
                }),
              )}
              {/* tangent handles of the picked key */}
              {pickedKey &&
                visible.map((c) => {
                  const v = keyValue(pickedKey, c.channel);
                  if (v === undefined) return null;
                  const id = channelId(c.channel);
                  // Direction of the slope on screen, 40 px each way.
                  const m = slopeAt(pickedKey, c.channel);
                  const dx = W / duration;
                  const dy = (-m * H) / (hi - lo);
                  const len = Math.hypot(dx, dy) || 1;
                  const hx = (dx / len) * 40;
                  const hy = (dy / len) * 40;
                  const cx0 = x(pickedKey.t);
                  const cy0 = y(v);
                  const handle = (
                    side: "in" | "out",
                    sx: number,
                    sy: number,
                  ) => (
                    <rect
                      key={side}
                      x={sx - 4}
                      y={sy - 4}
                      width={8}
                      height={8}
                      fill="#0b0c10"
                      stroke={colour(c.channel)}
                      strokeWidth={1.5}
                      className="cursor-grab"
                      data-testid={`graph-tangent-${id}@${pickedKey.t.toFixed(2)}-${side}`}
                      aria-label={`${c.label} tangent at ${pickedKey.t.toFixed(2)} s`}
                      onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setFrozen({ lo, hi });
                        handleDrag.current = {
                          t: pickedKey.t,
                          channel: c.channel,
                        };
                      }}
                      onPointerMove={(e) => {
                        const d = handleDrag.current;
                        if (!d) return;
                        const { px, py } = local(e);
                        const dt = (px - x(d.t)) / (W / duration);
                        if (Math.abs(dt) < 1e-3) return;
                        const slope = (vAt(py) - v) / dt;
                        dispatch(
                          {
                            type: "setKeyTangent",
                            t: d.t,
                            channel: d.channel,
                            slope: Math.round(slope * 1000) / 1000,
                          },
                          { gesture: true },
                        );
                      }}
                      onPointerUp={() => {
                        if (handleDrag.current) seal();
                        handleDrag.current = null;
                        setFrozen(null);
                      }}
                    />
                  );
                  return (
                    <g key={`tangent-${id}`}>
                      <line
                        x1={cx0 - hx}
                        y1={cy0 - hy}
                        x2={cx0 + hx}
                        y2={cy0 + hy}
                        stroke={colour(c.channel)}
                        strokeWidth={1}
                        strokeDasharray="3 2"
                        pointerEvents="none"
                      />
                      {handle("in", cx0 - hx, cy0 - hy)}
                      {handle("out", cx0 + hx, cy0 + hy)}
                    </g>
                  );
                })}
            </svg>
          )}
        </div>
      </div>
    </section>
  );
}
