import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { MainWindowApi } from "../../../shared/api";
import type { RecorderDevice } from "../../../shared/ipc";
import { Button, Select } from "../components/ui";
import { micLevelToBar, smoothMicLevel } from "../lib/mic-level";
import { ReadyRow } from "./StepShell";

/**
 * Step one. The microphone is already picked, so this confirms rather than
 * asks. The live meter is the proof: a device name alone does not show
 * the permission took.
 */
export interface MicrophoneStepProps {
  readonly onReady: (ready: boolean) => void;
}

export function MicrophoneStep({ onReady }: MicrophoneStepProps): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const [devices, setDevices] = useState<readonly RecorderDevice[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [choosing, setChoosing] = useState(false);

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
    // First run asks the user to confirm their microphone works, so the
    // meter must be live before any capture has happened.
    const releaseLevels = api.requestCaptureLevels();
    const unsubscribe = api.onCaptureLevelsChanged(({ level: next }) => {
      setLevel((current) => smoothMicLevel(current, micLevelToBar(next)));
    });
    return () => {
      unsubscribe();
      releaseLevels();
    };
  }, [api]);

  const current = devices.find((device) => device.deviceId === currentId) ?? devices[0];
  const hasDevice = devices.length > 0;
  const meterWidth = Math.min(100, Math.round(level * 100));

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
            variant="secondary"
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
      <div className="flex flex-col gap-2">
        <div
          className="h-1 w-full overflow-hidden rounded-pill bg-bg-sunken"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={meterWidth}
          aria-label="Microphone level"
        >
          <div
            className="h-full rounded-pill bg-accent transition-[width] duration-75"
            style={{ width: `${String(meterWidth)}%` }}
          />
        </div>
        <p className="text-2xs text-text-muted">Say something. The bar moves when Struq Voice can hear you.</p>

        {choosing && (
          <div className="mt-2">
            <Select
              value={currentId ?? ""}
              onChange={(event) => {
                const deviceId = event.target.value;
                setCurrentId(deviceId);
                api.devices.setDevice(deviceId);
              }}
              aria-label="Choose a microphone"
            >
              {devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
    </ReadyRow>
  );
}
