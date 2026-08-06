import type { JSX } from "react";
import { Icon } from "@iconify/react";
import type { ModelInfo } from "../../../shared/models";
import { cn } from "../lib/cn";

export interface ProviderMarkProps {
  readonly engine: ModelInfo["engine"];
  readonly className?: string;
}

export function ProviderMark({ engine, className }: ProviderMarkProps): JSX.Element {
  const nvidia = engine === "parakeet";
  return (
    <Icon
      icon={nvidia ? "simple-icons:nvidia" : "simple-icons:openai"}
      aria-label={nvidia ? "NVIDIA" : "OpenAI"}
      role="img"
      className={cn(
        "h-5 w-5 shrink-0",
        nvidia ? "text-[#76b900]" : "text-[#10a37f]",
        className
      )}
    />
  );
}
