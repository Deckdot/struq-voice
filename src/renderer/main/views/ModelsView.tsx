import type { JSX } from "react";

/**
 * Models view. Cards per catalog model, download progress, install state and
 * per-model delete land in the Models slice; this stub establishes the route.
 */
export function ModelsView(): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8">
      <h1 className="font-serif text-xl tracking-tight text-text">Models</h1>
      <p className="max-w-md text-center text-sm text-text-muted">
        Local engines and their downloads. Coming next.
      </p>
    </div>
  );
}
