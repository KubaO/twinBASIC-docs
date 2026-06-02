const MAGIC = 0xEA0BA51C;

function parseTwinpack(buffer) {
  const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const decoder = new TextDecoder('utf-8');
  let pos = 0;
  let entryCount = 0;

  function readU32() { const v = view.getUint32(pos, true); pos += 4; return v; }
  function readU16() { const v = view.getUint16(pos, true); pos += 2; return v; }
  function readI16() { const v = view.getInt16(pos, true); pos += 2; return v; }
  function readU8()  { const v = view.getUint8(pos); pos += 1; return v; }
  function readStr() {
    const len = readU32();
    if (len === 0) return '';
    const s = decoder.decode(buf.subarray(pos, pos + len));
    pos += len;
    return s;
  }

  const magic = readU32();
  if (magic !== MAGIC) {
    throw new Error(
      `Invalid twinpack magic: 0x${magic.toString(16).toUpperCase().padStart(8, '0')}, ` +
      `expected 0x${MAGIC.toString(16).toUpperCase().padStart(8, '0')}`
    );
  }

  function readEntry() {
    const kind = readI16();
    const name = readStr();
    readU16();  // mark1 — unused
    pos += 10;  // padding
    const mark2 = readU8();
    entryCount++;

    if (kind === 1 && entryCount > 1) {
      const contentLen = readU32();
      const content = Buffer.from(buf.subarray(pos, pos + contentLen));
      pos += contentLen;
      readU32();  // trailer
      return { kind: 'file', name, mark2, content };
    }

    const count = readU32();
    const children = [];
    for (let i = 0; i < count; i++) {
      children.push(readEntry());
    }
    return { kind: 'directory', name, mark2, children };
  }

  return readEntry();
}

export { parseTwinpack };
