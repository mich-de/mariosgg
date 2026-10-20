// OPL2 (YM3812) style FM synthesizer + XMIDI sequencer, running inside an AudioWorklet.
// The original plays its XMIDI scores through the Miles AIL OPL driver with the timbres from
// MIDPAK.AD (14-byte two-operator patches). This is a compact re-implementation of the parts that
// matter: 9 two-op voices, OPL waveforms, KSL/TL attenuation, ADSR envelopes with OPL rate
// timing, feedback, FM/additive connection, tremolo/vibrato; AIL-like voice allocation.

const OPL_RATE = 49716;
const MULT = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 12, 12, 15, 15];
// attack time (ms, 0 -> max) for rate index (4*R + rof) / 4 ; decay time per 96 dB

function wave(w, ph) {
  // ph in [0,1)
  const s = Math.sin(2 * Math.PI * ph);
  switch (w) {
    case 1: return s > 0 ? s : 0;
    case 2: return Math.abs(s);
    case 3: return (ph % 0.5) < 0.25 ? Math.abs(s) : 0;
    default: return s;
  }
}

class Op {
  constructor() {
    this.ph = 0;
    this.env = 96; // attenuation in dB
    this.stage = 4; // 0 attack 1 decay 2 sustain 3 release 4 off
    this.out = 0;
    this.prev = 0;
  }
  set(p, avekm, ksltl, ardr, slrr, ws) {
    this.am = !!(avekm & 0x80);
    this.vib = !!(avekm & 0x40);
    this.egt = !!(avekm & 0x20);
    this.ksr = !!(avekm & 0x10);
    this.mult = MULT[avekm & 15];
    this.ksl = ksltl >> 6;
    this.tl = ksltl & 63;
    this.ar = ardr >> 4;
    this.dr = ardr & 15;
    this.sl = slrr >> 4;
    this.rr = slrr & 15;
    this.ws = ws & 3;
  }
}

function rateTimeMs(r, rof, attack) {
  if (r === 0) return Infinity;
  const idx = Math.min(63, 4 * r + rof);
  if (attack && idx >= 60) return 0;
  // OPL: time halves every rate step (4 index steps); calibrated on the Yamaha tables:
  // attack rate 1 (idx 4) ~ 2826 ms, decay rate 1 ~ 39280 ms (0 -> 96 dB)
  const base = attack ? 2826.24 : 39280.64;
  return base * Math.pow(2, -(idx - 4) / 4);
}

class Voice {
  constructor() {
    this.m = new Op();
    this.c = new Op();
    this.on = false;
    this.ch = -1;
    this.note = -1;
    this.age = 0;
    this.freq = 0;
    this.fb = 0;
    this.con = 0;
    this.block = 0;
    this.fnum = 0;
  }
}

