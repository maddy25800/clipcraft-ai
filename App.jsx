import { useState, useRef, useEffect } from "react";

// In production (Railway), API is same origin. In dev, Vite proxies /api → localhost:8000
const API = "";

const STAGES = ["upload", "analyze", "clips", "export"];

export default function VideoToShorts() {
  const [stage, setStage] = useState("upload");
  const [videoFile, setVideoFile] = useState(null);
  const [videoURL, setVideoURL] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [clips, setClips] = useState([]);
  const [selectedClips, setSelectedClips] = useState(new Set());
  const [exportResults, setExportResults] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  const [burnCaptions, setBurnCaptions] = useState(true);
  const fileInputRef = useRef();

  const handleFile = (file) => {
    if (!file) return;
    setVideoFile(file);
    setVideoURL(URL.createObjectURL(file));
    setError(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("video/")) handleFile(file);
  };

  const analyzeVideo = async () => {
    setStage("analyze");
    setLoading(true);
    setError(null);
    try {
      setLoadingMsg("Uploading & transcribing audio...");
      const formData = new FormData();
      formData.append("file", videoFile);
      const transcribeRes = await fetch(`${API}/api/transcribe`, { method: "POST", body: formData });
      if (!transcribeRes.ok) throw new Error("Transcription failed");
      const transcribeData = await transcribeRes.json();

      setLoadingMsg("Finding viral moments with AI...");
      const analyzeRes = await fetch(`${API}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(transcribeData),
      });
      if (!analyzeRes.ok) throw new Error("Analysis failed");
      const analyzeData = await analyzeRes.json();

      setClips(analyzeData.clips);
      setSelectedClips(new Set(analyzeData.clips.map((c) => c.id)));
      setStage("clips");
    } catch (err) {
      setError(`Error: ${err.message}`);
      setStage("upload");
    } finally {
      setLoading(false);
    }
  };

  const exportClips = async () => {
    setStage("export");
    setLoading(true);
    setError(null);
    try {
      const clipsToExport = clips.filter((c) => selectedClips.has(c.id));
      setLoadingMsg(`Cutting ${clipsToExport.length} clips & burning captions...`);
      const res = await fetch(`${API}/api/export-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clips: clipsToExport, burn_captions: burnCaptions }),
      });
      if (!res.ok) throw new Error("Export failed");
      const data = await res.json();
      setExportResults(data.results);
    } catch (err) {
      setError(`Export error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const toggleClip = (id) => {
    setSelectedClips((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const reset = () => {
    setStage("upload");
    setVideoFile(null);
    setVideoURL(null);
    setClips([]);
    setSelectedClips(new Set());
    setExportResults([]);
    setError(null);
  };

  return (
    <div style={s.root}>
      <div style={s.noise} />
      <div style={s.glow1} />
      <div style={s.glow2} />

      <header style={s.header}>
        <div style={s.logo}>
          <span style={s.logoIcon}>⚡</span>
          <span style={s.logoText}>CLIPCRAFT</span>
          <span style={s.logoBadge}>AI</span>
        </div>
        <p style={s.tagline}>Drop a long video. Get viral-ready shorts.</p>
      </header>

      <nav style={s.nav}>
        {STAGES.map((st, i) => (
          <div key={st} style={s.navItem}>
            <div style={{ ...s.navDot, ...(st === stage ? s.navDotActive : {}), ...(STAGES.indexOf(stage) > i ? s.navDotDone : {}) }}>
              {STAGES.indexOf(stage) > i ? "✓" : i + 1}
            </div>
            <span style={{ ...s.navLabel, ...(st === stage ? s.navLabelActive : {}) }}>{st.toUpperCase()}</span>
            {i < STAGES.length - 1 && <div style={{ ...s.navLine, ...(STAGES.indexOf(stage) > i ? s.navLineDone : {}) }} />}
          </div>
        ))}
      </nav>

      {error && <div style={s.errorBanner}>⚠️ {error}</div>}

      <main style={s.main}>
        {stage === "upload" && <UploadStage {...{ dragOver, setDragOver, handleDrop, fileInputRef, handleFile, videoFile, videoURL, onAnalyze: analyzeVideo }} />}
        {stage === "analyze" && <AnalyzeStage loadingMsg={loadingMsg} />}
        {stage === "clips" && <ClipsStage {...{ clips, selectedClips, toggleClip, onExport: exportClips, burnCaptions, setBurnCaptions }} />}
        {stage === "export" && <ExportStage {...{ loading, loadingMsg, results: exportResults, clips: clips.filter(c => selectedClips.has(c.id)), onReset: reset }} />}
      </main>
    </div>
  );
}

function UploadStage({ dragOver, setDragOver, handleDrop, fileInputRef, handleFile, videoFile, videoURL, onAnalyze }) {
  return (
    <div style={s.col}>
      <div
        style={{ ...s.dropzone, ...(dragOver ? s.dropzoneActive : {}), ...(videoFile ? s.dropzoneDone : {}) }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !videoFile && fileInputRef.current.click()}
      >
        <input ref={fileInputRef} type="file" accept="video/*" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
        {!videoFile ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>🎬</div>
            <p style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px", color: "#e8eaf0" }}>Drop your video here</p>
            <p style={{ fontSize: 13, color: "#4b5563", margin: "0 0 24px" }}>MP4, MOV, AVI · Any length</p>
            <button style={s.browseBtn} onClick={(e) => { e.stopPropagation(); fileInputRef.current.click(); }}>Browse Files</button>
          </div>
        ) : (
          <div style={{ width: "100%", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <video src={videoURL} style={{ width: "100%", borderRadius: 10, maxHeight: 300, objectFit: "contain", background: "#000" }} controls />
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "rgba(0,255,136,0.05)", borderRadius: 10, border: "1px solid rgba(0,255,136,0.15)" }}>
              <span style={{ fontSize: 20 }}>📹</span>
              <div><p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#e8eaf0" }}>{videoFile.name}</p><p style={{ margin: 0, fontSize: 11, color: "#6b7280" }}>{(videoFile.size / 1024 / 1024).toFixed(1)} MB</p></div>
              <span style={{ marginLeft: "auto", color: "#00ff88", fontSize: 18, fontWeight: 700 }}>✓</span>
            </div>
          </div>
        )}
      </div>
      {videoFile && (
        <button style={s.primaryBtn} onClick={onAnalyze}>
          <span>Analyze & Find Clips</span><span style={{ fontSize: 18 }}>→</span>
        </button>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
        {[["🎙️", "Whisper Transcription"], ["🤖", "Claude AI Analysis"], ["✂️", "FFmpeg Cutting"], ["📝", "Auto Captions"]].map(([icon, label]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.03)", border: "1px solid #1e2028", borderRadius: 20, padding: "6px 14px", fontSize: 12, color: "#9ca3af" }}>
            <span>{icon}</span><span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyzeStage({ loadingMsg }) {
  const [dots, setDots] = useState("");
  useEffect(() => { const t = setInterval(() => setDots(d => d.length >= 3 ? "" : d + "."), 400); return () => clearInterval(t); }, []);
  return (
    <div style={{ ...s.col, alignItems: "center", padding: "60px 0" }}>
      <div style={{ width: 100, height: 100, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "1px solid rgba(0,255,136,0.3)", animation: "spin 3s linear infinite" }} />
        <div style={{ position: "absolute", inset: 10, borderRadius: "50%", border: "1px solid rgba(0,212,255,0.2)", animation: "spin 2s linear infinite reverse" }} />
        <span style={{ fontSize: 32 }}>⚡</span>
      </div>
      <p style={{ fontSize: 18, fontWeight: 600, color: "#00ff88", margin: 0 }}>{loadingMsg}{dots}</p>
      <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>AI is scanning your video for viral moments</p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "center" }}>
        {["Audio Extraction", "Whisper Transcription", "Claude Analysis", "Clip Detection"].map((step, i) => (
          <div key={step} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#00ff88", animation: `pulse 1.5s ease-in-out ${i * 0.3}s infinite` }} />
            <span style={{ fontSize: 12, color: "#6b7280" }}>{step}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClipsStage({ clips, selectedClips, toggleClip, onExport, burnCaptions, setBurnCaptions }) {
  return (
    <div style={s.col}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: "#e8eaf0" }}>AI Found {clips.length} Viral Clips</h2>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>{selectedClips.size} selected for export</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={burnCaptions} onChange={(e) => setBurnCaptions(e.target.checked)} style={{ accentColor: "#00ff88" }} />
            <span style={{ color: "#9ca3af", fontSize: 13 }}>Burn captions</span>
          </label>
          <button style={s.primaryBtn} onClick={onExport} disabled={selectedClips.size === 0}>
            Export {selectedClips.size} Clip{selectedClips.size !== 1 ? "s" : ""} →
          </button>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {clips.map(clip => <ClipCard key={clip.id} clip={clip} selected={selectedClips.has(clip.id)} onToggle={() => toggleClip(clip.id)} />)}
      </div>
    </div>
  );
}

function ClipCard({ clip, selected, onToggle }) {
  const score = clip.viralScore || 85;
  const scoreColor = score >= 90 ? "#00ff88" : score >= 75 ? "#ffcc00" : "#ff6b6b";
  return (
    <div style={{ display: "flex", gap: 16, padding: 16, background: selected ? "rgba(0,255,136,0.04)" : "rgba(17,19,24,0.8)", border: `1px solid ${selected ? "rgba(0,255,136,0.4)" : "#1e2028"}`, borderRadius: 14, cursor: "pointer", alignItems: "flex-start" }} onClick={onToggle}>
      <div style={{ paddingTop: 2 }}>
        <div style={{ width: 20, height: 20, borderRadius: 6, border: `1.5px solid ${selected ? "#00ff88" : "#2a2d36"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, background: selected ? "#00ff88" : "transparent", color: "#080a0f", fontWeight: 700 }}>{selected && "✓"}</div>
      </div>
      <div style={{ width: 72, height: 128, borderRadius: 8, background: "linear-gradient(180deg,#1a1d26,#111318)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, position: "relative" }}>
        <span style={{ color: "#2a2d36", fontSize: 20 }}>▶</span>
        <span style={{ position: "absolute", bottom: 4, left: 4, background: "rgba(0,0,0,0.8)", color: "#fff", fontSize: 10, padding: "2px 5px", borderRadius: 4, fontWeight: 600 }}>{clip.duration}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#e8eaf0" }}>{clip.title}</h3>
          <div style={{ fontSize: 13, fontWeight: 700, border: `1px solid ${scoreColor}`, borderRadius: 6, padding: "2px 8px", color: scoreColor, flexShrink: 0 }}>{score}</div>
        </div>
        <p style={{ margin: "0 0 4px", fontSize: 12, color: "#9ca3af", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>"{clip.hook}"</p>
        <p style={{ margin: "0 0 10px", fontSize: 12, color: "#6b7280" }}>{clip.reason}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#4b5563" }}>⏱ {clip.startTime} → {clip.endTime}</span>
          {(clip.tags || []).slice(0, 3).map(t => <span key={t} style={{ fontSize: 10, color: "#6366f1", background: "rgba(99,102,241,0.1)", padding: "2px 7px", borderRadius: 10 }}>{t}</span>)}
        </div>
      </div>
    </div>
  );
}

function ExportStage({ loading, loadingMsg, results, clips, onReset }) {
  const [dots, setDots] = useState("");
  useEffect(() => { if (!loading) return; const t = setInterval(() => setDots(d => d.length >= 3 ? "" : d + "."), 400); return () => clearInterval(t); }, [loading]);

  if (loading) return (
    <div style={{ ...s.col, alignItems: "center", padding: "60px 0" }}>
      <div style={{ width: 100, height: 100, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "1px solid rgba(0,255,136,0.3)", animation: "spin 3s linear infinite" }} />
        <span style={{ fontSize: 32 }}>🎞️</span>
      </div>
      <p style={{ fontSize: 18, fontWeight: 600, color: "#00ff88", margin: 0 }}>{loadingMsg}{dots}</p>
      <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>FFmpeg is cutting & burning captions</p>
    </div>
  );

  return (
    <div style={{ ...s.col, alignItems: "center" }}>
      <div style={{ fontSize: 64 }}>🎉</div>
      <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "#e8eaf0" }}>{results.filter(r => r.success).length} Clips Ready!</h2>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
        {clips.map(clip => {
          const result = results.find(r => r.clip_id === clip.id);
          return (
            <div key={clip.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, background: "rgba(17,19,24,0.8)", border: "1px solid #1e2028", borderRadius: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 8, background: "linear-gradient(135deg,#00ff88,#00d4ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#080a0f", flexShrink: 0 }}>▶</div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 2px", fontSize: 13, fontWeight: 600, color: "#e8eaf0" }}>{clip.title}</p>
                <p style={{ margin: 0, fontSize: 11, color: "#6b7280" }}>{clip.duration} · 9:16 · 1080p · Captioned</p>
              </div>
              {result?.success
                ? <a href={result.download_url} download style={{ background: "transparent", border: "1px solid #2a2d36", color: "#9ca3af", padding: "7px 14px", borderRadius: 7, fontSize: 12, textDecoration: "none" }}>↓ Download</a>
                : <span style={{ color: "#ff6b6b", fontSize: 12 }}>Failed</span>}
            </div>
          );
        })}
      </div>
      <button style={s.secondaryBtn} onClick={onReset}>Process New Video</button>
    </div>
  );
}

