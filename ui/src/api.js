const API_BASE = "http://127.0.0.1:8000";

async function postMultipart(path, formData) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(JSON.stringify(data, null, 2));
  }
  return data;
}

export async function renderPng({ file, preset, draft, width, height, dpi, pymol }) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("preset", preset);
  fd.append("draft", String(draft));
  fd.append("width", String(width));
  fd.append("height", String(height));
  fd.append("dpi", String(dpi));
  fd.append("pymol", pymol);
  return postMultipart("/render/png", fd);
}
export async function getRenderMeta(renderId) {
  const res = await fetch(`${API_BASE}/renders/${renderId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data, null, 2));
  return data;
}

export async function renderSpin({ file, preset, quality, frames, fps, width, height, pymol }) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("preset", preset);
  fd.append("quality", quality);
  if (frames != null) fd.append("frames", String(frames));
  if (fps != null) fd.append("fps", String(fps));
  if (width != null) fd.append("width", String(width));
  if (height != null) fd.append("height", String(height));
  fd.append("pymol", pymol);
  return postMultipart("/render/spin", fd);
}

export async function renderTimeline({ file, frames, preset, quality, width, height, fps, pymol }) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("frames_json", JSON.stringify(frames));
  fd.append("preset", preset);
  fd.append("quality", quality);
  if (width != null) fd.append("width", String(width));
  if (height != null) fd.append("height", String(height));
  if (fps != null) fd.append("fps", String(fps));
  fd.append("pymol", pymol);
  return postMultipart("/render/timeline", fd);
}

export { API_BASE };
