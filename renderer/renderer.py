import argparse
import json
import subprocess
from pathlib import Path
from datetime import datetime
import platform

def make_render_id(preset: str) -> str:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe = "".join(c for c in preset if c.isalnum() or c in ("-", "_")).strip("_")
    return f"{ts}_{safe}"

def write_text(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")

def run_pymol(pymol_exe: str, pdb_path: Path, preset_path: Path, out_png: Path, run_pml: Path,
             width: int, height: int, dpi: int, draft: bool) -> None:
    """
    Runs PyMOL headless to load a PDB, apply a preset, render, and save PNG.
    draft=True => no ray (faster)
    """
    render_block = ""
    if draft:
        # Fast preview: no ray
        render_block = f"png {out_png.as_posix()}, dpi={dpi}\n"
    else:
        # High quality: ray + png
        render_block = f"ray {width}, {height}\n" \
                       f"png {out_png.as_posix()}, dpi={dpi}\n"

    pml = f"""
reinitialize
load {pdb_path.as_posix()}, mol
run {preset_path.as_posix()}

# center and zoom nicely
orient mol
zoom mol, buffer=2

# render
viewport {width}, {height}
{render_block}
quit
""".lstrip()

    write_text(run_pml, pml)

    cmd = [pymol_exe, "-cq", str(run_pml)]
    print("Running:", " ".join(cmd))

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print("PyMOL failed.")
        print("STDOUT:", result.stdout)
        print("STDERR:", result.stderr)
        raise SystemExit(result.returncode)

    if not out_png.exists():
        print("PyMOL ran but PNG was not created.")
        print("STDOUT:", result.stdout)
        print("STDERR:", result.stderr)
        raise SystemExit(1)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--render-id", default=None)
    parser.add_argument("--pymol", required=True, help="Path to pymol executable (or 'pymol' if in PATH)")
    parser.add_argument("--pdb", required=True, help="Path to input PDB file")
    parser.add_argument("--preset", default="clean_cartoon", help="Preset name (file in presets/ as .pml)")
    parser.add_argument("--width", type=int, default=1600)
    parser.add_argument("--height", type=int, default=1200)
    parser.add_argument("--dpi", type=int, default=300)
    parser.add_argument("--draft", action="store_true", help="Fast preview (no ray)")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    pdb_path = (root / args.pdb).resolve()
    preset_path = (root / "presets" / f"{args.preset}.pml").resolve()

    if not pdb_path.exists():
        raise SystemExit(f"PDB not found: {pdb_path}")
    if not preset_path.exists():
        raise SystemExit(f"Preset not found: {preset_path}")

    renders_dir = (root / "output" / "renders")
    renders_dir.mkdir(parents=True, exist_ok=True)

    render_id = make_render_id(args.preset)
    render_id = args.render_id or render_id  # use provided render_id if given (for testing)
    render_dir = (renders_dir / render_id)
    render_dir.mkdir(parents=True, exist_ok=True)

    out_png = render_dir / "result.png"
    run_pml = render_dir / "run.pml"
    meta_path = render_dir / "meta.json"

    # Run render
    run_pymol(args.pymol, pdb_path, preset_path, out_png, run_pml,
             args.width, args.height, args.dpi, args.draft)

    # Write meta.json
    meta = {
        "render_id": render_id,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "preset": args.preset,
        "pdb_input": str(Path(args.pdb)),
        "output_png": str(out_png.relative_to(root)),
        "run_pml": str(run_pml.relative_to(root)),
        "width": args.width,
        "height": args.height,
        "dpi": args.dpi,
        "draft": bool(args.draft),
        "system": {
            "platform": platform.platform(),
            "python": platform.python_version(),
        },
        "notes": ""  # later: user “what I learned”
    }
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print("Done")
    print("Render folder:", render_dir)
    print("PNG:", out_png)
    print("RENDER_ID:", render_id)

if __name__ == "__main__":
    main()
