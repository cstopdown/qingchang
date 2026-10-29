import { aiRequest } from "../platform/bridge";
import type { Recording } from "../core/types";
import type {
  AiScoreReport,
  AiServiceHealth,
  AiServiceSettings,
} from "./types";

export const DEFAULT_AI_SETTINGS: AiServiceSettings = {
  endpoint: "http://127.0.0.1:8787",
  token: "",
};
const SETTINGS_KEY = "qingchang-ai-service";

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("AI 服务返回的数据格式不正确。");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("AI 服务返回的数据格式不正确。");
  return value;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("AI 服务返回的数值不正确。");
  return value;
}
function score(value: unknown): number | null {
  if (value === null) return null;
  const parsed = number(value);
  if (parsed < 0 || parsed > 100)
    throw new Error("AI 服务返回的分数超出范围。");
  return parsed;
}
function texts(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("AI 服务返回的建议格式不正确。");
  return value.map(text);
}

export function parseAiSettings(value: unknown): AiServiceSettings {
  const data = object(value);
  const endpoint = text(data.endpoint).trim().replace(/\/+$/, "");
  const token = text(data.token).trim();
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("请填写完整的 AI 服务地址，例如 http://127.0.0.1:8787。");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "AI 服务地址只支持 HTTP(S)，请勿在地址中填写密钥或查询参数。",
    );
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!loopback && !token)
    throw new Error("连接局域网或远程私有服务时，请填写服务访问密钥。");
  return { endpoint, token };
}
export function loadAiSettings(): AiServiceSettings {
  const stored = localStorage.getItem(SETTINGS_KEY);
  return stored === null
    ? { ...DEFAULT_AI_SETTINGS }
    : parseAiSettings(JSON.parse(stored));
}
export function saveAiSettings(settings: AiServiceSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
function headers(settings: AiServiceSettings): HeadersInit {
  return settings.token ? { Authorization: `Bearer ${settings.token}` } : {};
}
async function request(
  settings: AiServiceSettings,
  path: string,
  init: RequestInit,
  timeout: number,
): Promise<unknown> {
  try {
    const response = await aiRequest(`${settings.endpoint}${path}`, {
      ...init,
      headers: headers(settings),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) {
      if (response.status === 429)
        throw new Error("AI 正在分析另一份作品，请稍后再试。");
      if (response.status === 401 || response.status === 403)
        throw new Error("服务访问密钥不正确，请到设置中检查。");
      if (response.status === 502)
        throw new Error("模型这次没有完成有效评估，请稍后重试。");
      const body = object(await response.json());
      throw new Error(
        typeof body.detail === "string"
          ? body.detail
          : `AI 服务暂时不可用（${response.status}），请检测连接后重试。`,
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error("服务没有返回有效 JSON，请检查 AI 服务地址和运行状态。");
    if (error instanceof TypeError)
      throw new Error(
        "连接不到 AI 私有服务。请确认服务已启动、地址正确，并允许本机或局域网访问。",
      );
    if (error instanceof DOMException && error.name === "TimeoutError")
      throw new Error(
        "AI 分析等待超时，请稍后重试。服务端可能仍在完成当前任务。",
      );
    throw error;
  }
}
export async function checkAiService(
  settings: AiServiceSettings,
): Promise<AiServiceHealth> {
  const body = object(await request(settings, "/health", {}, 10000));
  if (
    body.service !== "qingchang-ai" ||
    body.apiVersion !== 1 ||
    body.model !== "MiniCPM-o 4.5" ||
    body.backend !== "mlx" ||
    body.audioInput !== true ||
    !["loading", "ready", "error"].includes(text(body.status))
  )
    throw new Error("这个地址不是支持音频评分的轻唱 MiniCPM 私有服务。");
  return {
    status: body.status as AiServiceHealth["status"],
    model: "MiniCPM-o 4.5",
    modelId: text(body.modelId),
    backend: "mlx",
    audioInput: true,
    ...(body.message === undefined ? {} : { message: text(body.message) }),
  };
}
function parseReport(value: unknown): AiScoreReport {
  const body = object(value);
  const dimensions = object(body.dimensions);
  if (
    typeof body.scorable !== "boolean" ||
    !["dry-vocal", "mixed"].includes(text(body.inputKind))
  )
    throw new Error("AI 服务返回的评估状态不正确。");
  const overall = score(body.overall);
  if (
    (body.scorable && overall === null) ||
    (!body.scorable && overall !== null)
  )
    throw new Error("AI 服务返回的可评分状态与分数不一致。");
  const analyzedSeconds = number(body.analyzedSeconds),
    totalSeconds = number(body.totalSeconds),
    clipStartSeconds = number(body.clipStartSeconds);
  if (
    analyzedSeconds < 0 ||
    totalSeconds < 0 ||
    clipStartSeconds < 0 ||
    clipStartSeconds + analyzedSeconds > totalSeconds + 0.1
  )
    throw new Error("AI 服务返回的音频评估片段范围不正确。");
  return {
    id: text(body.id),
    recordingId: text(body.recordingId),
    model: text(body.model),
    modelRevision: text(body.modelRevision),
    createdAt: number(body.createdAt),
    inputKind: body.inputKind as AiScoreReport["inputKind"],
    scorable: body.scorable,
    overall,
    dimensions: {
      clarity: score(dimensions.clarity),
      steadiness: score(dimensions.steadiness),
      expression: score(dimensions.expression),
      recordingQuality: score(dimensions.recordingQuality),
    },
    summary: text(body.summary),
    strengths: texts(body.strengths),
    improvements: texts(body.improvements),
    limitations: texts(body.limitations),
    analyzedSeconds,
    totalSeconds,
    clipStartSeconds,
  };
}
export async function scoreRecording(
  recording: Recording,
  lyrics: string,
  settings: AiServiceSettings,
): Promise<AiScoreReport> {
  const inputKind = recording.vocalAudio ? "dry-vocal" : "mixed";
  const form = new FormData();
  form.append(
    "audio",
    recording.vocalAudio ?? recording.audio,
    `${recording.id}.wav`,
  );
  form.append("recordingId", recording.id);
  form.append("title", recording.title);
  form.append("lyrics", lyrics);
  form.append("inputKind", inputKind);
  const report = parseReport(
    await request(
      settings,
      "/v1/score",
      { method: "POST", body: form },
      300000,
    ),
  );
  if (report.recordingId !== recording.id || report.inputKind !== inputKind)
    throw new Error("AI 返回的报告与当前作品不匹配，请重试。");
  return report;
}
