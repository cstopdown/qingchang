import { Headphones, Mic, SlidersHorizontal } from "lucide-react";
import type { useStudio } from "../hooks/useStudio";
import {
  MixerSlider,
  Toggle,
  VocalToneSelector,
  MicPreviewButton,
} from "./StudioControls";

export function MixerPanel({
  studio,
  onPreview,
}: {
  studio: ReturnType<typeof useStudio>;
  onPreview: () => void;
}) {
  const { settings, status } = studio;
  const locked = status === "recording" || status === "finishing";
  const meter = Math.min(100, Math.max(0, studio.level * 100));
  return (
    <aside className="mixer-panel">
      <div className="mixer-heading">
        <h3>
          <SlidersHorizontal size={18} /> 调好你的声音
        </h3>
        <span>LIVE MIXER</span>
      </div>
      <div className="mic-meter">
        <div className="meter-label">
          <span>
            <Mic size={14} /> 麦克风电平
          </span>
          <span>
            {status === "recording" || studio.previewStatus === "on"
              ? "LIVE"
              : "待启用"}
          </span>
        </div>
        <div
          className="meter-bars"
          aria-label={`麦克风电平 ${Math.round(meter)}%`}
        >
          {Array.from({ length: 24 }, (_, index) => (
            <i
              key={index}
              className={
                meter > (index / 24) * 100 ? (index > 20 ? "peak" : "lit") : ""
              }
            />
          ))}
        </div>
        <p>
          {studio.previewStatus === "on"
            ? settings.monitoring
              ? "正在返听 · 请佩戴耳机"
              : "正在测试 · 返听已关闭"
            : "测试或录音时启用麦克风"}
        </p>
        <MicPreviewButton
          status={studio.previewStatus}
          disabled={locked}
          onClick={onPreview}
        />
      </div>
      <div className="pitch-monitor">
        <span>
          实时音高 <small>仅作音高参考</small>
        </span>
        <div>
          <strong>{studio.pitch?.note ?? "—"}</strong>
          <span>
            {studio.pitch
              ? `${Math.round(studio.pitch.frequency)} Hz`
              : "等待你的声音"}
          </span>
        </div>
        {studio.pitch && (
          <small>
            {studio.pitch.cents > 0 ? "+" : ""}
            {Math.round(studio.pitch.cents)} cents
          </small>
        )}
      </div>
      <VocalToneSelector
        value={settings.vocalTone}
        onChange={(vocalTone) => studio.updateSettings({ vocalTone })}
      />
      <div className="mixer-sliders">
        <MixerSlider
          label="伴奏音量"
          icon="music"
          value={settings.musicVolume}
          onChange={(value) => studio.updateSettings({ musicVolume: value })}
        />
        <MixerSlider
          label="人声音量"
          icon="mic"
          value={settings.vocalVolume}
          onChange={(value) => studio.updateSettings({ vocalVolume: value })}
        />
        <MixerSlider
          label="空间混响"
          icon="room"
          value={settings.reverb}
          onChange={(value) => studio.updateSettings({ reverb: value })}
        />
      </div>
      <div className="monitor-setting">
        <div>
          <strong>耳机返听</strong>
          <p>测试或录音时听到自己</p>
        </div>
        <Toggle
          label="耳机返听"
          checked={settings.monitoring}
          onChange={(checked) => studio.updateSettings({ monitoring: checked })}
        />
      </div>
      <p className="headphone-note">
        <Headphones size={16} /> 先佩戴耳机，再开启返听试听。
        <br />
        返听延迟因设备而异。
      </p>
    </aside>
  );
}
