import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { MainWindowApi } from "../../../shared/api";
import type { RecorderDevice } from "../../../shared/ipc";
import { Button } from "../components/ui";
import { ReadyRow } from "./StepShell";

/**
 * Step one, which arrives already satisfied: the recorder picked the default
 * device at boot, so this confirms rather than asks. The live meter is the
 * evidence, because a device name alone does not prove the permission took.
 *
 * The only case that blocks is no device at all, and it names the fix.
 */
export interface MicrophoneStepProps {
  readonly onReady: (ready: boolean) => void;
}

export function MicrophoneStep({ onReady }: MicrophoneStepProps): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const [devices, setDevices] = useState<readonly RecorderDevice[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [choosing, setChoosing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.devices.list().then(({ devices: list, currentDeviceId }) => {
      if (cancelled) return;
      setDevices(list);
      setCurrentId(currentDeviceId);
      setLoaded(true);
      onReady(list.length > 0);
    });
    return () => {
      cancelled = true;
    };
  }, [api, onReady]);

  useEffect(() => {
    // Smooth the 60Hz stream and let it decay between events, so silence
    // reads as silence rather than as a frozen bar.
    return api.onCaptureLevelsChanged(({ level: next }) => {
      setLevel((current) => Math.max(current * 0.6, next * 0.4));
    });
  }, [api]);

  const current = devices.find((device) => device.deviceId === currentId) ?? devices[0];
  const hasDevice = devices.length > 0;

  if (loaded && !hasDevice) {
    return (
      <ReadyRow
        label="No microphone found"
        value="Connect a microphone, then allow access in Windows Settings under Privacy and security, Microphone."
        ready={false}
      />
    );
  }

  return (
    <ReadyRow
      label="Microphone"
      value={current?.label ?? "Detecting the default device"}
      ready={hasDevice}
      action={
        devices.length > 1 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setChoosing((open) => !open);
            }}
          >
            {choosing ? "Done" : "Change"}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <span
            className="flex h-1.5 w-full overflow-hidden rounded-full bg-bg-sunken"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level * 100)}
            aria-label="Microphone level"
          >
            <span
              className="h-full rounded-full bg-accent transition-[width] duration-75"
              style={{ width: `${String(Math.round(level * 100))}%` }}
            />
          </span>
          <p className="mt-1.5 text-xs text-text-muted">
            Say something. The bar moves when the app can hear you.
          </p>
        </div>

        {choosing && (
          <select
            aria-label="Microphone device"
            value={currentId ?? ""}
            onChange={(event) => {
              setCurrentId(event.target.value);
              api.devices.setDevice(event.target.value);
            }}
            className="w-full rounded-md border border-border bg-bg-sunken px-3 py-2 text-sm text-text"
          >
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </ReadyRow>
  );
}
