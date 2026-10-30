import { useEffect, useState } from "react";
import {
  Check,
  CircleHelp,
  LoaderCircle,
  Server,
  ShieldCheck,
} from "lucide-react";
import {
  checkAiService,
  parseAiSettings,
} from "../ai/client";
import type { AiServiceSettings as ServiceSettings } from "../ai/types";


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
  useEffect(() => setDraft(settings), [settings]);
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
          ? "VocalVerse2 MuQ KTV v2 已就绪，可以到「我的作品」开始评估。"
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
  return (
    <section className="settings-card ai-service-card">
      <h2>
        <Server size={20} /> 私有 AI 听唱反馈{" "}
        <span className="ai-model-chip">VocalVerse2 MuQ KTV v2</span>
      </h2>
      <p className="ai-service-intro">
        模型对保存的人声干声给出原生参考分。模型运行在你指定的私有服务，音频只发送到该地址。
      </p>
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
      <p className="ai-service-boundary">
        <ShieldCheck size={15} />{" "}
        配置与密钥只保存在本机。录后评分和实时参考旋律对比是独立结果。
      </p>
    </section>
  );
}
