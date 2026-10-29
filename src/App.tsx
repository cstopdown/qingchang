import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  ChevronRight,
  CircleHelp,
  Disc3,
  ExternalLink,
  Heart,
  Headphones,
  Library,
  LoaderCircle,
  Mic,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { MixerSettings, Recording, Track } from "./core/types";
import { useStudio } from "./hooks/useStudio";
import { getActiveLyricIndex, parseLrc } from "./audio/lyrics";
import { DEFAULT_MIXER_SETTINGS } from "./audio/mix";
import {
  deleteRecording,
  deleteTrack,
  initializeLibrary,
  listRecordings,
  listTracks,
  saveRecording,
  saveTrack,
} from "./data/library";
import { exportAudio, getPlatformLabel, openExternal } from "./platform/bridge";
import { CoverArt } from "./components/CoverArt";
import { Modal } from "./components/Modal";
import { RecordingCard } from "./components/RecordingCard";
import { ImportForm } from "./components/ImportForm";
import {
  Toggle,
  VocalToneSelector,
  MicPreviewButton,
} from "./components/StudioControls";
import { MixerPanel } from "./components/MixerPanel";
import { formatTime } from "./components/formatTime";

type View = "library" | "studio" | "recordings" | "settings";
type Filter = "all" | "favorite" | "local";
const originLabel = (track: Track) =>
  ({ demo: "原创练唱", local: "本地导入", url: "直链导入" })[track.origin];
const navigation = [
  { id: "library" as const, label: "练唱曲库", icon: Library },
  { id: "studio" as const, label: "录音工作室", icon: Mic },
  { id: "recordings" as const, label: "我的作品", icon: AudioLines },
];

