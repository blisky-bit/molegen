import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { renderPng, renderSpin, API_BASE, getRenderMeta } from "./api";
import MoleculeViewer from "./MoleculeViewer";

const LS_KEY = "molegen_frames_v1";

function ease(t, mode) {
  if (mode === "step") return 0;
  if (mode === "smooth") return t; // linear
  // ease-in-out
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function resolveFrame(frames, idx) {
  let acc = null;
  for (let k = 0; k <= idx; k++) {
    const f = frames[k];
    if (!f) continue;
    acc = acc
      ? { ...acc, ...f, highlight: { ...(acc.highlight || {}), ...(f.highlight || {}) } }
      : JSON.parse(JSON.stringify(f));
  }
  return acc;
}

function lerpFrame(a, b, t, mode) {
  const tt = ease(t, mode);
  const pick = (va, vb) => (tt < 0.5 ? va : vb);
  const lerp = (x, y) => x + (y - x) * tt;

  return {
    ...a,
    // B
    opacity: lerp(a.opacity ?? 100, b.opacity ?? (a.opacity ?? 100)),
    opacityMode: pick(a.opacityMode, b.opacityMode),

    // C
    dispersion: lerp(a.dispersion ?? 0, b.dispersion ?? (a.dispersion ?? 0)),
    position: pick(a.position, b.position),
    bias: pick(a.bias, b.bias),

    // D
    contactA: pick(a.contactA, b.contactA),
    clashWarn: pick(a.clashWarn, b.clashWarn),
    highlight: pick(a.highlight, b.highlight),

    // E
    duration: pick(a.duration, b.duration),
    interpolation: pick(a.interpolation, b.interpolation),
    intensity: lerp(a.intensity ?? 50, b.intensity ?? (a.intensity ?? 50)),
  };
}

const defaultFrame = (i) => ({
  id: crypto.randomUUID(),
  name: `Frame ${i}`,
  objects: [],
  opacity: 100,
  opacityMode: "uniform",
  position: "outside",
  dispersion: 0,
  bias: "none",
  contactA: null,
  clashWarn: true,
  highlight: { type: "none", query: "" },
  duration: 1.5,
  interpolation: "smooth",
  intensity: 50,
});

export default function App() {
  // ========= Frames (localStorage load/save) =========
  const [frames, setFrames] = useState(() => {
    const saved = localStorage.getItem(LS_KEY);
    try {
      const arr = saved ? JSON.parse(saved) : null;
      return Array.isArray(arr) && arr.length ? arr : [defaultFrame(1)];
    } catch {
      return [defaultFrame(1)];
    }
  });

  const [activeId, setActiveId] = useState(() => {
    const saved = localStorage.getItem(LS_KEY);
    try {
      const arr = saved ? JSON.parse(saved) : null;
      return Array.isArray(arr) && arr.length ? arr[0].id : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(frames));
    if (!frames.find((f) => f.id === activeId)) {
      setActiveId(frames[0]?.id ?? null);
    }
  }, [frames, activeId]);

  const active = useMemo(() => frames.find((f) => f.id === activeId), [frames, activeId]);

  const updateActive = (patch) => {
    setFrames((prev) => prev.map((f) => (f.id === activeId ? { ...f, ...patch } : f)));
  };

  const addFrame = () => setFrames((prev) => [...prev, defaultFrame(prev.length + 1)]);

  const duplicateFrame = (id) => {
    setFrames((prev) => {
      const src = prev.find((f) => f.id === id);
      if (!src) return prev;
      const copy = { ...src, id: crypto.randomUUID(), name: `${src.name} copy` };
      return [...prev, copy];
    });
  };

  const deleteFrame = (id) => {
    setFrames((prev) => (prev.length === 1 ? prev : prev.filter((f) => f.id !== id)));
    if (activeId === id) {
      const nextFirst = frames.find((f) => f.id !== id);
      setActiveId(nextFirst?.id ?? null);
    }
  };

  // ========= Live preview playhead =========
  const [isPlaying, setIsPlaying] = useState(false);
  const [playhead, setPlayhead] = useState({ i: 0, t: 0 });
  const [renderFrame, setRenderFrame] = useState(null);

  // ========= PDB + backend render =========
  const [pdbFile, setPdbFile] = useState(null);
  const [pdbText, setPdbText] = useState("");

  const [preset, setPreset] = useState("clean_cartoon");
  const [w, setW] = useState(900);
  const [h, setH] = useState(700);
  const [dpi, setDpi] = useState(150);

  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [lastResult, setLastResult] = useState(null);

  const pymolExe = "pymol";

  // ========= viewer/canvas refs (recording) =========
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const handleViewerReady = useCallback((viewer, canvas) => {
    viewerRef.current = viewer;
    canvasRef.current = canvas;
  }, []);

  // ========= MediaRecorder that returns blob =========
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const stopPromiseRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);

  const startRecord = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return false;

    const stream = canvas.captureStream(30);
    chunksRef.current = [];

    const options =
      MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? { mimeType: "video/webm;codecs=vp9" }
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
        ? { mimeType: "video/webm;codecs=vp8" }
        : { mimeType: "video/webm" };

    const rec = new MediaRecorder(stream, options);
    recorderRef.current = rec;

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    stopPromiseRef.current = new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        resolve(blob);
      };
    });

    rec.start(200);
    setIsRecording(true);
    return true;
  }, []);

  const stopRecord = useCallback(async () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    setIsRecording(false);
    return await stopPromiseRef.current; // Blob
  }, []);

  // ========= Export control =========
  const exportingRef = useRef(false);

  const exportMp4 = useCallback(() => {
    if (!pdbText) return alert("Load a PDB file first.");
    if (frames.length < 2) return alert("Need at least 2 frames to export.");
    if (isRecording) return;

    exportingRef.current = true;

    // reset to start
    setIsPlaying(false);
    setPlayhead({ i: 0, t: 0 });
    setRenderFrame(resolveFrame(frames, 0));

    // start recording
    const ok = startRecord();
    if (!ok) {
      exportingRef.current = false;
      alert("Canvas not ready yet.");
      return;
    }

    // start playback next tick
    requestAnimationFrame(() => setIsPlaying(true));
  }, [pdbText, frames, isRecording, startRecord]);

  // ========= Playback loop =========
  useEffect(() => {
    if (!isPlaying) return;
    if (!frames.length) return;

    let raf = 0;
    let last = performance.now();
    let cancelled = false;

    const tick = async (now) => {
      if (cancelled) return;

      const dt = (now - last) / 1000;
      last = now;

      const i = playhead.i;
      const a = resolveFrame(frames, i);
      const dur = Math.max(0.2, a.duration ?? 1.5);

      let nt = playhead.t + dt / dur;
      let ni = i;

      if (nt >= 1) {
        nt = 0;
        ni = i + 1;

        if (ni >= frames.length - 1) {
          setIsPlaying(false);
          setPlayhead({ i: frames.length - 1, t: 0 });
          setRenderFrame(resolveFrame(frames, frames.length - 1));

          // If exporting, stop record + upload for MP4
          if (exportingRef.current) {
            exportingRef.current = false;

            try {
              const webmBlob = await stopRecord();

              const fd = new FormData();
              fd.append("file", webmBlob, "molegen_capture.webm");

              const res = await fetch(`${API_BASE}/convert/mp4`, {
                method: "POST",
                body: fd,
              });

              if (!res.ok) {
                const txt = await res.text();
                alert(`convert/mp4 failed: ${txt}`);
                return;
              }

              const data = await res.json();

              setErr("");
              setBusy(true);
              setLastResult(null);
              setJob({
                renderId: data.render_id,
                type: "mp4",
                downloadPath: data.download_mp4,
                detailPath: data.detail_url,
                status: "queued",
              });
            } catch (e) {
              alert(`Export failed: ${String(e?.message || e)}`);
            }
          }

          return;
        }
      }

      const mode = a.interpolation ?? "smooth";
      setPlayhead({ i: ni, t: nt });

      const aa = resolveFrame(frames, ni);
      const bb = resolveFrame(frames, Math.min(ni + 1, frames.length - 1));
      setRenderFrame(lerpFrame(aa, bb, nt, mode));

      raf = requestAnimationFrame(tick);
    };

    setRenderFrame(resolveFrame(frames, playhead.i));
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [isPlaying, frames, playhead.i, playhead.t, stopRecord]);

  // ========= Poll render meta (backend jobs) =========
  useEffect(() => {
    if (!job?.renderId) return;

    let alive = true;

    const tick = async () => {
      try {
        const meta = await getRenderMeta(job.renderId);
        if (!alive) return;

        const st = meta.status || "queued";
        setJob((prev) => (prev ? { ...prev, status: st } : prev));

        if (st === "done") {
          setBusy(false);
          setLastResult({
            render_id: job.renderId,
            download_png: job.type === "png" ? job.downloadPath : null,
            download_mp4: job.type === "mp4" ? job.downloadPath : null,
          });
          return;
        }

        if (st === "failed") {
          setBusy(false);
          setErr(meta.stderr || meta.stdout || "Render failed");
          return;
        }

        setTimeout(tick, 1000);
      } catch {
        if (!alive) return;
        setTimeout(tick, 1500);
      }
    };

    tick();
    return () => {
      alive = false;
    };
  }, [job?.renderId]);

  const onRenderPNG = async () => {
    if (!pdbFile) return alert("PDB 파일을 먼저 선택해");
    setErr("");
    setBusy(true);
    setLastResult(null);
    setJob(null);

    try {
      const data = await renderPng({
        file: pdbFile,
        preset,
        draft: true,
        width: w,
        height: h,
        dpi,
        pymol: pymolExe,
      });
      setJob({
        renderId: data.render_id,
        type: "png",
        downloadPath: data.download_png,
        detailPath: data.detail_url,
        status: "queued",
      });
    } catch (e) {
      setBusy(false);
      setErr(String(e.message || e));
    }
  };

  const onRenderMP4 = async () => {
    if (!pdbFile) return alert("PDB 파일을 먼저 선택해");
    setErr("");
    setBusy(true);
    setLastResult(null);
    setJob(null);

    try {
      const data = await renderSpin({
        file: pdbFile,
        preset,
        quality: "draft",
        frames: 60,
        fps: 24,
        width: w,
        height: h,
        pymol: pymolExe,
      });
      setJob({
        renderId: data.render_id,
        type: "mp4",
        downloadPath: data.download_mp4,
        detailPath: data.detail_url,
        status: "queued",
      });
    } catch (e) {
      setBusy(false);
      setErr(String(e.message || e));
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui" }}>
      {/* Left: frames */}
      <aside style={{ width: 260, borderRight: "1px solid #ddd", padding: 12 }}>
        <h2 style={{ margin: "0 0 8px" }}>Frames</h2>
        <button onClick={addFrame} style={{ width: "100%", marginBottom: 10 }}>
          + Add Frame
        </button>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {frames.map((f) => (
            <div
              key={f.id}
              style={{
                border: "1px solid #ccc",
                borderRadius: 8,
                padding: 8,
                background: f.id === activeId ? "#eef6ff" : "white",
                cursor: "pointer",
              }}
              onClick={() => setActiveId(f.id)}
            >
              <div style={{ fontWeight: 600 }}>{f.name}</div>
              <div style={{ fontSize: 12, color: "#555" }}>
                opacity {f.opacity}% · {f.position} · {f.duration}s
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button onClick={(e) => (e.stopPropagation(), duplicateFrame(f.id))}>Copy</button>
                <button onClick={(e) => (e.stopPropagation(), deleteFrame(f.id))}>Del</button>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Right: editor */}
      <main style={{ flex: 1, padding: 16, overflow: "auto" }}>
        <h1 style={{ marginTop: 0 }}>Molegen — Frame Editor</h1>

        {/* Live preview */}
        <section style={{ marginTop: 14, padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
          <h3 style={{ marginTop: 0 }}>Live Preview (3D)</h3>
          <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>
            프레임 파라미터 변경이 즉시 반영됨 (다운로드 아님)
          </div>

          <div
            style={{
              height: 420,
              width: "100%",
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              background: "#0b1220",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {pdbText ? (
              <MoleculeViewer pdbText={pdbText} frame={isPlaying ? renderFrame : active} onReady={handleViewerReady} />
            ) : (
              <div style={{ color: "#94a3b8", fontSize: 14 }}>Select PDB file to preview molecule here</div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button onClick={startRecord} disabled={isRecording || !pdbText}>
              Record (webm)
            </button>
            <button
              onClick={async () => {
                if (!isRecording) return;
                const blob = await stopRecord();
                // quick local download (optional)
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "molegen_capture.webm";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
              disabled={!isRecording}
            >
              Stop (download webm)
            </button>

            <button onClick={exportMp4} disabled={isRecording || busy || !pdbText || frames.length < 2}>
              Export MP4 (timeline)
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => setIsPlaying(true)} disabled={isPlaying || frames.length < 2}>
              ▶ Play
            </button>
            <button onClick={() => setIsPlaying(false)} disabled={!isPlaying}>
              ⏸ Pause
            </button>
            <button
              onClick={() => {
                setIsPlaying(false);
                setPlayhead({ i: 0, t: 0 });
                setRenderFrame(resolveFrame(frames, 0));
              }}
            >
              ⏹ Stop
            </button>
          </div>
        </section>

        {/* Backend render */}
        <section style={{ marginTop: 14, padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
          <h3 style={{ marginTop: 0 }}>Render (backend)</h3>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="file"
              accept=".pdb"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setPdbFile(f);
                setErr("");
                setLastResult(null);

                if (!f) {
                  setPdbText("");
                  return;
                }

                const reader = new FileReader();
                reader.onload = () => setPdbText(String(reader.result || ""));
                reader.onerror = () => setErr("Failed to read file");
                reader.readAsText(f);
              }}
            />

            <label>
              Preset{" "}
              <select value={preset} onChange={(e) => setPreset(e.target.value)}>
                <option value="clean_cartoon">clean_cartoon</option>
              </select>
            </label>

            <label>
              W{" "}
              <input type="number" value={w} onChange={(e) => setW(Number(e.target.value))} style={{ width: 80 }} />
            </label>
            <label>
              H{" "}
              <input type="number" value={h} onChange={(e) => setH(Number(e.target.value))} style={{ width: 80 }} />
            </label>
            <label>
              DPI{" "}
              <input type="number" value={dpi} onChange={(e) => setDpi(Number(e.target.value))} style={{ width: 80 }} />
            </label>

            <button onClick={onRenderPNG} disabled={busy}>
              Generate PNG
            </button>
            <button onClick={onRenderMP4} disabled={busy}>
              Generate MP4 (spin)
            </button>

            <span style={{ color: busy ? "#b45309" : "#16a34a", fontWeight: 600 }}>
              {busy ? `rendering... (${job?.status || "queued"})` : "ready"}
            </span>
          </div>

          {err && (
            <pre
              style={{
                marginTop: 10,
                whiteSpace: "pre-wrap",
                background: "#111",
                color: "#f87171",
                padding: 10,
                borderRadius: 8,
              }}
            >
              {err}
            </pre>
          )}

          {lastResult && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 700 }}>Result</div>
              <div>render_id: {lastResult.render_id}</div>

              {lastResult.download_png && (
                <div>
                  PNG:{" "}
                  <a href={`${API_BASE}${lastResult.download_png}`} target="_blank" rel="noreferrer">
                    open/download
                  </a>
                </div>
              )}

              {lastResult.download_mp4 && (
                <div>
                  MP4:{" "}
                  <a href={`${API_BASE}${lastResult.download_mp4}`} target="_blank" rel="noreferrer">
                    open/download
                  </a>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Frame params */}
        {!active ? (
          <div style={{ marginTop: 14 }}>No frame selected</div>
        ) : (
          <>
            <label style={{ display: "block", margin: "14px 0 10px" }}>
              Frame name
              <input
                value={active.name}
                onChange={(e) => updateActive({ name: e.target.value })}
                style={{ display: "block", width: 320, marginTop: 4 }}
              />
            </label>

            <Section title="B. Visual Presence">
              <Row label={`Opacity (${active.opacity}%)`}>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={active.opacity}
                  onChange={(e) => updateActive({ opacity: Number(e.target.value) })}
                />
              </Row>
              <Row label="Opacity mode">
                <select value={active.opacityMode} onChange={(e) => updateActive({ opacityMode: e.target.value })}>
                  <option value="uniform">Uniform fade</option>
                  <option value="particle">Particle-wise fade</option>
                </select>
              </Row>
            </Section>

            <Section title="C. Spatial Configuration">
              <Row label="Position">
                <select value={active.position} onChange={(e) => updateActive({ position: e.target.value })}>
                  <option value="outside">Outside</option>
                  <option value="near">Near surface</option>
                  <option value="center">Center</option>
                  <option value="manual">Manual</option>
                </select>
              </Row>

              <Row label={`Distribution (${active.dispersion})`}>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={active.dispersion}
                  onChange={(e) => updateActive({ dispersion: Number(e.target.value) })}
                />
              </Row>

              <Row label="Directional bias">
                <select value={active.bias} onChange={(e) => updateActive({ bias: e.target.value })}>
                  <option value="none">None</option>
                  <option value="toward">Toward center</option>
                  <option value="away">Away from center</option>
                </select>
              </Row>
            </Section>

            <Section title="D. Structural Highlight (Safe Zone)">
              <Row label="Contact distance (Å)">
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 3.0"
                  value={active.contactA ?? ""}
                  onChange={(e) => updateActive({ contactA: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </Row>

              <Row label="Clash warning">
                <input
                  type="checkbox"
                  checked={active.clashWarn}
                  onChange={(e) => updateActive({ clashWarn: e.target.checked })}
                />
              </Row>

              <Row label="Region highlight">
                <select
                  value={active.highlight.type}
                  onChange={(e) => updateActive({ highlight: { ...active.highlight, type: e.target.value } })}
                >
                  <option value="none">None</option>
                  <option value="residue">Residue</option>
                  <option value="ligand">Ligand</option>
                  <option value="pocket">Binding pocket</option>
                </select>
              </Row>

              <Row label="Highlight query">
                <input
                  placeholder='e.g. "45-60" or "45,48,50"'
                  value={active.highlight.query}
                  onChange={(e) => updateActive({ highlight: { ...active.highlight, query: e.target.value } })}
                  style={{ width: 420 }}
                />
              </Row>
            </Section>

            <Section title="E. Timing & Transition">
              <Row label="Frame duration (s)">
                <input
                  type="number"
                  step="0.1"
                  min="0.2"
                  max="10"
                  value={active.duration}
                  onChange={(e) => updateActive({ duration: Number(e.target.value) })}
                />
              </Row>

              <Row label="Interpolation">
                <select value={active.interpolation} onChange={(e) => updateActive({ interpolation: e.target.value })}>
                  <option value="step">Step</option>
                  <option value="smooth">Smooth</option>
                  <option value="easeinout">Ease-in/out</option>
                </select>
              </Row>

              <Row label={`Motion intensity (${active.intensity})`}>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={active.intensity}
                  onChange={(e) => updateActive({ intensity: Number(e.target.value) })}
                />
              </Row>
            </Section>

            <Section title="Preview JSON (for backend later)">
              <pre style={{ background: "#111", color: "#0f0", padding: 12, borderRadius: 8 }}>
                {JSON.stringify(frames, null, 2)}
              </pre>
            </Section>
          </>
        )}
      </main>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ margin: "18px 0", padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </section>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
      <div style={{ width: 220, color: "#333" }}>{label}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}