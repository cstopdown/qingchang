import { useEffect, useState } from "react";
import {
  Check,
  CircleHelp,
  Download,
  LoaderCircle,
  Server,
  ShieldCheck,
} from "lucide-react";
import {
  checkAiService,
  parseAiSettings,
} from "../ai/client";
import type { AiServiceSettings as ServiceSettings } from "../ai/types";
import {
  canStartLocalAi,
  getLocalAiProgress,
  startLocalAi,
  type LocalAiProgress,
} from "../platform/bridge";

export function AiServiceSettings({
  settings,
  onSave,
}: {
  settings: ServiceSettings;
  onSave: (settings: ServiceSettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [connection, setConnection] = useState<
    "idle" | "checking" | "ready" | "loading" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<LocalAiProgress>({
    state: "idle",
    message: "",
  });
  const localAvailable = canStartLocalAi();
  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    if (!localAvailable) return;
    getLocalAiProgress()
      .then(setProgress)
      .catch((error) =>
        setProgress({ state: "error", message: (error as Error).message }),
      );
  }, [localAvailable]);
  useEffect(() => {
    if (progress.state !== "installing" && progress.state !== "starting")
      return;
    const timer = window.setInterval(() => {
      getLocalAiProgress()
        .then(setProgress)
        .catch((error) =>
          setProgress({ state: "error", message: (error as Error).message }),
        );
    }, 2000);
    return () => clearInterval(timer);
  }, [progress.state]);
  const detect = async () => {
    setConnection("checking");
    setMessage("");
    try {
      const saved = parseAiSettings(draft);
      onSave(saved);
      const health = await checkAiService(saved);
      setConnection(health.status);
      setMessage(
        health.status === "ready"
          ? "MiniCPM-o 4.5 已就绪，可以到「我的作品」开始评估。"
          : (health.message ??
              (health.status === "loading"
                ? "模型正在加载，请稍后重新检测。"
                : "模型尚未就绪，请检查私有服务。")),
      );
    } catch (error) {
      setConnection("error");
      setMessage((error as Error).message);
    }
  };
  const start = async () => {
    setProgress({ state: "starting", message: "正在准备本机 AI 服务…" });
    try {
      onSave({ endpoint: "http://127.0.0.1:8787", token: "" });
      await startLocalAi();
      setProgress(await getLocalAiProgress());
    } catch (error) {
      setProgress({ state: "error", message: (error as Error).message });
    }
  };
  const installing =
    progress.state === "installing" || progress.state === "starting";
  return (
    <section className="settings-card ai-service-card">
      <h2>
        <Server size={20} /> 私有 AI 听唱反馈{" "}
        <span className="ai-model-chip">MiniCPM-o 4.5</span>
      </h2>
      <p className="ai-service-intro">
        让模型真实聆听录音，给出主观听感与练习建议。模型运行在你指定的私有服务，音频只发送到该地址。
      </p>
      {localAvailable && (
        <div className="ai-local-start">
          <div>
            <strong>在这台 Mac 上准备 AI</strong>
            <p>
              首次需下载约 6.2 GB 模型。之后可在本机评估，也可供自己的手机连接。
            </p>
          </div>
          <button
            className="button ghost"
            onClick={start}
            disabled={installing}
          >
            {installing ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Download size={15} />
            )}
            {installing
              ? "正在准备…"
              : progress.state === "ready"
                ? "启动本机服务"
                : "安装并启动"}
          </button>
        </div>
      )}
      {localAvailable && progress.state !== "idle" && (
        <div
          className={`ai-service-status ${progress.state === "error" ? "error" : ""}`}
          role="status"
        >
          {installing ? (
            <LoaderCircle size={16} className="spin" />
          ) : progress.state === "error" ? (
            <CircleHelp size={16} />
          ) : (
            <Check size={16} />
          )}
          <span>
            {progress.message}
            {progress.state === "ready" &&
              " 可点击下方「保存并检测」确认连接。"}
          </span>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void detect();
        }}
      >
        <label className="field-label">
          服务地址
          <input
            type="url"
            value={draft.endpoint}
            onChange={(event) => {
              setDraft({ ...draft, endpoint: event.target.value });
              setConnection("idle");
            }}
            placeholder="http://127.0.0.1:8787"
            required
            spellCheck={false}
            autoCapitalize="none"
          />
        </label>
        <label className="field-label">
          访问密钥 <span className="optional">本机可留空，局域网必填</span>
          <input
            type="password"
            value={draft.token}
            onChange={(event) => {
              setDraft({ ...draft, token: event.target.value });
              setConnection("idle");
            }}
            placeholder="私有服务设置的访问密钥"
            autoComplete="off"
          />
        </label>
        <p className="ai-address-help">
          填写私有 AI 服务地址及访问密钥；同源网关可留空密钥。127.0.0.1 只代表当前设备。
        </p>
        <button
          className="button ghost ai-check-button"
          type="submit"
          disabled={connection === "checking"}
        >
          {connection === "checking" ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Server size={15} />
          )}
          {connection === "checking" ? "正在连接…" : "保存并检测连接"}
        </button>
      </form>
      {connection !== "idle" && connection !== "checking" && (
        <div
          className={`ai-service-status ${connection === "error" ? "error" : ""}`}
          role={connection === "error" ? "alert" : "status"}
        >
          {connection === "ready" ? (
            <Check size={16} />
          ) : (
            <CircleHelp size={16} />
          )}
          <span>{message}</span>
        </div>
      )}
      {!localAvailable && (
        <details className="ai-setup-help">
          <summary>如何准备私有 AI 服务</summary>
          <p>
            可在 Apple Silicon Mac 上打开本项目，依次运行{" "}
            <code>npm run ai:setup</code> 和 <code>npm run ai:start</code>
            。也可连接已部署的音频评分服务。服务就绪后回到这里检测连接。
          </p>
        </details>
      )}
      <p className="ai-service-boundary">
        <ShieldCheck size={15} />{" "}
        配置与密钥只保存在本机。反馈关注清晰度、稳定度、表现力与录音质量；没有标准旋律对照，不生成精确音准测量。
      </p>
    </section>
  );
}
