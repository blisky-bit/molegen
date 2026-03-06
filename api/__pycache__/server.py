from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import json
import subprocess
import shutil
import time
import datetime
import uuid

app = FastAPI(title="Molegen API", version="0.3")

# CORS (React dev server)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output"
RENDERS_DIR = OUTPUT_DIR / "renders"
INDEX_PATH = OUTPUT_DIR / "index.json"
PYTHON_EXE = "python"  # run inside the conda env that has pymol + ffmpeg


def safe_slug(s: str) -> str:
    s = "".join(c for c in s if c.isalnum() or c in ("_", "-")).strip("_-")
    return s or "preset"


def make_render_id(preset: str) -> str:
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    short = uuid.uuid4().hex[:6]
    return f"{ts}_{short}_{safe_slug(preset)}"


def rebuild_index():
    cmd = [PYTHON_EXE, str(ROOT / "renderer" / "build_index.py")]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("Index rebuild failed:", r.stdout, r.stderr)


def init_meta(render_id: str, kind: str, preset: str, params: dict):
    render_dir = RENDERS_DIR / render_id
    render_dir.mkdir(parents=True, exist_ok=True)
    meta = {
        "render_id": render_id,
        "kind": kind,                 # "png" | "spin" | "timeline" | "convert"
        "preset": preset,
        "params": params,
        "status": "queued",           # queued|running|done|failed
        "created_at": int(time.time()),
        "updated_at": int(time.time()),
        "files": {},
    }
    (render_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return render_dir


def set_status(render_id: str, status: str, extra: dict | None = None):
    meta_path = RENDERS_DIR / render_id / "meta.json"
    if not meta_path.exists():
        return
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["status"] = status
    meta["updated_at"] = int(time.time())
    if extra:
        meta.update(extra)
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def run_png_job(render_id: str, cmd: list[str]):
    set_status(render_id, "running")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        set_status(render_id, "failed", {
            "stdout": r.stdout[-2000:],
            "stderr": r.stderr[-2000:],
        })
        return
    set_status(render_id, "done", {"files": {"png": "result.png"}})
    rebuild_index()


def run_spin_job(render_id: str, cmd: list[str]):
    set_status(render_id, "running")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        set_status(render_id, "failed", {
            "stdout": r.stdout[-2000:],
            "stderr": r.stderr[-2000:],
        })
        return
    set_status(render_id, "done", {"files": {"mp4": "result.mp4"}})
    rebuild_index()


def run_timeline_job(render_id: str, cmd: list[str]):
    set_status(render_id, "running")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        set_status(render_id, "failed", {
            "stdout": r.stdout[-2000:],
            "stderr": r.stderr[-2000:],
        })
        return
    set_status(render_id, "done", {"files": {"mp4": "result.mp4"}})
    rebuild_index()


def run_convert_job(render_id: str, cmd: list[str]):
    set_status(render_id, "running")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        set_status(render_id, "failed", {
            "stdout": r.stdout[-2000:],
            "stderr": r.stderr[-2000:],
        })
        return
    set_status(render_id, "done", {"files": {"mp4": "result.mp4"}})
    rebuild_index()


@app.get("/")
def home():
    return {
        "name": "Molegen API",
        "endpoints": [
            "/renders",
            "/renders/{render_id}",
            "/download/{render_id}/{filename}",
            "POST /render/png",
            "POST /render/spin",
            "POST /render/timeline",
            "POST /convert/mp4",
        ],
    }


@app.get("/renders")
def list_renders():
    if not INDEX_PATH.exists():
        raise HTTPException(status_code=404, detail="index.json not found. Run index builder first.")
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


@app.get("/renders/{render_id}")
def render_detail(render_id: str):
    meta = RENDERS_DIR / render_id / "meta.json"
    if not meta.exists():
        raise HTTPException(status_code=404, detail="render_id not found")
    return json.loads(meta.read_text(encoding="utf-8"))


@app.get("/download/{render_id}/{filename}")
def download_file(render_id: str, filename: str):
    file_path = RENDERS_DIR / render_id / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="file not found")
    return FileResponse(path=str(file_path), filename=filename)


@app.post("/render/png")
def render_png(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    preset: str = Form("clean_cartoon"),
    draft: bool = Form(True),
    width: int = Form(1600),
    height: int = Form(1200),
    dpi: int = Form(300),
    pymol: str = Form("pymol"),
):
    tmp_dir = OUTPUT_DIR / "_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = tmp_dir / file.filename

    with tmp_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    render_id = make_render_id(preset)
    init_meta(render_id, "png", preset, params={
        "draft": draft,
        "width": width,
        "height": height,
        "dpi": dpi,
        "pymol": pymol,
        "preset": preset,
        "pdb_filename": file.filename,
    })

    cmd = [
        PYTHON_EXE, str(ROOT / "renderer" / "renderer.py"),
        "--render-id", render_id,
        "--pymol", pymol,
        "--pdb", str(tmp_path.relative_to(ROOT)),
        "--preset", preset,
        "--width", str(width),
        "--height", str(height),
        "--dpi", str(dpi),
    ]
    if draft:
        cmd.append("--draft")

    print("JOB CMD:", " ".join(cmd))
    background_tasks.add_task(run_png_job, render_id, cmd)

    return {
        "status": "queued",
        "render_id": render_id,
        "detail_url": f"/renders/{render_id}",
        "download_png": f"/download/{render_id}/result.png",
    }


