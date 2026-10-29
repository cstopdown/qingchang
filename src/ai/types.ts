export interface AiScoreReport {
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

export interface AiServiceHealth {
  status: "loading" | "ready" | "error";
  model: "MiniCPM-o 4.5";
  modelId: string;
  backend: "mlx";
  audioInput: true;
  message?: string;
}

export interface AiServiceSettings {
  endpoint: string;
  token: string;
}
