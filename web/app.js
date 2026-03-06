const API = "http://127.0.0.1:8000";

const log = (msg) => {
  document.getElementById("log").textContent = msg;
};

async function postForm(path, formData) {
  const res = await fetch(`${API}${path}`, { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(JSON.stringify(data, null, 2));
  }
  return data;
}

async function getJSON(path) {
  const res = await fetch(`${API}${path}`);
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data, null, 2));
  return data;
}

// render_id status 폴링
async function waitDone(render_id, intervalMs = 1500) {
  while (true) {
    const meta = await getJSON(`/renders/${render_id}`);
    log(`status: ${meta.status}\nrender_id: ${render_id}`);
    if (meta.status === "done") return meta;
    if (meta.status === "failed") throw new Error("Render failed. Check meta.json / logs.");
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

function fileOrThrow() {
  const f = document.getElementById("file").files[0];
  if (!f) throw new Error("Select a .pdb file first.");
  return f;
}

document.getElementById("btnPng").onclick = async () => {
  try {
    const f = fileOrThrow();
    const preset = document.getElementById("preset").value;

    const fd = new FormData();
    fd.append("file", f);
    fd.append("preset", preset);
    fd.append("draft", "true");
    fd.append("width", "900");
    fd.append("height", "700");
    fd.append("dpi", "150");

    log("uploading…");
    const r = await postForm("/render/png", fd);

    log(`queued\nrender_id: ${r.render_id}`);
    await waitDone(r.render_id);

    const url = `${API}${r.download_png}`;
    log(`DONE ✅\nPNG: ${url}\n(open link in browser)`);
    window.open(url, "_blank");
  } catch (e) {
    log(`ERROR\n${e.message}`);
  }
};

document.getElementById("btnSpin").onclick = async () => {
  try {
    const f = fileOrThrow();
    const preset = document.getElementById("preset").value;

    const fd = new FormData();
    fd.append("file", f);
    fd.append("preset", preset);
    fd.append("quality", "draft");
    fd.append("frames", "60");
    fd.append("fps", "24");
    fd.append("width", "900");
    fd.append("height", "700");

    log("uploading…");
    const r = await postForm("/render/spin", fd);

    log(`queued\nrender_id: ${r.render_id}`);
    await waitDone(r.render_id);

    const url = `${API}${r.download_mp4}`;
    log(`DONE ✅\nMP4: ${url}\n(open link in browser)`);
    window.open(url, "_blank");
  } catch (e) {
    log(`ERROR\n${e.message}`);
  }
};