class OplSynth extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = Array.from({ length: 9 }, () => new Voice());
    this.timbres = new Map(); // "bank:patch" -> bytes
    this.ch = Array.from({ length: 16 }, () => ({ prog: 0, bank: 0, vol: 100, expr: 127, bend: 0 }));
    this.events = null;
    this.pos = 0;
    this.waitSamples = 0;
    this.offs = []; // pending note offs {t, ch, note}
    this.time = 0; // in 120 Hz ticks (fractional)
    this.loop = false;
    this.playing = false;
    this.gain = 0.9;
    this.tremPh = 0;
    this.vibPh = 0;
    this.clock = 0;
    this.port.onmessage = (e) => this.msg(e.data);
  }
  msg(d) {
    if (d.type === "timbres") {
      for (const [k, v] of d.list) this.timbres.set(k, v);
    } else if (d.type === "play") {
      this.allOff(true);
      this.events = d.events;
      this.pos = 0;
      this.tick = 0;
      this.nextAt = 0;
      this.offs = [];
      this.loop = d.loop;
      this.playing = true;
      for (const c of this.ch) Object.assign(c, { prog: 0, bank: 0, vol: 100, expr: 127, bend: 0 });
    } else if (d.type === "stop") {
      this.playing = false;
      this.allOff(false);
    } else if (d.type === "volume") {
      this.gain = d.value;
    }
  }
  allOff(hard) {
    for (const v of this.voices) {
      v.on = false;
      for (const o of [v.m, v.c]) {
        o.stage = hard ? 4 : 3;
        if (hard) o.env = 96;
      }
    }
  }
  // ---------------------------------------------------------------- MIDI -> OPL (AIL-like)
  timbre(ch, note) {
    const c = this.ch[ch];
    if (ch === 9) return this.timbres.get("127:" + note) || null;
    return this.timbres.get(c.bank + ":" + c.prog) || this.timbres.get("0:" + c.prog) || null;
  }
  noteOn(ch, note, vel) {
    const t = this.timbre(ch, note);
    if (!t) return;
    // pick a free voice, else the oldest
    let v = this.voices.find((x) => !x.on && x.c.stage === 4) || this.voices.find((x) => !x.on);
    if (!v) v = this.voices.reduce((a, b) => (a.age < b.age ? a : b));
    v.on = true;
    v.ch = ch;
    v.note = note;
    v.vel = vel;
    v.age = this.clock++;
    v.transpose = (t[0] << 24) >> 24;
    v.m.set(0, t[1], t[2], t[3], t[4], t[5]);
    v.fb = (t[6] >> 1) & 7;
    v.con = t[6] & 1;
    v.c.set(0, t[7], t[8], t[9], t[10], t[11]);
    this.updateFreq(v);
    this.updateVol(v);
    for (const o of [v.m, v.c]) {
      o.stage = 0;
      o.ph = 0;
      o.prev = 0;
      o.out = 0;
    }
  }
  noteOff(ch, note) {
    for (const v of this.voices) {
      if (v.on && v.ch === ch && v.note === note) {
        v.on = false;
        v.m.stage = 3;
        v.c.stage = 3;
      }
    }
  }
  updateFreq(v) {
    const c = this.ch[v.ch];
    const n = (v.ch === 9 ? v.note : v.note + v.transpose) + (c.bend / 8192) * 2;
    v.freq = 440 * Math.pow(2, (n - 69) / 12);
    // OPL block/fnum for KSL/KSR
    let block = 0;
    let fnum = (v.freq * Math.pow(2, 20 - block)) / OPL_RATE;
    while (fnum > 1023 && block < 7) {
      block++;
      fnum = (v.freq * Math.pow(2, 20 - block)) / OPL_RATE;
    }
    v.block = block;
    v.fnum = Math.min(1023, fnum | 0);
    for (const o of [v.m, v.c]) {
      // key scaling: attenuation grows with pitch (KSL 1.5/3/6 dB per octave)
      const oct = block + (v.fnum >> 6) / 16;
      o.kslAtt = o.ksl ? Math.max(0, oct - 3) * [0, 3, 1.5, 6][o.ksl] : 0;
      o.rof = o.ksr ? block * 2 + ((v.fnum >> 9) & 1) : block >> 1;
    }
  }
  updateVol(v) {
    const c = this.ch[v.ch];
    const eff = (v.vel / 127) * (c.vol / 127) * (c.expr / 127);
    const att = eff > 0 ? -20 * Math.log10(eff) * 0.75 : 96; // AIL scales the carrier level
    v.c.volAtt = att;
    v.m.volAtt = v.con ? att : 0;
  }
  controller(ch, cc, val) {
    const c = this.ch[ch];
    if (cc === 7) c.vol = val;
    else if (cc === 11) c.expr = val;
    else if (cc === 114) c.bank = val; // XMIDI patch bank select
    else if (cc === 121) Object.assign(c, { vol: 100, expr: 127, bend: 0 });
    else if (cc === 123) for (const v of this.voices) if (v.ch === ch) this.noteOff(ch, v.note);
    if (cc === 7 || cc === 11) for (const v of this.voices) if (v.on && v.ch === ch) this.updateVol(v);
  }
  // ---------------------------------------------------------------- sequencer (120 Hz ticks)
  runSeq() {
    if (!this.playing || !this.events) return;
    const ev = this.events;
    // note-offs due
    for (let i = this.offs.length - 1; i >= 0; i--) {
      if (this.offs[i].t <= this.tick) {
        this.noteOff(this.offs[i].ch, this.offs[i].note);
        this.offs.splice(i, 1);
      }
    }
    while (this.pos < ev.length && ev[this.pos][0] <= this.tick) {
      const e = ev[this.pos++];
      const [, kind, ch, a, b, dur] = e;
      if (kind === 0x90) {
        if (b > 0) {
          this.noteOn(ch, a, b);
          this.offs.push({ t: this.tick + dur, ch, note: a });
        } else this.noteOff(ch, a);
      } else if (kind === 0x80) this.noteOff(ch, a);
      else if (kind === 0xb0) this.controller(ch, a, b);
      else if (kind === 0xc0) this.ch[ch].prog = a;
      else if (kind === 0xe0) {
        this.ch[ch].bend = ((b << 7) | a) - 8192;
        for (const v of this.voices) if (v.on && v.ch === ch) this.updateFreq(v);
      }
    }
    if (this.pos >= ev.length && !this.offs.length) {
      if (this.loop) {
        this.pos = 0;
        this.tick = -1;
      } else this.playing = false;
    }
  }
  // ---------------------------------------------------------------- envelope
  envStep(o, dtMs) {
    switch (o.stage) {
      case 0: {
        const t = rateTimeMs(o.ar, o.rof, true);
        if (t === 0) o.env = 0;
        else if (t === Infinity) return;
        else o.env -= (96 * dtMs) / t * (1 + o.env / 24); // exponential-ish attack curve
        if (o.env <= 0) {
          o.env = 0;
          o.stage = 1;
        }
        break;
      }
      case 1: {
        const sl = o.sl === 15 ? 93 : o.sl * 3;
        const t = rateTimeMs(o.dr, o.rof, false);
        if (t !== Infinity) o.env += (96 * dtMs) / t;
        if (o.env >= sl) {
          o.env = sl;
          o.stage = 2;
        }
        break;
      }
      case 2:
        if (!o.egt) {
          const t = rateTimeMs(o.rr, o.rof, false);
          if (t !== Infinity) o.env += (96 * dtMs) / t;
          if (o.env >= 96) o.stage = 4;
        }
        break;
      case 3: {
        const t = rateTimeMs(o.rr, o.rof, false);
        if (t !== Infinity) o.env += (96 * dtMs) / t;
        if (o.env >= 96) {
          o.env = 96;
          o.stage = 4;
        }
        break;
      }
    }
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const sr = sampleRate;
    const n = out.length;
    const dtMs = 1000 / sr;
    // advance the 120 Hz sequencer clock
    this.acc = (this.acc || 0) + n / sr;
    while (this.acc >= 1 / 120) {
      this.acc -= 1 / 120;
      this.runSeq();
      if (this.playing) this.tick++;
    }
    for (let i = 0; i < n; i++) {
      this.tremPh += 3.7 / sr;
      this.vibPh += 6.1 / sr;
      const trem = (1 - Math.cos(2 * Math.PI * this.tremPh)) * 0.5 * 1.0; // dB (shallow)
      const vib = Math.sin(2 * Math.PI * this.vibPh) * 0.0035;
      let s = 0;
      for (const v of this.voices) {
        if (v.c.stage === 4 && v.m.stage === 4) continue;
        const m = v.m, c = v.c;
        if (i % 8 === 0) {
          this.envStep(m, dtMs * 8);
          this.envStep(c, dtMs * 8);
        }
        const f = v.freq;
        const fm = f * m.mult * (m.vib ? 1 + vib : 1);
        const fc = f * c.mult * (c.vib ? 1 + vib : 1);
        m.ph = (m.ph + fm / sr) % 1;
        c.ph = (c.ph + fc / sr) % 1;
        // modulator with feedback
        const fbIn = v.fb ? ((m.prev + m.out) * 4) / Math.pow(2, 9 - v.fb) : 0;
        const mAtt = m.env + m.tl * 0.75 + (m.kslAtt || 0) + (m.volAtt || 0) + (m.am ? trem : 0);
        const mOut = mAtt >= 96 ? 0 : wave(m.ws, (m.ph + fbIn + 4) % 1) * Math.pow(10, -mAtt / 20);
        m.prev = m.out;
        m.out = mOut;
        const cAtt = c.env + c.tl * 0.75 + (c.kslAtt || 0) + (c.volAtt || 0) + (c.am ? trem : 0);
        let cOut;
        if (v.con === 0) cOut = cAtt >= 96 ? 0 : wave(c.ws, (c.ph + mOut * 4 + 8) % 1) * Math.pow(10, -cAtt / 20);
        else cOut = (cAtt >= 96 ? 0 : wave(c.ws, c.ph) * Math.pow(10, -cAtt / 20)) + mOut;
        s += cOut;
      }
      out[i] = Math.max(-1, Math.min(1, s * 0.16 * this.gain));
    }
    for (let k = 1; k < outputs[0].length; k++) outputs[0][k].set(out);
    return true;
  }
}

registerProcessor("opl-synth", OplSynth);
