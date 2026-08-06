import type { MessageKey } from "../keys";

export const es: Partial<Record<MessageKey, unknown>> = {
  "app.name": "Struq Voice",
  "nav.dictate": "Dictar",
  "nav.history": "Historial",
  "nav.dictionary": "Diccionario",
  "nav.models": "Modelos",
  "nav.settings": "Ajustes",
  "tray.startCapture": "Iniciar captura",
  "tray.stopCapture": "Detener captura",
  "tray.recentTranscripts": "Transcripciones recientes",
  "tray.noTranscripts": "Aún no hay transcripciones",
  "tray.engine": "Servicio de voz",
  "tray.openApp": "Abrir Struq Voice",
  "tray.settings": "Ajustes",
  "tray.pauseHotkeys": "Pausar atajos de teclado",
  "tray.quit": "Salir",
  "tray.tooltip": "Struq Voice: {state} ({engine})",
  "overlay.starting": "Iniciando...",
  "overlay.listening": "Escuchando...",
  "overlay.working": "Procesando transcripción...",
  "overlay.errorCopied": "Copiado. Presiona Ctrl + V para pegar.",
  "history.day.today": "Hoy",
  "history.day.yesterday": "Ayer"
};
