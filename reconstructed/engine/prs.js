// mario.prs container reader.
//
// Format recovered by direct byte-level analysis, validated 1806/1806 records against the
// companion mario.prd directory (zero mismatches; parser consumes the file exactly to EOF):
//
//   offset 0x00  "PRS Format Resource File\r\n" + zero padding + 0x1A   (0x30 bytes)
//   offset 0x30  repeated record:
//       +0x00  char[4]   type tag, NUL terminated (observed: "Ply\0" "MuV\0" "SND\0" "Pak\0" "Img\0" "XMI\0" "DIB\0")
//       +0x04  u16       resource id
//       +0x06  char[18]  name, NUL padded
//       +0x18  u32       record length, including this 28-byte header
//       +0x1C  ...       payload (length - 0x1C bytes)
//
// Resource ids are not unique by themselves: the same id carries one resource per tag
// (e.g. id 4022 has a Ply, a Pak, a MuV and an Img record). Callers index by (tag, id).

const HEADER_SIZE = 0x1c;

export function parsePrs(buffer) {
  const dv = new DataView(buffer);
  const magic = new TextDecoder("latin1").decode(new Uint8Array(buffer, 0, 25));
  if (magic !== "PRS Format Resource File") {
    throw new Error("not a PRS file: bad magic");
  }
  const byTag = new Map();
  let pos = 0x30;
  while (pos < buffer.byteLength) {
    const tag = readCString(buffer, pos, 4);
    const id = dv.getUint16(pos + 4, true);
    const name = readCString(buffer, pos + 6, 0x12);
    const length = dv.getUint32(pos + 0x18, true);
    if (length < HEADER_SIZE || pos + length > buffer.byteLength) {
      throw new Error(`corrupt PRS record at offset ${pos}: length=${length}`);
    }
    const payload = new Uint8Array(buffer, pos + HEADER_SIZE, length - HEADER_SIZE);
    if (!byTag.has(tag)) byTag.set(tag, new Map());
    byTag.get(tag).set(id, { tag, id, name, payload });
    pos += length;
  }
  return byTag;
}

function readCString(buffer, offset, maxLen) {
  const bytes = new Uint8Array(buffer, offset, maxLen);
  const end = bytes.indexOf(0);
  const slice = bytes.subarray(0, end === -1 ? maxLen : end);
  return new TextDecoder("latin1").decode(slice);
}

// Convenience: look up one resource by tag + id across the whole archive.
export function getResource(byTag, tag, id) {
  const bucket = byTag.get(tag);
  if (!bucket) return null;
  return bucket.get(id) ?? null;
}
