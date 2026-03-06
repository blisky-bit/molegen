import { useEffect, useRef } from "react";

/**
 * 3Dmol.js Viewer
 * - pdbText: string (PDB 파일 내용)
 * - frame: 현재 프레임 객체 (opacity, position, dispersion, bias 등)
 * - onReady?: (viewer, canvas) => void  // App에서 캔버스 캡처/녹화용
 */
export default function MoleculeViewer({ pdbText, frame, onReady }) {
  const hostRef = useRef(null);
  const viewerRef = useRef(null);
  const modelRef = useRef(null);
  const caAtomsRef = useRef([]);        // CA atoms cache
  const bboxAtomsRef = useRef([]);      // center/radius 계산용 atoms
  const didZoomRef = useRef(false);
  const $3DmolRef = useRef(null);

  // init viewer once
  useEffect(() => {
    if (!hostRef.current) return;

    let alive = true;

    (async () => {
      let $3Dmol = window.$3Dmol;
      if (!$3Dmol) {
        await import("3dmol/build/3Dmol-min.js");
        $3Dmol = window.$3Dmol;
      }
      if (!alive || !$3Dmol) return;

      $3DmolRef.current = $3Dmol;

      const viewer = $3Dmol.createViewer(hostRef.current, {
        backgroundColor: "white",
      });
      viewerRef.current = viewer;

      // 캔버스 노출 (MediaRecorder용)
      const canvas = hostRef.current.querySelector("canvas");
      if (onReady && canvas) onReady(viewer, canvas);

      viewer.render();
    })();

    return () => {
      alive = false;
      viewerRef.current = null;
      modelRef.current = null;
      caAtomsRef.current = [];
      bboxAtomsRef.current = [];
      didZoomRef.current = false;
    };
  }, [onReady]);

  // load pdb model when pdbText changes
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.clear();
    modelRef.current = null;
    caAtomsRef.current = [];
    bboxAtomsRef.current = [];
    didZoomRef.current = false;

    if (!pdbText) {
      viewer.render();
      return;
    }

    const model = viewer.addModel(pdbText, "pdb");
    modelRef.current = model;

    // CA atoms cache
    const ca = model.selectedAtoms({ atom: "CA" });
    caAtomsRef.current = ca;

    // bbox atoms (CA가 있으면 CA로, 없으면 전체)
    bboxAtomsRef.current = ca.length ? ca : model.selectedAtoms({});

    // 기본 스타일 1회 (dispersion=0일 때 cartoon)
    model.setStyle({}, { cartoon: { color: "spectrum", opacity: 1.0 } });

    viewer.zoomTo();
    didZoomRef.current = true;
    viewer.render();
  }, [pdbText]);

  // apply frame params (live)
  useEffect(() => {
    const viewer = viewerRef.current;
    const model = modelRef.current;
    if (!viewer || !model || !pdbText || !frame) return;

    // ---- normalize inputs ----
    const opacity = Math.max(0, Math.min(100, frame.opacity ?? 100)) / 100;
    const dispersion = Math.max(0, Math.min(100, frame.dispersion ?? 0));
    const position = frame.position || "outside";
    const bias = frame.bias || "none";

    const atomsForBBox = bboxAtomsRef.current;
    if (!atomsForBBox.length) return;

    // ---- compute center + radius ----
    let cx = 0, cy = 0, cz = 0;
    for (const a of atomsForBBox) { cx += a.x; cy += a.y; cz += a.z; }
    cx /= atomsForBBox.length;
    cy /= atomsForBBox.length;
    cz /= atomsForBBox.length;

    let r = 1;
    for (const a of atomsForBBox) {
      const dx = a.x - cx, dy = a.y - cy, dz = a.z - cz;
      const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (d > r) r = d;
    }

    // ---- baseScale by position ----
    let baseScale = 1.0;
    if (position === "center") baseScale = 0.25;
    if (position === "near") baseScale = 0.95;
    if (position === "outside") baseScale = 1.25;

    // ---- biasScale ----
    let biasScale = 1.0;
    if (bias === "toward") biasScale = 0.85;
    if (bias === "away") biasScale = 1.15;

    // ---- reset shapes + styles ----
    viewer.removeAllShapes();
    model.setStyle({}, {}); // reset

    // =========================================================
    // MODE A) dispersion == 0 -> CARTOON (원래 단백질)
    // =========================================================
    if (dispersion === 0) {
      model.setStyle({}, { cartoon: { color: "spectrum", opacity } });

      // highlight (cartoon 모드에서만)
      const ht = frame.highlight?.type || "none";
      const hq = (frame.highlight?.query || "").trim();
      if (ht !== "none" && hq) {
        let sel = {};
        if (hq.includes("-")) {
          const [a, b] = hq.split("-").map((x) => parseInt(x.trim(), 10));
          if (!Number.isNaN(a) && !Number.isNaN(b) && b >= a) {
            sel = { resi: Array.from({ length: b - a + 1 }, (_, i) => a + i) };
          }
        } else if (hq.includes(",")) {
          const arr = hq.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n));
          sel = { resi: arr };
        } else {
          const n = parseInt(hq, 10);
          if (!Number.isNaN(n)) sel = { resi: [n] };
        }
        model.setStyle(sel, { stick: { radius: 0.2, color: "yellow", opacity } });
      }

      viewer.render();
      return;
    }

    // =========================================================
    // MODE B) dispersion > 0 -> POINT CLOUD (원래 atoms 좌표 기반)
    // =========================================================
    // CA 기반으로 “원래 좌표를 스케일해서 이동” → 프레임마다 계속 달라짐
    const t = dispersion / 100;
    const spreadScale = baseScale * biasScale * (1 + t * 2.0);

    const spheres = caAtomsRef.current.length ? caAtomsRef.current : model.selectedAtoms({});
    const maxSpheres = 2500;
    const step = Math.ceil(spheres.length / maxSpheres);

    for (let i = 0; i < spheres.length; i += step) {
      const a = spheres[i];
      const dx = a.x - cx, dy = a.y - cy, dz = a.z - cz;

      const x = cx + dx * spreadScale;
      const y = cy + dy * spreadScale;
      const z = cz + dz * spreadScale;

      viewer.addSphere({
        center: { x, y, z },
        radius: 0.6,
        color: "#4f46e5",
        opacity,
      });
    }

    // 카메라 흔들리지 않게: zoomTo() 매 프레임 금지
    // 단, 처음 로드 때는 이미 zoomTo 했음(didZoomRef)
    if (!didZoomRef.current) {
      viewer.zoomTo();
      didZoomRef.current = true;
    }

    viewer.render();
  }, [frame, pdbText]);

  return (
    <div
      ref={hostRef}
      style={{
        width: "100%",
        height: 420,
        border: "1px solid #ddd",
        borderRadius: 10,
        overflow: "hidden",
      }}
    />
  );
}
