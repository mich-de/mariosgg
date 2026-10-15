// Digital sound: the original drives one Sound Blaster DMA channel, so a new sample replaces
// whatever is playing (sound module 36bf). Music (XMIDI through an OPL2 synth) lives in music.js.

import { decodeSnd } from "./res.js";

export class Audio {
  constructor(prs) {
    this.prs = prs;
    this.ctx = null;
    this.buffers = new Map();
    this.cur = null;
    this.soundOn = true;
    this.musicOn = true;
    this.sfxGain = null;
    this.music = null; // set by main once music.js is loaded
    this.rate = 1; // test speed-up
  }
  // Must run inside a user gesture (browsers keep audio suspended until then).
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.9;
      this.sfxGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }
  buffer(id) {
    let b = this.buffers.get(id);
    if (b) return b;
    const r = this.prs.get("SND", id);
    if (!r || !this.ctx) return null;
    const { rate, pcm } = decodeSnd(r.payload);
    b = this.ctx.createBuffer(1, Math.max(1, pcm.length), rate);
    const ch = b.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = (pcm[i] - 128) / 128;
    this.buffers.set(id, b);
    return b;
  }
  duration(id) {
    const r = this.prs.get("SND", id);
    if (!r) return 0;
    const { rate, pcm } = decodeSnd(r.payload);
    return pcm.length / rate;
  }
  playSnd(id, loop = false) {
    this.stopSnd();
    if (!this.soundOn || !this.ctx) return Promise.resolve();
    const b = this.buffer(id);
    if (!b) return Promise.resolve();
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.loop = loop;
    if (this.rate !== 1) src.playbackRate.value = this.rate;
    src.connect(this.sfxGain);
    const cur = { src, done: false };
    cur.promise = new Promise((res) => {
      src.onended = () => {
        cur.done = true;
        res();
      };
    });
    src.start();
    this.cur = cur;
    return cur.promise;
  }
  stopSnd() {
    if (this.cur && !this.cur.done) {
      try {
        this.cur.src.stop();
      } catch (e) {}
    }
    this.cur = null;
  }
  playing() {
    return !!(this.cur && !this.cur.done);
  }
  setSound(on) {
    this.soundOn = on;
    if (!on) this.stopSnd();
  }
  setMusic(on) {
    this.musicOn = on;
    if (this.music) this.music.setEnabled(on);
  }
  playMusic(id, loop = true) {
    if (this.music) this.music.play(id, loop && true);
  }
  stopMusic() {
    if (this.music) this.music.stop();
  }
  musicPlaying() {
    return !!(this.music && this.music.playing());
  }
}
