import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { JSX, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { MainWindowApi } from "../../../shared/api";
import { findRuleByFrom, upsertRule } from "../../../shared/dictionary";
import type { DictionaryRule } from "../../../shared/dictionary";
import type { Settings } from "../../../shared/settings";
import { useTranslation } from "../lib/useTranslation";
import { cn } from "../lib/cn";
import { Button, TextInput } from "./ui";

export interface RuleFromSelectionProps {
  readonly text: string;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly onClose: () => void;
}

/**
 * A floating panel that turns a selected mishearing into a dictionary rule.
 * The "heard as" side is fixed to the selection; only the replacement is
 * typed. Positioned against the selection rect, flipped above when the panel
 * would run off the bottom of the window.
 */
export function RuleFromSelection({
  text,
  anchorX,
  anchorY,
  onClose
}: RuleFromSelectionProps): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [toValue, setToValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [position, setPosition] = useState<{
    readonly x: number;
    readonly y: number;
  } | null>(null);

  const existing = useMemo(
    () => (settings === null ? undefined : findRuleByFrom(settings.post.dictionary, text)),
    [settings, text]
  );

  useEffect(() => {
    let cancelled = false;
    void api.settings.get().then(({ settings: loaded }) => {
      if (cancelled) return;
      setSettings(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    const { width, height } = panel.getBoundingClientRect();
    const GAP = 8;
    const MARGIN = 12;
    const below = anchorY + GAP;
    const top = below + height > window.innerHeight - MARGIN ? anchorY - GAP - height : below;
    const left = Math.min(Math.max(anchorX, MARGIN), window.innerWidth - width - MARGIN);
    setPosition({ x: left, y: top });
  }, [anchorX, anchorY, existing]);

  const handleClose = (): void => {
    if (saved) return;
    onClose();
  };

  useEffect(() => {
    if (saved) return;
    const onPointerDown = (event: PointerEvent): void => {
      const panel = panelRef.current;
      if (panel === null) return;
      if (event.target instanceof Node && panel.contains(event.target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [saved, onClose]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => {
      onClose();
    }, 800);
    return () => {
      window.clearTimeout(timer);
    };
  }, [saved, onClose]);

  const save = async (): Promise<void> => {
    const { settings: loaded } = await api.settings.get();
    const existing = findRuleByFrom(loaded.post.dictionary, text);
    const rule: DictionaryRule =
      existing === undefined
        ? { from: text, to: toValue.trim(), matchCase: false, wholeWord: true, enabled: true }
        : {
            from: text,
            to: toValue.trim(),
            matchCase: existing.matchCase,
            wholeWord: existing.wholeWord,
            enabled: existing.enabled ?? true
          };
    const { rules } = upsertRule(loaded.post.dictionary, rule);
    await api.settings.update({
      post: { ...loaded.post, dictionary: [...rules] as DictionaryRule[] }
    });
    setSaved(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (settings === null || saved) return;
      void save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      handleClose();
    }
  };

  const savingDisabled = settings === null || saved;

  return createPortal(
    <div
      ref={panelRef}
      data-rule-popover=""
      className={cn(
        "fixed z-50 w-72 rounded-xl border border-border bg-surface p-3 text-text shadow-lift",
        position === null && "pointer-events-none opacity-0"
      )}
      style={{ top: position?.y ?? 0, left: position?.x ?? 0 }}
    >
      <div className="mb-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
          {t("history.rule.heardAs")}
        </span>
        <p className="truncate text-sm text-text" title={text}>
          {text}
        </p>
      </div>
      <div className="space-y-2">
        <TextInput
          autoFocus
          value={toValue}
          onChange={(event) => {
            setToValue(event.target.value);
          }}
          placeholder={t("history.rule.shouldBe")}
          onKeyDown={handleKeyDown}
        />
        {existing !== undefined && (
          <p className="text-xs text-text-muted">
            {t("history.rule.exists", { from: existing.from, to: existing.to })}
          </p>
        )}
        <Button
          variant="primary"
          size="sm"
          className="w-full"
          disabled={savingDisabled}
          onClick={() => {
            void save();
          }}
        >
          {saved
            ? t("history.rule.saved")
            : existing !== undefined
              ? t("history.rule.update")
              : t("history.rule.add")}
        </Button>
      </div>
    </div>,
    document.body
  );
}
