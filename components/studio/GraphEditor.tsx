"use client";

/** Graph editor, after Maya's: the animated values (channels) of one
 * figure, light or the camera, drawn as curves over time with a point
 * at each keyframe. Drag a point up/down to change that value in that
 * key, or sideways to retime the key; click a point to choose how it
 * travels to the next key (smooth, linear, step); click the background
 * to move the playhead. Every edit is a normal, undoable action. */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Selection } from "@/lib/engine/StudioEngine";
import {
  channelId,
  channelValue,
  evaluate,
  keyAt,
  keyValue,
} from "@/lib/studio/animation";
import {
  channelRange,
  channelsOf,
  fitValue,
  ownerId,
  owners,
  type ChannelOwner,
} from "@/lib/studio/channels";
import { EASES, type Channel, type Figure } from "@/lib/studio/schema";
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
}: {
  studio: Studio;
  figure: Figure;
  selection: Selection;
  time: number;
  onSeek: (t: number) => void;
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

  // Plot size follows the element.
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 200 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.clientWidth, h: el.clientHeight }),
    );
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

  const W = size.w - PAD.l - PAD.r;
  const H = size.h - PAD.t - PAD.b;
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
      className="flex h-56 shrink-0 border-t border-ink-800 bg-ink-950 text-2xs text-ink-300 md:h-64"
    >
      <div className="flex w-44 shrink-0 flex-col border-r border-ink-800 md:w-52">
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

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-ink-800 px-2">
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
            </>
          ) : (
            <span className="text-ink-400">
              {keys.length === 0
                ? "No keyframes yet: set one on the timeline (K)."
                : "Drag a point up/down to change its value, sideways to retime. Click a point for its interpolation."}
            </span>
          )}
        </div>
        <div ref={box} className="relative min-h-0 flex-1">
          <svg
            ref={svg}
            width={size.w}
            height={size.h}
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
                <text
                  x={x(t)}
                  y={size.h - 6}
                  textAnchor="middle"
                  fill="#6b7280"
                >
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
                        d.axis = Math.abs(dx) > Math.abs(dy) ? "time" : "value";
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
                      if (!d) return;
                      if (d.axis) seal();
                      onSeek(d.t);
                    }}
                  />
                );
              }),
            )}
          </svg>
        </div>
      </div>
    </section>
  );
}
