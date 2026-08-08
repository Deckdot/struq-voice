import { useEffect, useRef } from "react";
import type { JSX } from "react";

/**
 * The listening visualiser: mirrored bars on a canvas, redrawn on rAF.
 *
 * Frequency bands arrive at 60Hz. Input is spatially smoothed across adjacent
 * bands to create a fluid wave, and gain-boosted with soft compression so speech
 * fills the vertical space smoothly ("bigger in feel") without sporadic jitter.
 */
export interface WaveformProps {
  /** Band levels in 0..1, fed at 60Hz from the recorder's analyser. */
  readonly bands: readonly number[];
  /** The token name to paint with, resolved from the theme at runtime. */
  readonly colorToken?: string;
  /** Idle draws a calm baseline instead of reacting to input. */
  readonly idle?: boolean;
  /** Decay the bars to zero over this many ms (the transcribing morph). */
  readonly decayMs?: number | null;
}

const BAR_COUNT = 28;
const MIN_BAR = 3;

const ATTACK = 0.32;
const RELEASE = 0.09;
const PEAK_FALL_PER_FRAME = 0.01;

const resolveColor = (element: HTMLElement, token: string, fallback: string): string => {
  const value = getComputedStyle(element).getPropertyValue(token).trim();
  return value.length > 0 ? value : fallback;
};

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Waveform({
  bands,
  colorToken = "--color-state-listening",
  idle = false,
  decayMs = null
}: WaveformProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const targetRef = useRef<number[]>(Array.from({ length: BAR_COUNT }, () => 0));
  const currentRef = useRef<number[]>(Array.from({ length: BAR_COUNT }, () => 0));
  const peakRef = useRef<number[]>(Array.from({ length: BAR_COUNT }, () => 0));
  const idleRef = useRef<boolean>(idle);
  const decayStartRef = useRef<number | null>(null);
  const decayFromRef = useRef<number[]>(Array.from({ length: BAR_COUNT }, () => 0));

  useEffect(() => {
    // Spatial smoothing: 3-tap Gaussian filter across neighboring bands
    // to eliminate single-frequency jitter and create a smooth wave contour.
    const smoothed = new Array<number>(BAR_COUNT);
    const n = bands.length;
    for (let i = 0; i < BAR_COUNT; i++) {
      const srcIdx = Math.floor((i / BAR_COUNT) * n);
      const prev = bands[Math.max(0, srcIdx - 1)] ?? 0;
      const curr = bands[srcIdx] ?? 0;
      const next = bands[Math.min(n - 1, srcIdx + 1)] ?? 0;
      const avg = prev * 0.25 + curr * 0.5 + next * 0.25;

      // Non-linear gain boost: map quiet/normal speech into a prominent vertical height
      const boosted = Math.pow(Math.min(1, avg * 2.4), 0.72);
      smoothed[i] = boosted;
    }
    targetRef.current = smoothed;
  }, [bands]);

  useEffect(() => {
    idleRef.current = idle;
  }, [idle]);

  useEffect(() => {
    if (decayMs === null) {
      decayStartRef.current = null;
      return;
    }
    decayFromRef.current = [...currentRef.current];
    decayStartRef.current = performance.now();
  }, [decayMs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const parent = canvas.parentElement;
    if (parent === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;

    const reducedMotion = prefersReducedMotion();
    let barColor = resolveColor(canvas, colorToken, "#b4653a");
    // Resolved once with barColor: getComputedStyle inside the per-bar draw
    // loop would force a style resolution on every frame.
    let peakColor = resolveColor(canvas, "--color-border-strong", "#c0c4b8");

    let width = 0;
    let height = 0;
    let frame: number | null = null;
    let startedAt = performance.now();

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1;
      width = parent.clientWidth;
      height = parent.clientHeight;
      if (width === 0 || height === 0) return;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${String(width)}px`;
      canvas.style.height = `${String(height)}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      barColor = resolveColor(canvas, colorToken, barColor);
      peakColor = resolveColor(canvas, "--color-border-strong", peakColor);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);

    const draw = (now: number): void => {
      frame = requestAnimationFrame(draw);
      if (width === 0 || height === 0) return;

      const current = currentRef.current;
      const target = targetRef.current;
      const peaks = peakRef.current;
      const isIdle = idleRef.current;
      const elapsed = (now - startedAt) / 1000;
      const decayStart = decayStartRef.current;
      const decayFrom = decayFromRef.current;

      context.clearRect(0, 0, width, height);

      const centerY = height / 2;
      const usableHalf = Math.max(1, height / 2 - 1);
      const step = width / BAR_COUNT;
      const barWidth = Math.max(2, Math.min(3.5, step - 2.2));
      const originX = (step - barWidth) / 2;

      for (let i = 0; i < BAR_COUNT; i++) {
        let goal: number;
        if (decayStart !== null && decayMs !== null) {
          const t = Math.min(1, (now - decayStart) / decayMs);
          const eased = 1 - Math.pow(1 - t, 3);
          const from = decayFrom[i] ?? 0;
          goal = from * (1 - eased);
        } else if (isIdle) {
          goal = reducedMotion
            ? 0.06
            : 0.08 + Math.sin(elapsed * 1.8 - i * 0.25) * 0.04;
        } else {
          goal = target[i] ?? 0;
        }

        const previous = current[i] ?? 0;
        const rate = goal > previous ? ATTACK : RELEASE;
        const next = reducedMotion ? goal : previous + (goal - previous) * rate;
        current[i] = next;

        const peak = peaks[i] ?? 0;
        peaks[i] = next >= peak ? next : Math.max(next, peak - PEAK_FALL_PER_FRAME);

        const level = Math.min(1, Math.max(0, next));
        // Fill up to usableHalf smoothly, with a solid minimum baseline
        const half = Math.max(MIN_BAR / 2, (0.08 + level * 0.92) * usableHalf);
        const x = originX + i * step;

        context.fillStyle = barColor;
        context.beginPath();
        context.roundRect(x, centerY - half, barWidth, half * 2, barWidth / 2);
        context.fill();

        if (!isIdle && !reducedMotion && decayStart === null && usableHalf >= 12) {
          const peakLevel = Math.min(1, Math.max(0, peaks[i] ?? 0));
          const peakHalf = Math.max(MIN_BAR / 2, (0.08 + peakLevel * 0.92) * usableHalf);
          if (peakHalf > half + 2) {
            context.fillStyle = peakColor;
            context.beginPath();
            context.roundRect(x, centerY - peakHalf, barWidth, 1.5, 0.75);
            context.fill();
            context.beginPath();
            context.roundRect(x, centerY + peakHalf - 1.5, barWidth, 1.5, 0.75);
            context.fill();
          }
        }
      }
    };

    startedAt = performance.now();
    frame = requestAnimationFrame(draw);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [colorToken]);

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />;
}
