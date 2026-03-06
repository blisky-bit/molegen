import json
from pathlib import Path

def as_int(v):
    try:
        return int(v)
    except Exception:
        return 0

def main():
    root = Path(__file__).resolve().parents[1]
    renders_dir = root / "output" / "renders"
    metas = []

    for meta_path in renders_dir.glob("*/meta.json"):
        try:
            data = json.loads(meta_path.read_text(encoding="utf-8"))
            data["_meta_path"] = str(meta_path.relative_to(root))
            metas.append(data)
        except Exception:
            continue

    metas.sort(key=lambda x: as_int(x.get("created_at", 0)), reverse=True)

    index_path = root / "output" / "index.json"
    index_path.write_text(json.dumps(metas, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Wrote:", index_path)

if __name__ == "__main__":
    main()
