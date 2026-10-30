export interface LegacyAiScoreReport {
  id: string;
  recordingId: string;
  model: string;
  modelRevision: string;
  createdAt: number;
  inputKind: "dry-vocal" | "mixed";
  scorable: boolean;
  overall: number | null;
  dimensions: {
    clarity: number | null;
    steadiness: number | null;
    expression: number | null;
    recordingQuality: number | null;
  };
  summary: string;
  strengths: string[];
  improvements: string[];
  limitations: string[];
  analyzedSeconds: number;
  totalSeconds: number;
  clipStartSeconds: number;
}

export interface VocalScoreReport {
  schemaVersion: 2; id: string; recordingId: string; createdAt: number;
  engine: "vocalverse"; model: string; modelId: string; modelRevision: string;
  scorable: boolean; score: number | null; scoreRange: [number, number];
  summary: string; limitations: string[];
  analysis: { sourceDurationSeconds: number; startSeconds: number; durationSeconds: number; inputKind: "dry-vocal"; modelCalled: boolean };
}
export type AiScoreReport = LegacyAiScoreReport | VocalScoreReport;

export interface AiServiceHealth {
  status: "loading" | "ready" | "error"; model: string; modelId: string;
  modelRevision: string; backend: "pytorch-cpu"; audioInput: true; message?: string;
}

export interface AiServiceSettings { endpoint: string; token: string; }
