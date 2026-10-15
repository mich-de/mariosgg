// Boot: load mario.prs (the original data file), start the engine, run the title sequence.

import { PRS } from "./engine/res.js";
import { Engine } from "./engine/engine.js";
import { Music } from "./engine/music.js";
import { startGame } from "./scenes/flow.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ": HTTP " + res.status);
  const total = +res.headers.get("content-length") || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) onProgress(got / total);
  }
  return new Blob(chunks);
}

async function loadPrs() {
  const blob = await fetchWithProgress("data/mario.prs.gz", (f) => ($("bar").firstElementChild.style.width = (f * 100).toFixed(0) + "%"));
  // GitHub Pages may or may not have already gunzipped it on the wire; sniff the magic.
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const ds = blob.stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(ds).arrayBuffer();
  }
  return await blob.arrayBuffer();
}

async function boot() {
  let buf;
  try {
    buf = await loadPrs();
  } catch (err) {
    $("status").textContent = "Could not load the game data: " + err.message;
    return;
  }
  const prs = new PRS(buf);
  const engine = new Engine($("screen"), prs);
  engine.audio.music = new Music(engine.audio, prs);
  if (params.has("debug")) {
    window.__mgg = engine;
    if (params.has("speed")) engine.setSpeed(Math.max(1, +params.get("speed") || 1));
  }

  const isTouch = matchMedia("(pointer: coarse)").matches;
  $("rotate").classList.toggle("show", isTouch);
  const fsBtn = $("fs");
  const canFs = document.fullscreenEnabled && isTouch;
  const enterFs = async () => {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock("landscape").catch(() => {});
    } catch (e) {}
  };
  // the button only shows while not fullscreen, and fades so it does not hide the corner
  let fadeT = 0;
  const syncFs = () => {
    fsBtn.style.display = canFs && !document.fullscreenElement ? "block" : "none";
    fsBtn.classList.remove("faded");
    clearTimeout(fadeT);
    fadeT = setTimeout(() => fsBtn.classList.add("faded"), 4000);
  };
  document.addEventListener("fullscreenchange", syncFs);
  fsBtn.addEventListener("click", enterFs);

  $("status").textContent = "Ready.";
  const start = $("start");
  const go = () => {
    engine.audio.unlock();
    if (canFs && !params.has("autostart")) enterFs();
    syncFs();
    $("loading").style.display = "none";
    startGame(engine, params.get("scene"));
  };
  if (params.has("autostart")) go();
  else {
    start.style.display = "block";
    start.addEventListener("click", go, { once: true });
  }
}

boot();