const s = {
  root: { minHeight: "100vh", background: "#080a0f", color: "#e8eaf0", fontFamily: "'DM Mono','Fira Code',monospace", position: "relative", overflow: "hidden", paddingBottom: 80 },
  noise: { position: "fixed", inset: 0, backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E\")", pointerEvents: "none", zIndex: 0 },
  glow1: { position: "fixed", top: -200, left: "20%", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle,rgba(0,255,136,0.06) 0%,transparent 70%)", pointerEvents: "none" },
  glow2: { position: "fixed", bottom: -200, right: "10%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle,rgba(99,102,241,0.08) 0%,transparent 70%)", pointerEvents: "none" },
  header: { textAlign: "center", padding: "48px 24px 24px", position: "relative", zIndex: 1 },
  logo: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 8 },
  logoIcon: { fontSize: 28 },
  logoText: { fontSize: 32, fontWeight: 700, letterSpacing: "0.15em", background: "linear-gradient(135deg,#00ff88,#00d4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
  logoBadge: { background: "linear-gradient(135deg,#00ff88,#00d4ff)", color: "#080a0f", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4 },
  tagline: { color: "#6b7280", fontSize: 14, margin: 0 },
  nav: { display: "flex", justifyContent: "center", alignItems: "center", padding: "24px 24px 0", position: "relative", zIndex: 1 },
  navItem: { display: "flex", alignItems: "center", gap: 8 },
  navDot: { width: 28, height: 28, borderRadius: "50%", border: "1px solid #2a2d36", background: "#111318", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#4b5563", fontWeight: 600, flexShrink: 0 },
  navDotActive: { border: "1px solid #00ff88", color: "#00ff88", background: "rgba(0,255,136,0.08)", boxShadow: "0 0 12px rgba(0,255,136,0.3)" },
  navDotDone: { background: "#00ff88", color: "#080a0f", border: "1px solid #00ff88" },
  navLabel: { fontSize: 10, color: "#4b5563", letterSpacing: "0.1em", fontWeight: 600 },
  navLabelActive: { color: "#00ff88" },
  navLine: { width: 40, height: 1, background: "#1e2028", margin: "0 4px" },
  navLineDone: { background: "#00ff88" },
  errorBanner: { maxWidth: 860, margin: "16px auto 0", padding: "12px 20px", background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 10, color: "#ff6b6b", fontSize: 13, position: "relative", zIndex: 1 },
  main: { maxWidth: 860, margin: "0 auto", padding: "32px 20px", position: "relative", zIndex: 1 },
  col: { display: "flex", flexDirection: "column", gap: 24 },
  dropzone: { width: "100%", minHeight: 280, border: "1px dashed #2a2d36", borderRadius: 16, cursor: "pointer", background: "rgba(17,19,24,0.6)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  dropzoneActive: { border: "1px dashed #00ff88", background: "rgba(0,255,136,0.04)" },
  dropzoneDone: { border: "1px solid #1e2028", cursor: "default" },
  browseBtn: { background: "transparent", border: "1px solid #2a2d36", color: "#9ca3af", padding: "10px 24px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontFamily: "inherit" },
  primaryBtn: { background: "linear-gradient(135deg,#00ff88,#00d4ff)", color: "#080a0f", border: "none", padding: "14px 32px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: "inherit", letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 4px 20px rgba(0,255,136,0.25)" },
  secondaryBtn: { background: "transparent", border: "1px solid #2a2d36", color: "#9ca3af", padding: "14px 28px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: "inherit" },
};

const styleEl = document.createElement("style");
styleEl.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.4;transform:scale(0.7)} }
`;
document.head.appendChild(styleEl);
