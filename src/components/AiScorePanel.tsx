import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  CircleHelp,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import type { AiScoreReport } from "../ai/types";
import { formatTime } from "./formatTime";

export interface AiScoringState {
  status: "analyzing" | "error";
  startedAt: number;
  message?: string;
}

export function AiScorePanel({
  report,
  state,
  mixed,
  busy,
  onScore,
  onSettings,
}: {
  report?: AiScoreReport;
  state?: AiScoringState;
  mixed: boolean;
  busy: boolean;
  onScore: () => void;
  onSettings: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (state?.status !== "analyzing") return;
    const tick = () =>
      setElapsed(Math.floor((Date.now() - state.startedAt) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [state]);
  return (
    <section className="ai-score-panel" aria-label="AI 练唱反馈">
      <div className="ai-score-heading">
        <span>
          <Sparkles size={14} /> AI 听唱反馈
        </span>
        <small>MINICPM</small>
      </div>
      {state?.status === "analyzing" ? (
        <div className="ai-analyzing" role="status">
          <LoaderCircle size={21} className="spin" />
          <div>
            <strong>正在认真听这一遍…</strong>
            <p>已等待 {elapsed} 秒 · 长录音可能需要 1–3 分钟</p>
            <small>可切换应用内页面；请保持应用开启。</small>
          </div>
        </div>
      ) : (
        <>
          {report && (
            <>
              <div
                className={`ai-score-overview ${report.scorable ? "" : "unscorable"}`}
              >
                <div>
                  <strong>
                    {report.scorable ? Math.round(report.overall!) : "暂不评分"}
                  </strong>
                  {report.scorable && <small>/ 100</small>}
                </div>
                <span>
                  {report.inputKind === "dry-vocal"
                    ? "原始人声评估"
                    : "混音作品评估"}
                </span>
              </div>
              <p className="ai-summary">{report.summary}</p>
              <button
                className="ai-expand"
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
              >
                {expanded ? "收起详细反馈" : "查看练习建议与评估说明"}
                {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
              {expanded && (
                <div className="ai-report-details">
                  <div className="ai-dimensions">
                    {(
                      [
                        { key: "clarity", label: "清晰度" },
                        { key: "steadiness", label: "稳定度" },
                        { key: "expression", label: "表现力" },
                        { key: "recordingQuality", label: "录音质量" },
                      ] as const
                    ).map((item) => (
                      <div key={item.key}>
                        <span>
                          {item.label}
                          <strong>
                            {report.dimensions[item.key] === null
                              ? "—"
                              : Math.round(report.dimensions[item.key]!)}
                          </strong>
                        </span>
                        <i>
                          <b
                            style={{
                              width: `${report.dimensions[item.key] ?? 0}%`,
                            }}
                          />
                        </i>
                      </div>
                    ))}
                  </div>
                  {report.strengths.length > 0 && (
                    <div className="ai-report-section">
                      <h4>这一遍的亮点</h4>
                      <ul>
                        {report.strengths.map((text, index) => (
                          <li key={index}>{text}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {report.improvements.length > 0 && (
                    <div className="ai-report-section">
                      <h4>下一遍，可以这样练</h4>
                      <ul>
                        {report.improvements.map((text, index) => (
                          <li key={index}>{text}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="ai-report-section ai-limitations">
                    <h4>这份反馈的范围</h4>
                    <p>
                      评估 {formatTime(report.clipStartSeconds)}–
                      {formatTime(
                        report.clipStartSeconds + report.analyzedSeconds,
                      )}
                      ，共 {report.analyzedSeconds.toFixed(1)} 秒；作品{" "}
                      {formatTime(report.totalSeconds)}。
                    </p>
                    <ul>
                      {report.limitations.map((text, index) => (
                        <li key={index}>{text}</li>
                      ))}
                    </ul>
                    <p>
                      模型主观听感反馈；没有标准旋律对照，不代表音准精确测量或专业考试成绩。主观分数仅供练习参考，噪声可能导致误判。
                    </p>
                    <p className="ai-model-detail">
                      {report.model}
                      <br />
                      版本 {report.modelRevision}
                      <br />
                      {new Date(report.createdAt).toLocaleString("zh-CN")}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
          {state?.status === "error" && (
            <div className="ai-score-error" role="alert">
              <CircleHelp size={14} />
              <span>
                {state.message}
                <button onClick={onSettings}>检查 AI 服务设置</button>
              </span>
            </div>
          )}
          {!report && state?.status !== "error" && (
            <p className="ai-intro">
              让私有 AI 服务听听你的声音，给下一遍一点练习灵感。
            </p>
          )}
          <button className="ai-score-button" onClick={onScore} disabled={busy}>
            <Sparkles size={14} />
            {state?.status === "error"
              ? "重试 AI 评估"
              : report
                ? "重新评估"
                : "AI 打分与练习建议"}
          </button>
          {mixed && (
            <p className="ai-mixed-note">
              这份作品仅有混音，将连同伴奏评估；伴奏可能影响判断。
            </p>
          )}
        </>
      )}
    </section>
  );
}
