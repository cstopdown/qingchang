function parseRecordingUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("VITE_PUBLIC_RECORDING_URL 必须是无用户名和密码的 HTTPS 地址");
  }
  return url.href;
}

const recordingUrl = parseRecordingUrl(import.meta.env.VITE_PUBLIC_RECORDING_URL);

export function SecureRecordingNotice() {
  return (
    <div className="engine-error secure-recording-notice" role="status">
      <div>
        <strong>当前页面无法录音</strong>
        <p>浏览器仅允许安全环境访问麦克风。请使用 HTTPS 入口或本机 localhost 打开轻唱，并允许麦克风权限。</p>
        <p>HTTP 与 HTTPS 的曲库和作品按浏览器来源隔离，切换前请导出重要作品。</p>
        {recordingUrl && (
          <a href={recordingUrl} target="_blank" rel="noopener noreferrer">打开安全录音入口</a>
        )}
      </div>
    </div>
  );
}
