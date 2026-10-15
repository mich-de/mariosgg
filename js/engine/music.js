// XMIDI music (resources XMI 130..150 in mario.prs) played through an OPL2-style FM synth with
// the game's own Global Timbre Library (MIDPAK.AD), like the original Miles AIL OPL driver.

export class Music {
  constructor(audio, prs) {
    this.audio = audio;
    this.prs = prs;
    this.enabled = audio.musicOn;
    this.current = null;
    this.node = null;
    this.ready = null;
    this.timbres = null;
  }
  async init() {
    const ctx = this.audio.ctx;
    if (!ctx || !ctx.audioWorklet) return false;
    if (!this.ready) {
      this.ready = (async () => {
        await ctx.audioWorklet.addModule(new URL("./opl-worklet.js", import.meta.url));
        const buf = await (await fetch("data/midpak.ad")).arrayBuffer();
        this.timbres = parseGTL(new Uint8Array(buf));
        this.node = new AudioWorkletNode(ctx, "opl-synth", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
        this.node.connect(ctx.destination);
        this.node.port.postMessage({ type: "timbres", list: this.timbres });
        return true;
      })().catch((e) => {
        console.warn("music disabled:", e);
        return false;
      });
    }
    return this.ready;
  }
  setEnabled(on) {
    this.enabled = on;
    if (!on) this.stop(true);
    else if (this.current) this.play(this.current.id, this.current.loop);
  }
  async play(id, loop = true) {
    this.current = { id, loop };
    this.endsAt = 0;
    if (!this.enabled) return;
    const ok = await this.init();
    if (!ok || !this.current || this.current.id !== id) return;
    const r = this.prs.get("XMI", id);
    if (!r) return;
    const events = parseXMI(r.payload);
    this.node.port.postMessage({ type: "play", events, loop });
    const secs = events.length ? events[events.length - 1][0] / 120 : 0;
    this.endsAt = loop ? Infinity : this.audio.ctx.currentTime + secs / (this.audio.rate || 1);
  }
  // Still sounding? (AIL's "sequence status", polled by the win sequences)
  playing() {
    return !!(this.enabled && this.current && this.audio.ctx && this.audio.ctx.currentTime < this.endsAt);
  }
  stop(keep = false) {
    if (!keep) this.current = null;
    this.endsAt = 0;
    if (this.node) this.node.port.postMessage({ type: "stop" });
  }
}

// MIDPAK.AD / AIL GTL: entries {u8 patch, u8 bank, u32 offset} until 0xFF 0xFF; each timbre is
// u16 length (14), i8 transpose, then 11 OPL2 register bytes.
function parseGTL(d) {
  const out = [];
  for (let i = 0; d[i] !== 0xff || d[i + 1] !== 0xff; i += 6) {
    const patch = d[i], bank = d[i + 1];
    const off = d[i + 2] | (d[i + 3] << 8) | (d[i + 4] << 16) | (d[i + 5] << 24);
    const len = d[off] | (d[off + 1] << 8);
    out.push([bank + ":" + patch, Array.from(d.subarray(off + 2, off + len))]);
  }
  return out;
}

// XMIDI: IFF FORM XDIR / CAT XMID / FORM XMID { TIMB, EVNT }. In EVNT, bytes < 0x80 are delays
// (120 Hz ticks, summed), note-ons carry their duration as a variable-length number.
function parseXMI(p) {
  const s4 = (o) => String.fromCharCode(p[o], p[o + 1], p[o + 2], p[o + 3]);
  const be = (o) => (p[o] << 24) | (p[o + 1] << 16) | (p[o + 2] << 8) | p[o + 3];
  let evnt = null;
  const walk = (o, end) => {
    while (o + 8 <= end && !evnt) {
      const id = s4(o), len = be(o + 4);
      if (id === "FORM" || id === "CAT ") walk(o + 12, o + 8 + len);
      else if (id === "EVNT") evnt = [o + 8, o + 8 + len];
      o += 8 + len + (len & 1);
    }
  };
  walk(0, p.length);
  const ev = [];
  if (!evnt) return ev;
  let [pos, end] = evnt;
  let tick = 0;
  const vlq = () => {
    let v = 0, b;
    do {
      b = p[pos++];
      v = (v << 7) | (b & 0x7f);
    } while (b & 0x80);
    return v;
  };
  while (pos < end) {
    const b = p[pos];
    if (b < 0x80) {
      tick += b;
      pos++;
      continue;
    }
    pos++;
    const type = b & 0xf0, ch = b & 15;
    // songs carry an extended-level arrangement on MIDI channels 1-10 (10 = drums) and a copy for
    // base-level synths on 13-16; the OPL driver plays the former, so the copy is skipped below.
    if (b === 0xff) {
      const meta = p[pos++];
      const len = vlq();
      pos += len;
      if (meta === 0x2f) break;
      continue;
    }
    if (b === 0xf0 || b === 0xf7) {
      pos += vlq();
      continue;
    }
    const keep = ch < 10;
    if (type === 0x90) {
      const note = p[pos++], vel = p[pos++];
      const dur = vlq();
      if (keep) ev.push([tick, 0x90, ch, note, vel, dur]);
    } else if (type === 0x80 || type === 0xa0 || type === 0xb0 || type === 0xe0) {
      const a = p[pos++], c = p[pos++];
      if (keep) ev.push([tick, type, ch, a, c, 0]);
    } else if (type === 0xc0 || type === 0xd0) {
      const a = p[pos++];
      if (keep) ev.push([tick, type, ch, a, 0, 0]);
    }
  }
  ev.push([tick + 1, 0, 0, 0, 0, 0]);
  return ev;
}
