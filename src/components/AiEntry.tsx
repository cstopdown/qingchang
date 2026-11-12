import { ArrowLeft, Sparkles } from "lucide-react";
import "./AiEntry.css";

export function AiEntry({ onBack }: { onBack: () => void }) {
  return <section className="ai-entry" aria-labelledby="ai-entry-title">
    <div className="ai-entry-icon"><Sparkles size={28} /></div>
    <span className="ai-entry-badge">功能筹备中</span>
    <h1 id="ai-entry-title">AI</h1>
    <p>AI 入口已预留，具体功能将在后续迭代中加入。</p>
    <button onClick={onBack}><ArrowLeft size={16} /> 返回音乐库</button>
  </section>;
}
