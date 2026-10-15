// SND resource decoder.
//
// Format recovered and validated against all 278 SND records in mario.prs (0 exceptions):
//   +0x00  u16  flag, constant 3 in every sample observed
//   +0x02  u16  data length in bytes (always exactly payload.length - 6)
//   +0x04  u16  sample rate in Hz (observed values: 11127, 11025, 8000, 22254, 22255)
//   +0x06  ...  raw 8-bit unsigned mono PCM, `length` bytes (silence = 0x80)

export function decodeSnd(payload) {
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const flag = dv.getUint16(0, true);
  const length = dv.getUint16(2, true);
  const rate = dv.getUint16(4, true);
  if (flag !== 3) throw new Error(`unexpected SND flag ${flag}`);
  if (length !== payload.length - 6) throw new Error(`SND length mismatch: header says ${length}, payload has ${payload.length - 6}`);
  const pcm = payload.subarray(6, 6 + length);
  return { sampleRate: rate, pcm };
}

// Decode straight into a Web Audio AudioBuffer (8-bit unsigned -> float32 -1..1).
export function sndToAudioBuffer(audioCtx, payload) {
  const { sampleRate, pcm } = decodeSnd(payload);
  const buf = audioCtx.createBuffer(1, pcm.length, sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = (pcm[i] - 128) / 128;
  return buf;
}

// Encode as a standalone WAV Blob, for tooling/debugging outside Web Audio.
export function sndToWavBlob(payload) {
  const { sampleRate, pcm } = decodeSnd(payload);
  const header = new ArrayBuffer(44);
  const dv = new DataView(header);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  dv.setUint32(4, 36 + pcm.length, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate, true); // byte rate (1 byte/sample * 1 channel)
  dv.setUint16(32, 1, true); // block align
  dv.setUint16(34, 8, true); // bits per sample
  writeStr(36, "data");
  dv.setUint32(40, pcm.length, true);
  // 8-bit WAV PCM is unsigned, matching the raw payload directly.
  return new Blob([header, pcm], { type: "audio/wav" });
}
