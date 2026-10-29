import { useState, type FormEvent } from "react";
import {
  CircleHelp,
  FolderOpen,
  Link2,
  LoaderCircle,
  Plus,
  Upload,
} from "lucide-react";
import type { Track } from "../core/types";
import { importTrack, importTrackFromUrl, saveTrack } from "../data/library";

export function ImportForm({
  onImported,
  onClose,
}: {
  onImported: (track: Track) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"local" | "url">("local");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [lyricName, setLyricName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const track =
        mode === "local"
          ? await importTrack(file!, lyrics)
          : await importTrackFromUrl(url.trim(), title.trim(), lyrics);
      if (mode === "local" && title.trim()) {
        track.title = title.trim();
        await saveTrack(track);
      }
      await onImported(track);
      onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="import-form">
      <div className="segmented">
        <button
          type="button"
          className={mode === "local" ? "active" : ""}
          onClick={() => setMode("local")}
          disabled={busy}
        >
          <FolderOpen size={16} /> 本地音频
        </button>
        <button
          type="button"
          className={mode === "url" ? "active" : ""}
          onClick={() => setMode("url")}
          disabled={busy}
        >
          <Link2 size={16} /> 音频直链
        </button>
      </div>
      {mode === "local" ? (
        <label className={`file-drop ${file ? "has-file" : ""}`}>
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aac"
            required
            disabled={busy}
            onChange={(event) => setFile(event.target.files![0] ?? null)}
          />
          <span className="upload-icon">
            <Upload size={24} />
          </span>
          <strong>{file ? file.name : "选择一首属于你的歌"}</strong>
          <span>支持 MP3、WAV 等浏览器可解码的音频</span>
          <span className="file-choose">
            {file ? "重新选择文件" : "浏览本地文件"} <Plus size={14} />
          </span>
        </label>
      ) : (
        <label className="field-label">
          音频文件直链
          <input
            type="url"
            placeholder="https://example.com/music.mp3"
            value={url}
            required
            disabled={busy}
            onChange={(event) => setUrl(event.target.value)}
          />
          <span className="field-hint">
            需要允许跨域访问的音频直链，不能填写歌曲详情页。如无法导入，请下载音频后选择本地导入。
          </span>
        </label>
      )}
      <label className="field-label">
        歌曲名称{" "}
        <span className="optional">{mode === "url" ? "必填" : "选填"}</span>
        <input
          required={mode === "url"}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={busy}
          placeholder={
            mode === "url" ? "为这首歌取个名字" : "默认使用音频文件名"
          }
          maxLength={120}
        />
      </label>
      <div className="field-label">
        <div className="label-between">
          <label htmlFor="lyrics-text">
            歌词 <span className="optional">选填</span>
          </label>
          <label className="lyric-file">
            <input
              type="file"
              accept=".lrc,.txt,text/plain"
              disabled={busy}
              onChange={async (event) => {
                const selected = event.target.files![0];
                if (selected) {
                  setLyrics(await selected.text());
                  setLyricName(selected.name);
                }
              }}
            />
            {lyricName || "导入 LRC 文件"} <Plus size={13} />
          </label>
        </div>
        <textarea
          id="lyrics-text"
          rows={4}
          value={lyrics}
          disabled={busy}
          onChange={(event) => setLyrics(event.target.value)}
          placeholder={
            "[00:00.00] 在这里，唱出你的第一句\n支持同步 LRC，也支持纯文字歌词"
          }
        />
      </div>
      <p className="import-note">
        <CircleHelp size={15} />{" "}
        请使用你有权使用的音频。导入原唱不会自动消除人声；练唱建议使用伴奏。
      </p>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <button
        className="button primary full"
        type="submit"
        disabled={busy || (mode === "local" && !file)}
      >
        {busy ? (
          <LoaderCircle size={18} className="spin" />
        ) : (
          <Plus size={18} />
        )}
        {busy ? "正在解码并导入…" : "加入我的曲库"}
      </button>
    </form>
  );
}
