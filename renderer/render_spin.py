import argparse
import json
import subprocess
from pathlib import Path
from datetime import datetime
import platform

def count_atoms_in_pdb(pdb_path: Path) -> int:
    # quick PDB atom count (ATOM/HETATM lines)
    n = 0
    with pdb_path.open("r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            if line.startswith("ATOM") or line.startswith("HETATM"):
                n += 1
    return n

def make_render_id(preset: str) -> str:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe = "".join(c for c in preset if c.isalnum() or c in ("-", "_")).strip("_")
    return f"{ts}_{safe}_spin"

def quality_defaults(quality: str):
    # defaults tuned for speed
    if quality == "draft":
        return dict(width=960, height=540, frames=60, fps=24, antialias=0, ray_trace_frames=0)
    if quality == "standard":
        return dict(width=1280, height=720, frames=90, fps=30, antialias=1, ray_trace_frames=0)
    # final
    return dict(width=1920, height=1080, frames=180, fps=30, antialias=2, ray_trace_frames=1)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--render-id", default=None)
    p.add_argument("--pymol", required=True)
    p.add_argument("--pdb", required=True)
    p.add_argument("--preset", default="clean_cartoon")
    p.add_argument("--quality", choices=["draft", "standard", "final"], default="draft")
    p.add_argument("--frames", type=int, default=None)
    p.add_argument("--fps", type=int, default=None)
    p.add_argument("--width", type=int, default=None)
    p.add_argument("--height", type=int, default=None)
    args = p.parse_args()

    root = Path(__file__).resolve().parents[1]
    pdb_path = (root / args.pdb).resolve()
    preset_path = (root / "presets" / f"{args.preset}.pml").resolve()
    if not pdb_path.exists():
        raise SystemExit(f"PDB not found: {pdb_path}")
    if not preset_path.exists():
        raise SystemExit(f"Preset not found: {preset_path}")

    atom_count = count_atoms_in_pdb(pdb_path)

    # base params from quality
    q = quality_defaults(args.quality)

    # user overrides (optional)
    if args.width: q["width"] = args.width
    if args.height: q["height"] = args.height
    if args.frames: q["frames"] = args.frames
    if args.fps: q["fps"] = args.fps

    # auto-downshift for huge structures (prevents “6-hour accidents”)
    # tune thresholds as you like
    auto_note = ""
    if atom_count >= 200_000:
        # force draft-like settings even if user asked for more
        q.update(dict(width=960, height=540, frames=min(q["frames"], 60), fps=24, antialias=0, ray_trace_frames=0))
        auto_note = "Auto-downshift applied (>=200k atoms)."
    elif atom_count >= 100_000:
        q.update(dict(frames=min(q["frames"], 90), ray_trace_frames=0))
        auto_note = "Auto-downshift applied (>=100k atoms)."

    renders_dir = (root / "output" / "renders")
    renders_dir.mkdir(parents=True, exist_ok=True)

    render_id = make_render_id(args.preset)
    render_id = args.render_id or render_id  # use provided render_id if given (for testing)
    render_dir = renders_dir / render_id
    render_dir.mkdir(parents=True, exist_ok=True)

    frames_dir = render_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    out_mp4 = render_dir / "result.mp4"
    run_pml = render_dir / "run.pml"
    meta_path = render_dir / "meta.json"

    # PyMOL: generate frame PNGs using OpenGL (ray_trace_frames=0 is key for speed)
    pml = f"""
reinitialize
load {pdb_path.as_posix()}, mol
run {preset_path.as_posix()}

# speed-oriented render settings
set antialias, {q["antialias"]}
set ray_opaque_background, off
set cache_frames, 0
set ray_trace_frames, {q["ray_trace_frames"]}
set specular, 0
set shininess, 5
set depth_cue, 0

orient mol
zoom mol, buffer=2
viewport {q["width"]}, {q["height"]}

mset 1 x{q["frames"]}
util.mroll 1,{q["frames"]},360

mpng {frames_dir.as_posix()}/frame
quit
""".lstrip()

    run_pml.write_text(pml, encoding="utf-8")

    print(f"[INFO] atoms={atom_count}, quality={args.quality}, params={q}")
    if auto_note:
        print("[INFO]", auto_note)

    r = subprocess.run([args.pymol, "-cq", str(run_pml)], capture_output=True, text=True)
    if r.returncode != 0:
        print("PyMOL failed")
        print("STDOUT:", r.stdout)
        print("STDERR:", r.stderr)
        raise SystemExit(r.returncode)

    ff = subprocess.run([
        "ffmpeg", "-y",
        "-framerate", str(q["fps"]),
        "-i", str(frames_dir / "frame%04d.png"),
        "-pix_fmt", "yuv420p",
        str(out_mp4)
    ], capture_output=True, text=True)

    if ff.returncode != 0:
        print("ffmpeg failed")
        print("STDOUT:", ff.stdout)
        print("STDERR:", ff.stderr)
        raise SystemExit(ff.returncode)

    meta = {
        "render_id": render_id,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "type": "spin_mp4",
        "preset": args.preset,
        "quality": args.quality,
        "pdb_input": str(Path(args.pdb)),
        "atom_count": atom_count,
        "auto_note": auto_note,
        "output_mp4": str(out_mp4.relative_to(root)),
        "frames_dir": str(frames_dir.relative_to(root)),
        "run_pml": str(run_pml.relative_to(root)),
        "width": q["width"],
        "height": q["height"],
        "frames": q["frames"],
        "fps": q["fps"],
        "ray_trace_frames": q["ray_trace_frames"],
        "system": {
            "platform": platform.platform(),
            "python": platform.python_version(),
        },
        "notes": ""
    }
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print("Done:", out_mp4)

if __name__ == "__main__":
    main()
