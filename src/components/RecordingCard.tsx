import { useEffect, useState } from "react";
import { ArrowDownToLine, AudioLines, Trash2 } from "lucide-react";
import type { Recording } from "../core/types";
import { formatTime } from "./formatTime";
import { AiScorePanel, type AiScoringState } from "./AiScorePanel";

export function RecordingCard({
  recording,
  onExport,
  onDelete,
  onScore,
  onAiSettings,
  scoreState,
  aiBusy,
}: {
  recording: Recording;
  onExport: () => void;
  onDelete: () => void;
  onScore: () => void;
  onAiSettings: () => void;
  scoreState?: AiScoringState;
  aiBusy: boolean;
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const value = URL.createObjectURL(recording.audio);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [recording.audio]);
  return (
    <article className="recording-card">
      <div className="recording-cover">
        <AudioLines size={36} strokeWidth={1.25} />
        <span>MY VOICE / {new Date(recording.createdAt).getFullYear()}</span>
        <div className="recording-ornament" />
      </div>
      <div className="recording-content">
        <span className="eyebrow">
          {new Date(recording.createdAt).toLocaleDateString("zh-CN")} ·{" "}
          {formatTime(recording.duration)}
        </span>
        <h3>{recording.title}</h3>
        <p>{recording.trackTitle}</p>
        <audio
          controls
          src={url}
          preload="metadata"
          aria-label={`回放 ${recording.title}`}
        />
        <div className="recording-actions">
          <button className="text-button" onClick={onExport}>
            <ArrowDownToLine size={16} /> 导出作品
          </button>
          <button
            className="icon-button muted"
            aria-label={`删除作品 ${recording.title}`}
            onClick={onDelete}
            disabled={scoreState?.status === "analyzing"}
          >
            <Trash2 size={17} />
          </button>
        </div>
        <AiScorePanel
          report={recording.aiScore}
          state={scoreState}
          mixed={!recording.vocalAudio}
          busy={aiBusy}
          onScore={onScore}
          onSettings={onAiSettings}
        />
      </div>
    </article>
  );
}
