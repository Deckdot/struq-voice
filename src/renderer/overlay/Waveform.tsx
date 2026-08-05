import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";

export interface WaveformProps {
  /** 32 band levels in 0..1, fed at 60Hz in production, simulated until then. */
  readonly bands: number[];
}

const BAR_COUNT = 32;
const BAR_WIDTH = 3;
const BAR_GAP = 5;

/**
 * The listening waveform: 32 bars on a canvas, transform-only redraw at 60fps.
 * Levels arrive at 60Hz and are interpolated between frames so the bars read
 * as smooth rather than stepped. In Phase 1 the caller feeds simulated bands;
 * Phase 2 feeds real analyser data over the same prop.
 */
export function Waveform({ bands }: WaveformProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const targetRef = useRef<number[]>(Array.from({ length: BAR_COUNT }, () => 0));
  const currentRef = useRef<number[]>(Array.from({ length: BAR_COUNT }, () => 0));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    targetRef.current = Array.from({ length: BAR_COUNT }, (_, i) => bands[i] ?? 0);
  }, [bands]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const parent = canvas.parentElement;
    if (parent === null) return;
    const dpr = window.devicePixelRatio || 1;
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${String(width)}px`;
    canvas.style.height = `${String(height)}px`;
    setSize({ width, height });

    const context = canvas.getContext("2d");
    if (context === null) return;
    context.scale(dpr, dpr);

    const draw = (): void => {
      const current = currentRef.current;
      const target = targetRef.current;
      for (let i = 0; i < BAR_COUNT; i++) {
        const next = current[i] ?? 0;
        const goal = target[i] ?? 0;
        current[i] = next + (goal - next) * 0.35;
      }
      context.clearRect(0, 0, width, height);
      context.fillStyle = "var(--color-state-listening)";
      const usableHeight = height - 4;
      for (let i = 0; i < BAR_COUNT; i++) {
        const level = Math.min(1, Math.max(0.06, current[i] ?? 0));
        const barHeight = Math.max(3, level * usableHeight);
        const x = (width - BAR_COUNT * BAR_GAP + BAR_GAP - BAR_WIDTH) / 2 + i * BAR_GAP;
        const y = (height - barHeight) / 2;
        const radius = BAR_WIDTH / 2;
        context.beginPath();
        context.roundRect(x, y, BAR_WIDTH, barHeight, radius);
        context.fill();
      }
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [size.width, size.height]);

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />;
}