@app.post("/render/spin")
def render_spin(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    preset: str = Form("clean_cartoon"),
    quality: str = Form("draft"),  # draft|standard|final
    frames: int | None = Form(None),
    fps: int | None = Form(None),
    width: int | None = Form(None),
    height: int | None = Form(None),
    pymol: str = Form("pymol"),
):
    tmp_dir = OUTPUT_DIR / "_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = tmp_dir / file.filename

    with tmp_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    render_id = make_render_id(preset)
    init_meta(render_id, "spin", preset, params={
        "quality": quality,
        "frames": frames,
        "fps": fps,
        "width": width,
        "height": height,
        "pymol": pymol,
        "preset": preset,
        "pdb_filename": file.filename,
    })

    cmd = [
        PYTHON_EXE, str(ROOT / "renderer" / "render_spin.py"),
        "--render-id", render_id,
        "--pymol", pymol,
        "--pdb", str(tmp_path.relative_to(ROOT)),
        "--preset", preset,
        "--quality", quality,
    ]
    if frames is not None:
        cmd += ["--frames", str(frames)]
    if fps is not None:
        cmd += ["--fps", str(fps)]
    if width is not None:
        cmd += ["--width", str(width)]
    if height is not None:
        cmd += ["--height", str(height)]

    print("JOB CMD:", " ".join(cmd))
    background_tasks.add_task(run_spin_job, render_id, cmd)

    return {
        "status": "queued",
        "render_id": render_id,
        "detail_url": f"/renders/{render_id}",
        "download_mp4": f"/download/{render_id}/result.mp4",
    }


@app.post("/render/timeline")
def render_timeline(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    frames_json: str = Form(...),   # UI에서 JSON.stringify(frames)
    preset: str = Form("clean_cartoon"),
    quality: str = Form("draft"),   # draft|standard|final
    width: int | None = Form(None),
    height: int | None = Form(None),
    fps: int | None = Form(None),
    pymol: str = Form("pymol"),
):
    # 업로드 저장
    tmp_dir = OUTPUT_DIR / "_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = tmp_dir / file.filename
    with tmp_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    # 프레임 파싱
    try:
        frames = json.loads(frames_json)
        if not isinstance(frames, list) or len(frames) == 0:
            raise ValueError("frames must be a non-empty list")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid frames_json: {e}")

    render_id = make_render_id("timeline_" + preset)

    # meta 생성 + frames 저장
    params = {
        "preset": preset,
        "quality": quality,
        "width": width,
        "height": height,
        "fps": fps,
        "pymol": pymol,
        "pdb_filename": file.filename,
        "frames_count": len(frames),
    }
    render_dir = init_meta(render_id, "timeline", preset, params=params)
    (render_dir / "frames.json").write_text(
        json.dumps(frames, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    cmd = [
        PYTHON_EXE, str(ROOT / "renderer" / "render_timeline.py"),
        "--render-id", render_id,
        "--pymol", pymol,
        "--pdb", str(tmp_path.relative_to(ROOT)),
        "--preset", preset,
        "--quality", quality,
        "--frames-json", str((render_dir / "frames.json").relative_to(ROOT)),
    ]
    if width is not None:
        cmd += ["--width", str(width)]
    if height is not None:
        cmd += ["--height", str(height)]
    if fps is not None:
        cmd += ["--fps", str(fps)]

    print("JOB CMD:", " ".join(cmd))
    background_tasks.add_task(run_timeline_job, render_id, cmd)

    return {
        "status": "queued",
        "render_id": render_id,
        "detail_url": f"/renders/{render_id}",
        "download_mp4": f"/download/{render_id}/result.mp4",
    }


@app.post("/convert/mp4")
def convert_mp4(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),          # webm input
    fps: int | None = Form(None),          # optional
):
    """
    Convert uploaded WebM to MP4 (H.264 / yuv420p) using ffmpeg.
    Returns a render_id so UI can poll /renders/{render_id}.
    """
    # save upload
    tmp_dir = OUTPUT_DIR / "_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    in_name = file.filename or "capture.webm"
    in_path = tmp_dir / in_name
    with in_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    render_id = make_render_id("convert")
    render_dir = init_meta(render_id, "convert", "ffmpeg", params={
        "fps": fps,
        "input_filename": in_name,
    })

    out_path = render_dir / "result.mp4"

    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(in_path),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-crf", "23",
        "-preset", "veryfast",
    ]
    if fps is not None:
        cmd += ["-r", str(fps)]
    cmd += [str(out_path)]

    print("JOB CMD:", " ".join(cmd))
    background_tasks.add_task(run_convert_job, render_id, cmd)

    return {
        "status": "queued",
        "render_id": render_id,
        "detail_url": f"/renders/{render_id}",
        "download_mp4": f"/download/{render_id}/result.mp4",
    }