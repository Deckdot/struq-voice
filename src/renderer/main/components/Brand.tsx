import type { JSX } from "react";
import symbolUrl from "../../assets/struq-symbol.svg";
import { cn } from "../lib/cn";

export function BrandMark({ className }: { readonly className?: string }): JSX.Element {
  return <img src={symbolUrl} alt="" draggable={false} className={cn("block shrink-0", className)} />;
}

export function BrandLockup({ className }: { readonly className?: string }): JSX.Element {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <BrandMark className="h-6 w-6" />
      <span className="font-serif text-base tracking-tight text-text">Struq Voice</span>
    </div>
  );
}
