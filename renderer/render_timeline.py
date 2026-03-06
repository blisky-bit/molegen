import argparse, json, math, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output"
RENDERS = OUTPUT / "renders"

def quality_defaults(q: str):
    q = (q or "draft").lower()
    if q == "final":
        return dict(width=1600, height=1200, dpi=300, fps=30)
    if q == "standard":
        return dict(width=1200, height=900, dpi=200, fps=30)
    return dict(width=900, height=700, dpi=150, fps=24)

def write_pml(pml_path: Path, pdb_rel: str, preset_name: str, frame, out_png: Path, w: int, h: int, dpi: int):
    # 현재 MVP: 프레임 파라미터 중 D(highlight) / B(opacity 일부)만 반영 (확장 가능)
    # highlight query 예: resi 45-60, ligand name 등
    highlight = frame.get("highlight", {}) or {}
    htype = highlight.get("type", "none")
    hq = (highlight.get("query", "") or "").strip()

    # opacity(전체적인 느낌만): cartoon transparency로 근사
    opacity = float(frame.get("opacity", 100))
    transparency = max(0.0, min(1.0, 1.0 - opacity / 100.0))

    lines = []
    lines.append("reinitialize")
    lines.append(f"load {pdb_rel.replace('\\', '/')}, mol")
    lines.append(f"run {str((ROOT/'presets'/f'{preset_name}.pml').as_posix())}")
    lines.append("hide everything, mol")
    lines.append("show cartoon, mol")
    lines.append(f"set cartoon_transparency, {transparency:.3f}, mol")

    # 간단 하이라이트
    if htype != "none" and hq:
        # selection name: hl
        lines.append(f"select hl, ({hq})")
        lines.append("show sticks, hl")
        lines.append("color yellow, hl")
    elif htype == "pocket" and hq:
        # pocket도 일단 query로 처리 (나중에 자동 pocket 탐지)
        lines.append(f"select pocket, ({hq})")
        lines.append("show surface, pocket")
        lines.append("color cyan, pocket")

    lines.append("orient mol")
    lines.append("zoom mol, buffer=2")
    lines.append(f"viewport {w}, {h}")
    lines.append(f"ray {w}, {h}")
    lines.append(f"png {out_png.as_posix()}, dpi={dpi}")
    lines.append("quit")

    pml_path.write_text("\n".join(lines), encoding="utf-8")

def run_pymol(pymol: str, pml_path: Path):
    cmd = [pymol, "-cq", str(pml_path)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r

def make_mp4(frames_dir: Path, fps: int, out_mp4: Path):
    # frame0001.png 같은 시퀀스를 mp4로
    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(fps),
        "-i", str(frames_dir / "frame%04d.png"),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        str(out_mp4),
    ]
    return subprocess.run(cmd, capture_output=True, text=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--render-id", required=True)
    ap.add_argument("--pymol", default="pymol")
    ap.add_argument("--pdb", required=True)            # relative to ROOT or absolute
    ap.add_argument("--preset", default="clean_cartoon")
    ap.add_argument("--quality", default="draft")
    ap.add_argument("--frames-json", required=True)    # relative to ROOT
    ap.add_argument("--width", type=int, default=None)
    ap.add_argument("--height", type=int, default=None)
    ap.add_argument("--fps", type=int, default=None)
    args = ap.parse_args()

    defaults = quality_defaults(args.quality)
    w = args.width or defaults["width"]
    h = args.height or defaults["height"]
    dpi = defaults["dpi"]
    fps = args.fps or defaults["fps"]

    render_dir = RENDERS / args.render_id
    frames_dir = render_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    pdb_rel = args.pdb
    frames = json.loads((ROOT / args.frames_json).read_text(encoding="utf-8"))

    # 각 frame을 “duration” 만큼 반복 프레임으로 펼치기
    # 예: duration=1.5s, fps=24 -> 36장
    seq = []
    for fr in frames:
        dur = float(fr.get("duration", 1.0))
        count = max(1, int(round(dur * fps)))
        seq += [fr] * count

    # 렌더
    for i, fr in enumerate(seq, start=1):
        out_png = frames_dir / f"frame{i:04d}.png"
        pml_path = frames_dir / f"frame{i:04d}.pml"
        write_pml(pml_path, pdb_rel, args.preset, fr, out_png, w, h, dpi)

        r = run_pymol(args.pymol, pml_path)
        if r.returncode != 0:
            print("PyMOL failed:", r.stdout[-2000:], r.stderr[-2000:])
            return 1

    out_mp4 = render_dir / "result.mp4"
    r = make_mp4(frames_dir, fps, out_mp4)
    if r.returncode != 0:
        print("FFmpeg failed:", r.stdout[-2000:], r.stderr[-2000:])
        return 1

    print("Done")
    print("RENDER_ID:", args.render_id)
    print("MP4:", out_mp4)
    return 0

if __name__ == "__main__":
    sys.exit(main())
