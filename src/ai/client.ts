import { aiRequest } from "../platform/bridge";
import type { Recording } from "../core/types";
import type {
  AiScoreReport,
  AiServiceHealth,
  AiServiceSettings,
} from "./types";

export const DEFAULT_AI_SETTINGS: AiServiceSettings = {
  endpoint: import.meta.env.VITE_AI_ENDPOINT
    ? new URL(import.meta.env.VITE_AI_ENDPOINT, window.location.origin).href.replace(/\/+$/, "")
    : "http://127.0.0.1:8787",
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
  if (!loopback && url.origin !== window.location.origin && !token)
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
export async function checkAiService(settings: AiServiceSettings): Promise<AiServiceHealth> {
  const body = object(await request(settings, "/health", {}, 10000));
  if (body.service !== "qingchang-score" || body.apiVersion !== 2 || body.engine !== "vocalverse" || body.backend !== "pytorch-cpu" || body.audioInput !== true || !["loading", "ready", "error"].includes(text(body.status)) || JSON.stringify(body.scoreRange) !== "[0,100]")
    throw new Error("这个地址不是支持音频评分的轻唱 VocalVerse 服务。");
  return { status: body.status as AiServiceHealth["status"], model: text(body.model), modelId: text(body.modelId), modelRevision: text(body.modelRevision), backend: "pytorch-cpu", audioInput: true, ...(body.message === undefined ? {} : { message: text(body.message) }) };
}
export async function scoreRecording(recording: Recording, _lyrics: string, settings: AiServiceSettings): Promise<AiScoreReport> {
  if (!recording.vocalAudio) throw new Error("作品没有保存干声，无法进行 VocalVerse 评分。");
  const form = new FormData();
  form.append("audio", recording.vocalAudio, `${recording.id}.wav`);
  form.append("recordingId", recording.id); form.append("title", recording.title);
  const body = object(await request(settings, "/v2/score", { method: "POST", body: form }, 300000));
  const analysis = object(body.analysis);
  const resultScore = score(body.score);
  if (body.schemaVersion !== 2 || body.engine !== "vocalverse" || body.recordingId !== recording.id || typeof body.scorable !== "boolean" || body.scorable !== (resultScore !== null) || JSON.stringify(body.scoreRange) !== "[0,100]" || analysis.inputKind !== "dry-vocal" || typeof analysis.modelCalled !== "boolean") throw new Error("评分服务返回的报告与当前作品不匹配。");
  return { schemaVersion: 2, id: text(body.id), recordingId: text(body.recordingId), createdAt: number(body.createdAt), engine: "vocalverse", model: text(body.model), modelId: text(body.modelId), modelRevision: text(body.modelRevision), scorable: body.scorable, score: resultScore, scoreRange: [0, 100], summary: text(body.summary), limitations: texts(body.limitations), analysis: { sourceDurationSeconds: number(analysis.sourceDurationSeconds), startSeconds: number(analysis.startSeconds), durationSeconds: number(analysis.durationSeconds), inputKind: "dry-vocal", modelCalled: analysis.modelCalled } };
}
