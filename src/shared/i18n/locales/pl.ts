import type { MessageKey } from "../keys";

export const pl: Partial<Record<MessageKey, unknown>> = {
  "app.name": "Struq Voice",
  "nav.dictate": "Dyktowanie",
  "nav.history": "Historia",
  "nav.dictionary": "Słownik",
  "nav.models": "Modele",
  "nav.settings": "Ustawienia",
  "tray.startCapture": "Rozpocznij nagrywanie",
  "tray.stopCapture": "Zatrzymaj nagrywanie",
  "tray.recentTranscripts": "Ostatnie transkrypcje",
  "tray.noTranscripts": "Brak transkrypcji",
  "tray.engine": "Usługa głosowa",
  "tray.openApp": "Otwórz Struq Voice",
  "tray.settings": "Ustawienia",
  "tray.pauseHotkeys": "Wstrzymaj skróty",
  "tray.quit": "Zakończ",
  "overlay.starting": "Uruchamianie...",
  "overlay.listening": "Słuchanie...",
  "overlay.working": "Przetwarzanie transkrypcji...",
  "overlay.errorCopied": "Skopiowano. Naciśnij Ctrl + V, aby wkleić.",
  "history.day.today": "Dzisiaj",
  "history.day.yesterday": "Wczoraj",
  "history.row.words": {
    one: "{count} słowo",
    few: "{count} słowa",
    many: "{count} słów",
    other: "{count} słowa"
  }
};