export default function App() {
  const [view, setView] = useState<View>("library");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [importOpen, setImportOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    action: () => Promise<void>;
  } | null>(null);
  const [notification, setNotification] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const lyricContainer = useRef<HTMLDivElement>(null);
  const notify = useCallback(
    (text: string, error = false) => setNotification({ text, error }),
    [],
  );
  const handleRecordingComplete = useCallback(
    async (recording: Recording) => {
      await saveRecording(recording);
      setRecordings(await listRecordings());
      notify("这一遍，已好好保存。去「我的作品」听听吧。");
    },
    [notify],
  );
  const studio = useStudio(handleRecordingComplete);
  const { track, status, position, duration, settings } = studio;
  const locked = status === "recording" || status === "finishing";
  const playing = status === "playing" || status === "recording";
  const closeImport = useCallback(() => setImportOpen(false), []);
  const closeConfirmation = useCallback(() => setConfirmation(null), []);
  const perform = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      notify((error as Error).message, true);
    }
  };
  useEffect(() => {
    let active = true;
    initializeLibrary()
      .then(async () => {
        const [songs, takes] = await Promise.all([
          listTracks(),
          listRecordings(),
        ]);
        if (active) {
          setTracks(songs);
          setRecordings(takes);
          setLoading(false);
        }
      })
      .catch((error) => {
        if (active) {
          setLoadError((error as Error).message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!notification) return;
    const timeout = window.setTimeout(() => setNotification(null), 5500);
    return () => clearTimeout(timeout);
  }, [notification]);
  useEffect(() => {
    if (!locked && !studio.pendingRecording) return;
    const protectRecording = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", protectRecording);
    return () => window.removeEventListener("beforeunload", protectRecording);
  }, [locked, studio.pendingRecording]);
  const lyrics = useMemo(() => parseLrc(track?.lyrics ?? ""), [track?.lyrics]);
  const activeLyric = getActiveLyricIndex(
    lyrics,
    position + settings.lyricOffsetMs / 1000,
  );
  useEffect(() => {
    const container = lyricContainer.current;
    if (container) {
      const current = container.querySelector<HTMLElement>(
        '[data-active="true"]',
      );
      if (current)
        container.scrollTo({
          top:
            current.offsetTop -
            container.offsetTop -
            container.clientHeight / 2 +
            current.clientHeight / 2,
          behavior: "smooth",
        });
    }
  }, [activeLyric, view]);
  const visibleTracks = tracks.filter(
    (item) =>
      (filter === "all" ||
        (filter === "favorite" ? item.favorite : item.origin !== "demo")) &&
      `${item.title} ${item.artist}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const featured = tracks.find((item) => item.origin === "demo") ?? tracks[0];
  const setFavorite = (item: Track) =>
    perform(async () => {
      const updated = { ...item, favorite: !item.favorite };
      await saveTrack(updated);
      setTracks((items) =>
        items.map((song) => (song.id === item.id ? updated : song)),
      );
    });
  const selectForStudio = (item: Track) =>
    perform(async () => {
      setSelecting(true);
      try {
        if (track?.id !== item.id) await studio.selectTrack(item);
        setView("studio");
      } finally {
        setSelecting(false);
      }
    });
  const playTrack = (item: Track) =>
    perform(async () => {
      setSelecting(true);
      try {
        if (track?.id !== item.id) await studio.selectTrack(item);
        await studio.togglePlayback();
      } finally {
        setSelecting(false);
      }
    });
  const requestTrackDelete = (item: Track) =>
    setConfirmation({
      title: `移除「${item.title}」？`,
      description: "歌曲及导入的歌词将从本机曲库移除，已经录好的作品会保留。",
      action: async () => {
        if (track?.id === item.id) studio.stop();
        await deleteTrack(item.id);
        setTracks(await listTracks());
        notify("已从曲库移除");
      },
    });
  const exportRecording = (item: Recording) =>
    perform(async () => {
      const extension = item.audio.type.includes("wav")
        ? "wav"
        : item.audio.type.includes("mp4")
          ? "m4a"
          : item.audio.type.includes("ogg")
            ? "ogg"
            : "webm";
      const result = await exportAudio(
        item.audio,
        `${item.title}.${extension}`,
      );
      if (result === "saved") notify("作品已导出");
      if (result === "shared") notify("作品已交给系统分享");
    });
  const sourceLink = (url: string) => perform(() => openExternal(url));
  const showLibrary = () => {
    setView("library");
    setFilter("all");
  };
  const changeSettings = (patch: Partial<MixerSettings>) =>
    studio.updateSettings(patch);
  const togglePreview = () =>
    perform(async () => {
      if (studio.previewStatus === "on") studio.stopPreview();
      else await studio.startPreview();
    });
  useEffect(() => {
    if (view !== "studio" && view !== "settings") studio.stopPreview();
  }, [view]);

  return (
    <div className={`app-shell ${track ? "has-player" : ""}`}>
      <aside className="sidebar">
        <button className="brand" onClick={showLibrary} aria-label="轻唱首页">
          <span className="brand-symbol">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            轻唱<span className="brand-english">qingchang</span>
          </span>
        </button>
        <div className="sidebar-caption">给自己，一首歌的时间</div>
        <nav className="main-nav" aria-label="主导航">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              onClick={() => setView(item.id)}
              aria-current={view === item.id ? "page" : undefined}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
              {item.id === "studio" && locked ? (
                <span className="nav-record-dot" />
              ) : item.id === "recordings" && recordings.length > 0 ? (
                <span className="nav-count">{recordings.length}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <span className="sidebar-section-label">我的音乐</span>
        <button
          className={`nav-item secondary-nav ${view === "library" && filter === "favorite" ? "sub-active" : ""}`}
          onClick={() => {
            setView("library");
            setFilter("favorite");
          }}
        >
          <Heart size={18} />
          <span>心动收藏</span>
          <small>{tracks.filter((item) => item.favorite).length}</small>
        </button>
        <button
          className="nav-item secondary-nav"
          onClick={() => setImportOpen(true)}
          disabled={locked || selecting}
        >
          <Plus size={19} />
          <span>导入歌曲</span>
        </button>
        <div className="sidebar-bottom">
          <div className="private-card">
            <span className="private-icon">
              <Headphones size={22} strokeWidth={1.4} />
            </span>
            <strong>小小的私人舞台</strong>
            <p>不必完美，尽管开口。</p>
            <span>
              <span className="status-dot" /> 音频与作品保存在本机
            </span>
          </div>
          <button
            className={`nav-item settings-nav ${view === "settings" ? "active" : ""}`}
            onClick={() => setView("settings")}
          >
            <Settings2 size={19} />
            <span>偏好设置</span>
            <span className="version">v0.1</span>
          </button>
        </div>
      </aside>

      <main className={`main-content view-${view}`}>
        <header className="topbar">
          <div className="breadcrumb">
            我的音乐空间 <ChevronRight size={14} />
            <span>
              {view === "library"
                ? filter === "favorite"
                  ? "心动收藏"
                  : "练唱曲库"
                : view === "studio"
                  ? "录音工作室"
                  : view === "recordings"
                    ? "我的作品"
                    : "偏好设置"}
            </span>
          </div>
          <div className="topbar-right">
            <span className="local-badge" role="status" aria-live="polite">
              {selecting ? (
                <>
                  <LoaderCircle size={11} className="spin" /> 准备音频中
                </>
              ) : (
                <>
                  <span className="status-dot" /> 本地模式
                </>
              )}
            </span>
            <span className="profile-avatar" aria-label="个人音乐空间">
              Q<span />
            </span>
          </div>
        </header>
        {(loadError || studio.error) && (
          <div className="engine-error" role="alert">
            <CircleHelp size={18} />
            <span>{loadError || studio.error}</span>
            {studio.error && (
              <button
                aria-label="关闭错误提示"
                className="icon-button"
                onClick={studio.clearError}
              >
                <X size={17} />
              </button>
            )}
          </div>
        )}

        {studio.pendingRecording && (
          <div className="pending-recording" role="alert">
            <div>
              <strong>这一遍声音已暂存，还没有保存成功。</strong>
              <p>
                可重试保存到作品，或直接导出音频。暂存仅在当前会话有效，关闭前请处理。
              </p>
            </div>
            <div className="pending-actions">
              <button
                className="button ghost"
                disabled={saving}
                onClick={() =>
                  perform(async () => {
                    setSaving(true);
                    try {
                      await studio.retrySaveRecording();
                    } finally {
                      setSaving(false);
                    }
                  })
                }
              >
                {saving ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Check size={15} />
                )}
                重试保存
              </button>
              <button
                className="button ghost"
                onClick={() => exportRecording(studio.pendingRecording!)}
              >
                <ArrowDownToLine size={15} />
                直接导出
              </button>
              <button
                className="text-button"
                onClick={() =>
                  setConfirmation({
                    title: "放弃这遍暂存录音？",
                    description:
                      "这遍录音还没有保存在作品中。请先确认已导出，否则放弃后无法恢复。",
                    action: async () => {
                      studio.discardPendingRecording();
                    },
                  })
                }
              >
                放弃暂存
              </button>
            </div>
          </div>
        )}

        {view === "library" && (
          <div className="page-content library-page">
            <section className="page-heading">
              <div>
                <div className="eyebrow">
                  <span className="small-line" /> MAKE ROOM FOR YOUR VOICE
                </div>
                <h1>
                  {filter === "favorite"
                    ? "留给心动的歌。"
                    : "今天，想唱点什么？"}
                </h1>
                <p>
                  {filter === "favorite"
                    ? "反复喜欢的旋律，值得再唱一遍。"
                    : "戴上耳机，把日常的片刻唱成自己的声音。"}
                </p>
              </div>
              <button
                className="button import-button"
                disabled={locked || selecting}
                onClick={() => setImportOpen(true)}
              >
                <Plus size={18} /> 导入歌曲
              </button>
            </section>
            {filter !== "favorite" && (
              <section className="feature-layout">
                <div className="hero-card">
                  <div className="hero-copy">
                    <span className="hero-tag">
                      <span /> 你的私人练唱时刻
                    </span>
                    <h2>
                      把今天，
                      <br />
                      唱给自己听<span>。</span>
                    </h2>
                    <p>
                      这里没有评委，也不用等一个好天气。
                      <br />
                      从一首歌开始，听见自己的声音。
                    </p>
                    <button
                      className="button primary hero-action"
                      disabled={!featured || locked || selecting}
                      onClick={() => featured && selectForStudio(featured)}
                    >
                      <Mic size={18} /> 开始我的第一首 <ArrowRight size={17} />
                    </button>
                    <span className="hero-footnote">
                      {selecting
                        ? "正在准备音频…"
                        : "原创伴奏已就位 · 随时开唱"}
                    </span>
                  </div>
                  <div className="hero-art" aria-hidden="true">
                    <div className="hero-orbit orbit-one" />
                    <div className="hero-orbit orbit-two" />
                    <div className="hero-art-label">
                      A LITTLE MOMENT
                      <br />
                      ALL YOURS.
                    </div>
                    <div className="hero-vinyl">
                      <div className="vinyl-grooves" />
                      <div className="vinyl-label">
                        <span>轻 / 唱</span>
                        <i />
                        <small>SIDE A · YOUR VOICE</small>
                      </div>
                    </div>
                    <svg className="hero-sparkle" viewBox="0 0 40 40">
                      <path
                        d="M20 1c0 14 5 19 19 19-14 0-19 5-19 19C20 25 15 20 1 20 15 20 20 15 20 1Z"
                        fill="currentColor"
                      />
                    </svg>
                    <span className="hero-art-small">33⅓ RPM / SLOW DOWN</span>
                  </div>
                </div>
                <div className="daily-card">
                  <div className="daily-top">
                    <span className="eyebrow">THE QUIET SESSION</span>
                    <Headphones size={20} strokeWidth={1.5} />
                  </div>
                  <div className="daily-wave" aria-hidden="true">
                    {[
                      16, 28, 45, 64, 39, 74, 91, 60, 42, 69, 48, 31, 53, 34,
                      18,
                    ].map((height, index) => (
                      <i key={index} style={{ height: `${height}%` }} />
                    ))}
                  </div>
                  <h3>
                    让声音，
                    <br />
                    有个自在的地方。
                  </h3>
                  <p>
                    一副耳机，一点勇气。
                    <br />
                    剩下的，交给旋律。
                  </p>
                  <div className="daily-bottom">
                    <span>为热爱而唱</span>
                    <span>
                      JUST FOR YOU <ArrowRight size={14} />
                    </span>
                  </div>
                </div>
              </section>
            )}
            <section className="library-section">
              <div className="section-title-row">
                <div>
                  <h2>
                    {filter === "favorite" ? "我的心动收藏" : "我的练唱曲库"}
                    <span className="count-pill">
                      {
                        tracks.filter(
                          (item) => filter !== "favorite" || item.favorite,
                        ).length
                      }
                    </span>
                  </h2>
                  <p>从熟悉的旋律开始，慢慢找到自己的节奏</p>
                </div>
                <div className="search-field">
                  <Search size={17} />
                  <input
                    aria-label="搜索歌曲或歌手"
                    placeholder="搜索歌曲、歌手"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query && (
                    <button aria-label="清空搜索" onClick={() => setQuery("")}>
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
              <div className="library-toolbar">
                <div className="library-tabs" aria-label="曲库筛选">
                  {(
                    [
                      { value: "all", label: "全部歌曲" },
                      { value: "favorite", label: "我的收藏" },
                      { value: "local", label: "我的导入" },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.value}
                      onClick={() => setFilter(item.value)}
                      className={filter === item.value ? "active" : ""}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <span className="library-hint">
                  <ShieldCheck size={14} /> 只在你的设备上
                </span>
              </div>
              <div className="track-table">
                <div className="track-table-head">
                  <span>#</span>
                  <span>歌曲 / 创作者</span>
                  <span>来源</span>
                  <span>时长</span>
                  <span>开始练唱</span>
                </div>
                <div role="list">
                  {visibleTracks.map((item, index) => (
                    <div
                      role="listitem"
                      className={`track-row ${track?.id === item.id ? "selected" : ""}`}
                      key={item.id}
                    >
                      <button
                        className="row-number"
                        aria-label={`${track?.id === item.id && playing ? "暂停" : "播放"} ${item.title}`}
                        disabled={locked || selecting}
                        onClick={() => playTrack(item)}
                      >
                        {track?.id === item.id && playing ? (
                          <AudioLines size={18} className="now-playing-icon" />
                        ) : (
                          <>
                            <span>{String(index + 1).padStart(2, "0")}</span>
                            <Play size={15} fill="currentColor" />
                          </>
                        )}
                      </button>
                      <div className="track-identity">
                        <button
                          className="cover-button"
                          aria-label={`进入 ${item.title} 录音台`}
                          disabled={locked || selecting}
                          onClick={() => selectForStudio(item)}
                        >
                          <CoverArt color={item.cover} />
                        </button>
                        <button
                          className="track-title-button"
                          disabled={locked || selecting}
                          onClick={() => selectForStudio(item)}
                        >
                          <strong>{item.title}</strong>
                          <span>{item.artist}</span>
                        </button>
                      </div>
                      <span
                        className={`origin-tag ${item.origin === "demo" ? "original" : ""}`}
                      >
                        {originLabel(item)}
                      </span>
                      <span className="track-duration">
                        {formatTime(item.duration)}
                      </span>
                      <div className="track-actions">
                        <button
                          className={`icon-button favorite-button ${item.favorite ? "is-favorite" : ""}`}
                          onClick={() => setFavorite(item)}
                          aria-label={`${item.favorite ? "取消收藏" : "收藏"} ${item.title}`}
                          aria-pressed={item.favorite}
                        >
                          <Heart
                            size={18}
                            fill={item.favorite ? "currentColor" : "none"}
                          />
                        </button>
                        <button
                          className="sing-button"
                          disabled={locked || selecting}
                          onClick={() => selectForStudio(item)}
                        >
                          <Mic size={15} />
                          <span>练唱</span>
                        </button>
                        <button
                          className="icon-button delete-track"
                          title={
                            track?.id === item.id
                              ? "请先切换到其他歌曲，再移除此曲"
                              : "从曲库移除"
                          }
                          disabled={
                            locked || selecting || track?.id === item.id
                          }
                          onClick={() => requestTrackDelete(item)}
                          aria-label={`移除歌曲 ${item.title}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {loading ? (
                  <div className="empty-state small">
                    <LoaderCircle className="spin" size={24} />
                    <p>正在布置你的音乐空间…</p>
                  </div>
                ) : visibleTracks.length === 0 ? (
                  <div className="empty-state small">
                    <Music2 size={28} />
                    <h3>
                      {query
                        ? "还没有找到这首歌"
                        : filter === "favorite"
                          ? "把喜欢的歌，留在这里"
                          : "让第一首歌住进来"}
                    </h3>
                    <p>
                      {query
                        ? "换个关键词，或导入你自己的音频。"
                        : filter === "favorite"
                          ? "点亮歌曲旁的爱心，下次更快找到它。"
                          : "导入本地伴奏，开启你的私人练唱。"}
                    </p>
                  </div>
                ) : null}
              </div>
              <p className="library-note">
                <Disc3 size={14} />{" "}
                原创练唱为轻唱自制短伴奏，配有同步歌词，适合体验完整录音流程。
              </p>
            </section>
            <section className="source-section">
              <div className="section-title-row">
                <div>
                  <h2>
                    去发现更多好歌 <ExternalLink size={15} />
                  </h2>
                  <p>找一首想唱的歌，再带回你的练唱空间</p>
                </div>
                <span className="source-caption">外部音频来源</span>
              </div>
              <div className="source-grid">
                <button
                  className="source-card"
                  onClick={() => sourceLink("https://tonzhon.com")}
                >
                  <span className="source-logo tonzhon">
                    <Music2 size={23} />
                  </span>
                  <span>
                    <strong>
                      铜钟音乐 <ExternalLink size={12} />
                    </strong>
                    <small>探索音乐，寻找下一首心动</small>
                  </span>
                  <ArrowUpRightIcon />
                </button>
                <button
                  className="source-card"
                  onClick={() => sourceLink("https://www.jbsou.cn/")}
                >
                  <span className="source-logo jbsou">
                    <Radio size={23} />
                  </span>
                  <span>
                    <strong>
                      煎饼搜 <ExternalLink size={12} />
                    </strong>
                    <small>找到旋律，让灵感接着唱</small>
                  </span>
                  <ArrowUpRightIcon />
                </button>
              </div>
              <p className="source-disclaimer">
                将在外部浏览器打开。获取音频后可本地导入；普通原唱不会自动变成伴奏，请确认使用权限。
              </p>
            </section>
            <footer className="page-footer">
              <span className="footer-brand">
                轻唱 <span>每一种声音，都值得被听见。</span>
              </span>
              <span>
                MADE FOR YOUR LITTLE STAGE{" "}
                <span className="footer-star">✳</span>
              </span>
            </footer>
          </div>
        )}

        {view === "studio" && (
          <div className="page-content studio-page">
            <section className="page-heading">
              <div>
                <div className="eyebrow">
                  <span className="small-line" /> YOUR LITTLE RECORDING STUDIO
                </div>
                <h1>现在，舞台属于你。</h1>
                <p>不必一遍就完美。放松，跟着旋律，慢慢唱。</p>
              </div>
              <button className="button ghost" onClick={showLibrary}>
                <ArrowLeft size={16} /> 返回曲库
              </button>
            </section>
            {!track ? (
              <div className="studio-empty">
                <div className="empty-mic">
                  <Mic size={46} strokeWidth={1.2} />
                </div>
                <h2>从一首喜欢的歌开始</h2>
                <p>
                  去曲库选一首原创练唱，或导入自己的伴奏。
                  <br />
                  准备好耳机，就可以留下第一遍声音。
                </p>
                <button className="button primary" onClick={showLibrary}>
                  去选一首歌 <ArrowRight size={17} />
                </button>
              </div>
            ) : (
              <>
                <div className="studio-layout">
                  <section className="studio-stage">
                    <div className="studio-track-header">
                      <CoverArt color={track.cover} spinning={playing} />
                      <div>
                        <span className="studio-origin">
                          {originLabel(track)}
                        </span>
                        <h2>{track.title}</h2>
                        <p>{track.artist}</p>
                      </div>
                      <span
                        className={`session-indicator ${status === "recording" ? "is-recording" : ""}`}
                      >
                        <span />
                        {status === "recording"
                          ? "正在录音"
                          : status === "finishing"
                            ? "准备或保存中"
                            : playing
                              ? "正在播放"
                              : "准备就绪"}
                      </span>
                    </div>
                    <div
                      className="lyrics-viewport"
                      ref={lyricContainer}
                      aria-label="歌曲歌词"
                    >
                      {lyrics.length > 0 ? (
                        <div className="synced-lyrics">
                          {lyrics.map((line, index) => (
                            <button
                              key={`${line.time}-${index}`}
                              disabled={locked || selecting}
                              onClick={() => studio.seek(line.time)}
                              className={index === activeLyric ? "active" : ""}
                              data-active={index === activeLyric}
                            >
                              {line.text || "♪"}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="plain-lyrics">
                          {track.lyrics ? (
                            track.lyrics
                              .split("\n")
                              .map((line, index) => (
                                <p key={index}>{line || "\u00a0"}</p>
                              ))
                          ) : (
                            <>
                              <Music2 size={32} />
                              <p>这段旋律，留给你自由发挥。</p>
                              <small>这首歌还没有同步歌词</small>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="studio-transport">
                      <div className="timeline">
                        <span>{formatTime(position)}</span>
                        <input
                          type="range"
                          min="0"
                          max={duration || 1}
                          step="0.05"
                          value={Math.min(position, duration || 1)}
                          onChange={(event) =>
                            studio.seek(Number(event.target.value))
                          }
                          disabled={locked || selecting}
                          aria-label="歌曲进度"
                          style={
                            {
                              "--progress": `${duration ? (position / duration) * 100 : 0}%`,
                            } as React.CSSProperties
                          }
                        />
                        <span>{formatTime(duration)}</span>
                      </div>
                      <div className="studio-controls">
                        <button
                          className="icon-button restart"
                          disabled={locked || selecting}
                          aria-label="从头播放"
                          onClick={() => studio.seek(0)}
                        >
                          <span>↺</span>
                        </button>
                        <button
                          className="play-control"
                          disabled={locked || selecting}
                          aria-label={playing ? "暂停伴奏" : "播放伴奏"}
                          onClick={() => perform(studio.togglePlayback)}
                        >
                          {playing ? (
                            <Pause size={23} fill="currentColor" />
                          ) : (
                            <Play size={23} fill="currentColor" />
                          )}
                        </button>
                        {locked ? (
                          <button
                            className="button record-button stop-record"
                            disabled={status === "finishing"}
                            onClick={() => perform(studio.stopRecording)}
                          >
                            {status === "finishing" ? (
                              <LoaderCircle size={17} className="spin" />
                            ) : (
                              <Square size={14} fill="currentColor" />
                            )}
                            {status === "finishing"
                              ? "正在准备或保存…"
                              : "结束并保存"}
                          </button>
                        ) : (
                          <button
                            className="button record-button"
                            disabled={selecting || !!studio.pendingRecording}
                            onClick={() => perform(studio.startRecording)}
                          >
                            <span className="record-dot" /> 开始录音
                          </button>
                        )}
                        <span className="take-hint">
                          {locked ? "这一刻，只管唱。" : "开录将从歌曲开头开始"}
                        </span>
                      </div>
                    </div>
                  </section>
                  <MixerPanel studio={studio} onPreview={togglePreview} />
                </div>
                <div className="studio-bottom-note">
                  <ShieldCheck size={16} />
                  <span>
                    人声与伴奏将在本机混合保存。音高仅作练唱参考，不生成评分。
                  </span>
                  <button onClick={() => setView("settings")}>
                    调整延迟与歌词偏移 <ArrowRight size={14} />
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {view === "recordings" && (
          <div className="page-content recordings-page">
            <section className="page-heading">
              <div>
                <div className="eyebrow">
                  <span className="small-line" /> A COLLECTION OF YOUR MOMENTS
                </div>
                <h1>把声音，留在这里。</h1>
                <p>每一次认真开口，都是一份只属于你的作品。</p>
              </div>
              <span className="works-count">
                {recordings.length} <span>份声音记忆</span>
              </span>
            </section>
            {recordings.length ? (
              <div className="recordings-grid">
                {recordings.map((item) => (
                  <RecordingCard
                    key={item.id}
                    recording={item}
                    onExport={() => exportRecording(item)}
                    onDelete={() =>
                      setConfirmation({
                        title: "删除这份声音记忆？",
                        description: `「${item.title}」将从本机永久删除。你可以先导出一份留存。`,
                        action: async () => {
                          await deleteRecording(item.id);
                          setRecordings(await listRecordings());
                          notify("作品已删除");
                        },
                      })
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="studio-empty works-empty">
                <div className="empty-mic">
                  <AudioLines size={46} strokeWidth={1.2} />
                </div>
                <h2>你的第一份作品，正在路上</h2>
                <p>
                  不需要专业设备，只需要一首歌的时间。
                  <br />
                  录下的声音会好好保存在这里。
                </p>
                <button
                  className="button primary"
                  onClick={() => {
                    if (track) setView("studio");
                    else showLibrary();
                  }}
                >
                  <Mic size={17} /> 去录一首
                </button>
              </div>
            )}
            <div className="privacy-footnote">
              <ShieldCheck size={17} />
              <span>
                作品保存在当前设备。清理应用或浏览器数据可能删除作品，喜欢的记得导出留存。
              </span>
            </div>
          </div>
        )}

        {view === "settings" && (
          <div className="page-content settings-page">
            <section className="page-heading">
              <div>
                <div className="eyebrow">
                  <span className="small-line" /> MAKE YOURSELF COMFORTABLE
                </div>
                <h1>找到舒服的节奏。</h1>
                <p>让设备配合你的声音，偏好会自动保存在本机。</p>
              </div>
            </section>
            <div className="settings-layout">
              <div>
                <section className="settings-card">
                  <h2>
                    <Headphones size={20} /> 聆听与录音
                  </h2>
                  <div className="settings-row">
                    <div>
                      <h3>耳机返听</h3>
                      <p>戴好耳机后开启返听，测试或录音时可实时听到自己。</p>
                    </div>
                    <Toggle
                      label="设置耳机返听"
                      checked={settings.monitoring}
                      onChange={(checked) =>
                        changeSettings({ monitoring: checked })
                      }
                    />
                  </div>
                  <div className="settings-preview">
                    <div>
                      <h3>先听听自己的声音</h3>
                      <p>
                        点击测试启用麦克风。返听关闭时，只看电平与音高；开启返听即可试听滤镜。
                      </p>
                    </div>
                    <MicPreviewButton
                      status={studio.previewStatus}
                      disabled={locked}
                      onClick={togglePreview}
                    />
                  </div>
                  <div className="settings-tone">
                    <VocalToneSelector
                      value={settings.vocalTone}
                      onChange={(vocalTone) => changeSettings({ vocalTone })}
                    />
                  </div>
                  <div className="settings-block">
                    <div className="label-between">
                      <label htmlFor="latency-setting">录音延迟补偿</label>
                      <span className="setting-value">
                        {settings.latencyMs} ms
                      </span>
                    </div>
                    <p>
                      人声比伴奏慢时，增大此数值。仅影响录音混合，建议先录一小段试听。
                    </p>
                    <input
                      id="latency-setting"
                      type="range"
                      min="-500"
                      max="500"
                      step="10"
                      value={settings.latencyMs}
                      disabled={locked || selecting}
                      onChange={(event) =>
                        changeSettings({
                          latencyMs: Number(event.target.value),
                        })
                      }
                    />
                    <div className="range-labels">
                      <span>-500 ms</span>
                      <span>+500 ms</span>
                    </div>
                    {locked && (
                      <small className="field-hint">
                        录音结束后可调整延迟补偿。
                      </small>
                    )}
                  </div>
                  <div className="settings-block">
                    <div className="label-between">
                      <label htmlFor="lyric-setting">歌词时间偏移</label>
                      <span className="setting-value">
                        {settings.lyricOffsetMs > 0 ? "+" : ""}
                        {settings.lyricOffsetMs} ms
                      </span>
                    </div>
                    <p>正值让歌词提前，负值让歌词延后。不会改变音频。</p>
                    <input
                      id="lyric-setting"
                      type="range"
                      min="-3000"
                      max="3000"
                      step="100"
                      value={settings.lyricOffsetMs}
                      onChange={(event) =>
                        changeSettings({
                          lyricOffsetMs: Number(event.target.value),
                        })
                      }
                    />
                    <div className="range-labels">
                      <span>延后 3 秒</span>
                      <span>提前 3 秒</span>
                    </div>
                  </div>
                  <button
                    className="text-button settings-reset"
                    disabled={locked || selecting}
                    onClick={() => {
                      changeSettings(DEFAULT_MIXER_SETTINGS);
                      notify("已恢复默认录音设置");
                    }}
                  >
                    恢复默认录音设置 <ArrowRight size={14} />
                  </button>
                </section>
                <section className="settings-card device-card">
                  <h2>
                    <SlidersHorizontal size={20} /> 当前环境
                  </h2>
                  <div className="device-row">
                    <span>运行平台</span>
                    <strong>{getPlatformLabel()}</strong>
                  </div>
                  <div className="device-row">
                    <span>音频来源</span>
                    <strong>原创练唱 / 本地文件 / 音频直链</strong>
                  </div>
                  <div className="device-row">
                    <span>保存方式</span>
                    <strong>设备本地存储</strong>
                  </div>
                </section>
              </div>
              <aside className="settings-aside">
                <div className="settings-drawing">
                  <Headphones size={64} strokeWidth={0.8} />
                  <span>LISTEN CLOSELY.</span>
                </div>
                <h3>
                  先听见自己，
                  <br />
                  再慢慢唱好。
                </h3>
                <p>
                  有线耳机通常能提供更低的返听延迟。蓝牙耳机更适合听歌，录音时可能出现延迟。
                </p>
                <div className="settings-tip">
                  <ShieldCheck size={18} />
                  <div>
                    <strong>这是你的私人空间</strong>
                    <p>
                      曲库与作品留在本机。录音需要麦克风权限，导出后可自行分享。
                    </p>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        )}
      </main>

      {track && (
        <div className={`global-player ${locked ? "recording-active" : ""}`}>
          <button className="player-song" onClick={() => setView("studio")}>
            <CoverArt color={track.cover} />
            <span>
              <strong>{track.title}</strong>
              <small>
                {locked
                  ? status === "finishing"
                    ? "正在准备或保存作品…"
                    : "正在录音 · 点击回到工作室"
                  : "随时回到你的练唱时刻"}
              </small>
            </span>
          </button>
          <div className="player-center">
            {locked ? (
              <button
                className="mini-stop"
                disabled={status === "finishing"}
                onClick={() => perform(studio.stopRecording)}
              >
                {status === "finishing" ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Square size={12} fill="currentColor" />
                )}
                <span>{status === "finishing" ? "处理中" : "结束录音"}</span>
              </button>
            ) : (
              <button
                className="mini-play"
                disabled={selecting}
                aria-label={playing ? "暂停播放" : "开始播放"}
                onClick={() => perform(studio.togglePlayback)}
              >
                {playing ? (
                  <Pause size={18} fill="currentColor" />
                ) : (
                  <Play size={18} fill="currentColor" />
                )}
              </button>
            )}
            <span className="player-time">
              {formatTime(position)}
              <span> / {formatTime(duration)}</span>
            </span>
            <div className="mini-progress">
              <i
                style={{
                  width: `${duration ? (position / duration) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          <button
            className="player-studio-link"
            onClick={() => setView("studio")}
          >
            <Mic size={17} />
            <span>进入工作室</span>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
      <nav className="mobile-nav" aria-label="移动端导航">
        {[
          ...navigation,
          { id: "settings" as const, label: "设置", icon: Settings2 },
        ].map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "active" : ""}
            onClick={() => setView(item.id)}
            aria-current={view === item.id ? "page" : undefined}
          >
            <item.icon size={21} />
            <span>{item.label === "录音工作室" ? "工作室" : item.label}</span>
            {item.id === "studio" && locked && <i />}
          </button>
        ))}
      </nav>
      {importOpen && (
        <Modal title="让喜欢的歌，住进来。" onClose={closeImport}>
          <ImportForm
            onClose={closeImport}
            onImported={async () => {
              setTracks(await listTracks());
              notify("已加入曲库，可以开始练唱了");
            }}
          />
        </Modal>
      )}
      {confirmation && (
        <Modal title={confirmation.title} onClose={closeConfirmation}>
          <p className="confirm-description">{confirmation.description}</p>
          <div className="confirm-actions">
            <button
              className="button ghost"
              onClick={closeConfirmation}
              disabled={saving}
            >
              再想一下
            </button>
            <button
              className="button danger"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await confirmation.action();
                  closeConfirmation();
                } catch (error) {
                  notify((error as Error).message, true);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Trash2 size={17} />
              )}{" "}
              确认删除
            </button>
          </div>
        </Modal>
      )}
      {notification && (
        <div
          className={`toast ${notification.error ? "toast-error" : ""}`}
          role={notification.error ? "alert" : "status"}
        >
          {notification.error ? <CircleHelp size={18} /> : <Check size={18} />}
          <span>{notification.text}</span>
          <button aria-label="关闭通知" onClick={() => setNotification(null)}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg
      className="arrow-up-right"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M6 18 18 6M6 6h12v12" />
    </svg>
  );
}
