import type { JSX } from "react";

export function App(): JSX.Element {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-3">
      <h1 className="font-serif text-display tracking-tight text-text">Struq Voice</h1>
      <p className="text-sm text-text-muted">Hold a key anywhere in Windows and speak.</p>
    </main>
  );
}
