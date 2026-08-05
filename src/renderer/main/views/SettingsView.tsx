import type { JSX } from "react";

/**
 * Settings view. Engine selection, hotkey capture, microphone device,
 * clipboard-restore and dictionary all land in the Settings slice; this
 * stub establishes the route.
 */
export function SettingsView(): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8">
      <h1 className="font-serif text-xl tracking-tight text-text">Settings</h1>
      <p className="max-w-md text-center text-sm text-text-muted">
        Engines, hotkeys, microphone and post-processing. Coming next.
      </p>
    </div>
  );
}
