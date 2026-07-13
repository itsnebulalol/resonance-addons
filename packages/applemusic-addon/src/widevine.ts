import forge from "node-forge";
import { DEVICE_WVD_B64 } from "./device-data";

const b2s = (b: Buffer | Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
};
const s2b = (s: string) => {
  const o = Buffer.alloc(s.length);
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 0xff;
  return o;
};
const u16be = (b: Buffer, o: number) => ((b[o]! << 8) | b[o + 1]!) >>> 0;
const bufEq = (a: Buffer, b: Buffer) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

// ---------- minimal proto2 codec (varint + length-delimited) ----------
function encVarint(n: number | bigint): Buffer {
  let v = BigInt(n);
  const o: number[] = [];
  while (v > 0x7fn) {
    o.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  o.push(Number(v & 0x7fn));
  return Buffer.from(o);
}
const fTag = (field: number, wire: number) => encVarint((field << 3) | wire);
const fBytes = (field: number, buf: Buffer) => Buffer.concat([fTag(field, 2), encVarint(buf.length), Buffer.from(buf)]);
const fVarint = (field: number, n: number) => Buffer.concat([fTag(field, 0), encVarint(n)]);
function parseFields(buf: Buffer): Record<number, Buffer[] | bigint[]> {
  const out: any = {};
  let i = 0;
  const rv = () => {
    let shift = 0n,
      r = 0n,
      b: number;
    do {
      b = buf[i++]!;
      r |= BigInt(b & 0x7f) << shift;
      shift += 7n;
    } while (b & 0x80);
    return r;
  };
  while (i < buf.length) {
    const t = Number(rv()),
      field = t >> 3,
      wire = t & 7;
    let val: any;
    if (wire === 0) val = rv();
    else if (wire === 2) {
      const len = Number(rv());
      val = buf.subarray(i, i + len);
      i += len;
    } else if (wire === 5) {
      val = buf.subarray(i, i + 4);
      i += 4;
    } else if (wire === 1) {
      val = buf.subarray(i, i + 8);
      i += 8;
    } else throw new Error(`bad wire ${wire}`);
    (out[field] = out[field] || []).push(val);
  }
  return out;
}

// ---------- AES-128-ECB single block (ECB encrypts blocks independently) ----------
function ecbEnc(key16: Buffer, block16: Buffer): Buffer {
  const c = forge.cipher.createCipher("AES-ECB", b2s(key16));
  c.start();
  c.update(forge.util.createBuffer(b2s(block16)));
  c.finish();
  return s2b(c.output.getBytes()).subarray(0, 16);
}
// ---------- AES-128-CMAC (RFC 4493) ----------
function xorB(a: Buffer, b: Buffer): Buffer {
  const o = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i]! ^ b[i]!;
  return o;
}
function dbl(buf: Buffer): Buffer {
  const o = Buffer.alloc(16);
  let carry = 0;
  for (let i = 15; i >= 0; i--) {
    o[i] = ((buf[i]! << 1) & 0xff) | carry;
    carry = buf[i]! & 0x80 ? 1 : 0;
  }
  if (buf[0]! & 0x80) o[15]! ^= 0x87;
  return o;
}
function cmac(key: Buffer, msg: Buffer): Buffer {
  const L = ecbEnc(key, Buffer.alloc(16)),
    K1 = dbl(L),
    K2 = dbl(K1);
  const n = Math.max(1, Math.ceil(msg.length / 16));
  const complete = msg.length > 0 && msg.length % 16 === 0;
  let last: Buffer;
  if (complete) last = xorB(msg.subarray((n - 1) * 16), K1);
  else {
    const rem = msg.subarray((n - 1) * 16);
    const padded = Buffer.concat([rem, Buffer.from([0x80]), Buffer.alloc(16 - rem.length - 1)]);
    last = xorB(padded, K2);
  }
  let X: Buffer<ArrayBufferLike> = Buffer.alloc(16);
  for (let i = 0; i < n - 1; i++) X = ecbEnc(key, xorB(X, msg.subarray(i * 16, i * 16 + 16)));
  return ecbEnc(key, xorB(X, last));
}

// ---------- device.wvd v2 ----------
function loadDevice() {
  const wvd = Buffer.from(DEVICE_WVD_B64, "base64");
  if (wvd.subarray(0, 3).toString("latin1") !== "WVD") throw new Error("bad WVD");
  let o = 3;
  const type = wvd[4]!;
  o = 7;
  const pkLen = u16be(wvd, o);
  o += 2;
  const privKeyDer = wvd.subarray(o, o + pkLen);
  o += pkLen;
  const cidLen = u16be(wvd, o);
  o += 2;
  const clientId = wvd.subarray(o, o + cidLen);
  const privateKey = forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(b2s(privKeyDer))));
  return { type, clientId, privateKey }; // type: 1=CHROME 2=ANDROID
}

