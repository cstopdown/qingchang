import type { MixerSettings } from "../core/types";
import { VOCAL_TONE_PRESETS } from "../audio/effects";
import {
  Check,
  LoaderCircle,
  Mic,
  Music2,
  Square,
  Volume2,
} from "lucide-react";

export function MixerSlider({
  label,
  icon,
  value,
  onChange,
}: {
  label: string;
  icon: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mixer-slider">
      <span>
        {icon === "music" ? (
          <Music2 size={15} />
        ) : icon === "mic" ? (
          <Mic size={15} />
        ) : (
          <Volume2 size={15} />
        )}
        {label}
        <strong>{Math.round(value * 100)}%</strong>
      </span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
      />
    </label>
  );
}
export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function VocalToneSelector({
  value,
  onChange,
}: {
  value: MixerSettings["vocalTone"];
  onChange: (value: MixerSettings["vocalTone"]) => void;
}) {
  return (
    <div className="vocal-tone-selector">
      <div className="tone-label">
        人声音色 <span>返听与作品同步生效</span>
      </div>
      <div className="tone-options" role="group" aria-label="人声音色">
        {VOCAL_TONE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            title={preset.description}
            aria-pressed={value === preset.id}
            className={value === preset.id ? "active" : ""}
            onClick={() => onChange(preset.id)}
          >
            <span>{preset.label}</span>
            {value === preset.id && <Check size={12} />}
          </button>
        ))}
      </div>
      <p>
        {VOCAL_TONE_PRESETS.find((preset) => preset.id === value)!.description}
      </p>
    </div>
  );
}

export function MicPreviewButton({
  status,
  disabled,
  onClick,
}: {
  status: "off" | "starting" | "on";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`mic-preview-button ${status === "on" ? "is-on" : ""}`}
      disabled={disabled || status === "starting"}
      onClick={onClick}
    >
      {status === "starting" ? (
        <LoaderCircle size={14} className="spin" />
      ) : status === "on" ? (
        <Square size={11} fill="currentColor" />
      ) : (
        <Mic size={14} />
      )}
      <span>
        {status === "starting"
          ? "正在开启麦克风…"
          : status === "on"
            ? "停止测试"
            : "测试麦克风"}
      </span>
      {status === "on" && <i />}
    </button>
  );
}