function deriveContext(msg: Buffer) {
  return {
    enc: Buffer.concat([Buffer.from("ENCRYPTION\x00", "latin1"), msg, Buffer.from([0, 0, 0, 0x80])]),
    mac: Buffer.concat([Buffer.from("AUTHENTICATION\x00", "latin1"), msg, Buffer.from([0, 0, 0x02, 0])]),
  };
}

export interface ContentKey {
  kid: string;
  key: string;
}

export class WidevineCDM {
  private d = loadDevice();
  private ctx: { enc: Buffer; mac: Buffer } | null = null;

  getChallenge(kid: Buffer): Buffer {
    let requestId: Buffer;
    if (this.d.type === 2) {
      const rnd = s2b(forge.random.getBytesSync(4));
      const sess = Buffer.alloc(8);
      sess[0] = 1; // writeUInt32LE(1,0) == [01,00,00,00,..] in a zeroed buffer
      requestId = Buffer.from(
        Buffer.concat([rnd, Buffer.alloc(4), sess])
          .toString("hex")
          .toUpperCase(),
        "latin1",
      );
    } else requestId = s2b(forge.random.getBytesSync(16));
    const initData = fBytes(2, kid); // WidevinePsshData{key_ids:[kid]}
    const wpd = Buffer.concat([fBytes(1, initData), fVarint(2, 1 /*STREAMING*/), fBytes(3, requestId)]);
    const contentId = fBytes(1, wpd);
    const nonce = 1 + Math.floor(Math.random() * (2 ** 31 - 1));
    const msg = Buffer.concat([
      fBytes(1, this.d.clientId),
      fBytes(2, contentId),
      fVarint(3, 1 /*NEW*/),
      fVarint(4, Math.floor(Date.now() / 1000)),
      fVarint(6, 21 /*VERSION_2_1*/),
      fVarint(7, nonce),
    ]);
    const md = forge.md.sha1.create();
    md.update(b2s(msg));
    const pss = forge.pss.create({
      md: forge.md.sha1.create(),
      mgf: forge.mgf.mgf1.create(forge.md.sha1.create()),
      saltLength: 20,
    });
    const signature = s2b((this.d.privateKey as any).sign(md, pss));
    this.ctx = deriveContext(msg);
    return Buffer.concat([fVarint(1, 1 /*LICENSE_REQUEST*/), fBytes(2, msg), fBytes(3, signature)]);
  }

  parseLicense(licenseBytes: Buffer): ContentKey {
    if (!this.ctx) throw new Error("call getChallenge first");
    const sm = parseFields(licenseBytes);
    if (Number(sm[1]![0]) !== 2) throw new Error("not a LICENSE message");
    const licMsg = sm[2]![0] as Buffer,
      sessionKeyEnc = sm[4]![0] as Buffer;
    const oem = sm[9] ? (sm[9][0] as Buffer) : Buffer.alloc(0);
    const sessionKey = s2b(
      (this.d.privateKey as any).decrypt(b2s(sessionKeyEnc), "RSA-OAEP", {
        md: forge.md.sha1.create(),
        mgf1: { md: forge.md.sha1.create() },
      }),
    );
    const encKey = cmac(sessionKey, Buffer.concat([Buffer.from([1]), this.ctx.enc]));
    const macServer = Buffer.concat([
      cmac(sessionKey, Buffer.concat([Buffer.from([1]), this.ctx.mac])),
      cmac(sessionKey, Buffer.concat([Buffer.from([2]), this.ctx.mac])),
    ]);
    const hm = forge.hmac.create();
    hm.start("sha256", b2s(macServer));
    hm.update(b2s(Buffer.concat([oem, licMsg])));
    if (!bufEq(s2b(hm.digest().getBytes()), sm[3]![0] as Buffer)) throw new Error("license signature mismatch");
    const lic = parseFields(licMsg);
    for (const kc of (lic[3] as Buffer[] | undefined) || []) {
      const f = parseFields(kc);
      if (Number(f[4]![0]) !== 2 /*CONTENT*/) continue;
      const dec = forge.cipher.createDecipher("AES-CBC", b2s(encKey));
      dec.start({ iv: b2s(f[2]![0] as Buffer) });
      dec.update(forge.util.createBuffer(b2s(f[3]![0] as Buffer)));
      dec.finish();
      return { kid: (f[1]![0] as Buffer).toString("hex"), key: s2b(dec.output.getBytes()).toString("hex") };
    }
    throw new Error("no CONTENT key in license");
  }
}
