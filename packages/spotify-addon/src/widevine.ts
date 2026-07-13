import forge from "node-forge";

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
const fStr = (field: number, str: string) => fBytes(field, Buffer.from(str, "utf8"));
const fVarint = (field: number, n: number) => Buffer.concat([fTag(field, 0), encVarint(n)]);
function parseFields(buf: Buffer): Record<number, (Buffer | bigint)[]> {
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

// ---------- AES-128-ECB single block + CMAC (RFC 4493) ----------
function ecbEnc(key16: Buffer, block16: Buffer): Buffer {
  const c = forge.cipher.createCipher("AES-ECB", b2s(key16));
  c.start();
  c.update(forge.util.createBuffer(b2s(block16)));
  c.finish();
  return s2b(c.output.getBytes()).subarray(0, 16);
}
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

// ---------- device.wvd ----------
function loadDevice(wvd: Buffer) {
  if (!(wvd[0] === 0x57 && wvd[1] === 0x56 && wvd[2] === 0x44)) throw new Error("bad WVD"); // "WVD"
  const type = wvd[4]!; // 1=CHROME 2=ANDROID
  let o = 7;
  const pkLen = u16be(wvd, o);
  o += 2;
  const privKeyDer = wvd.subarray(o, o + pkLen);
  o += pkLen;
  const cidLen = u16be(wvd, o);
  o += 2;
  const clientId = wvd.subarray(o, o + cidLen);
  const privateKey = forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(b2s(privKeyDer))));
  return { type, clientId, privateKey };
}

function pubFromPkcs1(der: Buffer) {
  const asn1: any = forge.asn1.fromDer(forge.util.createBuffer(b2s(der)));
  const n = asn1.value[0].value,
    e = asn1.value[1].value;
  const big = (raw: string) => new (forge as any).jsbn.BigInteger(s2b(raw).toString("hex"), 16);
  return forge.pki.setRsaPublicKey(big(n), big(e));
}

function deriveEncContext(msg: Buffer) {
  return Buffer.concat([Buffer.from("ENCRYPTION\x00", "latin1"), msg, Buffer.from([0, 0, 0, 0x80])]); // 128-bit
}

export interface ContentKey {
  kid: string;
  key: string;
}
interface ServiceCert {
  providerId: string;
  serial: Buffer;
  pub: any;
}

function firstField(fields: Record<number, (Buffer | bigint)[]>, field: number): Buffer | bigint {
  const value = fields[field]?.[0];
  if (value === undefined) throw new Error(`missing protobuf field ${field}`);
  return value;
}

function bufferField(fields: Record<number, (Buffer | bigint)[]>, field: number): Buffer {
  const value = firstField(fields, field);
  if (!Buffer.isBuffer(value)) throw new Error(`protobuf field ${field} is not bytes`);
  return value;
}

export class WidevineCDM {
  private d: ReturnType<typeof loadDevice>;
  private cert: ServiceCert | null = null;
  private encContext: Buffer | null = null;

  constructor(wvd: Buffer) {
    this.d = loadDevice(wvd);
  }

  setServiceCertificate(certBytes: Buffer): string {
    const top = parseFields(certBytes);
    let sdcBuf = certBytes;
    if (top[2] && top[1] && typeof top[1][0] === "bigint") sdcBuf = top[2][0] as Buffer;
    const sdc = parseFields(sdcBuf); // SignedDrmCertificate{1:drm_certificate,2:signature}
    const drmCert = parseFields(bufferField(sdc, 1)); // DrmCertificate
    this.cert = {
      providerId: bufferField(drmCert, 7).toString("utf8"),
      serial: bufferField(drmCert, 2),
      pub: pubFromPkcs1(bufferField(drmCert, 4)),
    };
    return this.cert.providerId;
  }
  getChallenge(initData: Buffer): Buffer {
    if (!this.cert) throw new Error("service certificate not set (privacy mode required)");

    // EncryptedClientIdentification
    const privacyKey = s2b(forge.random.getBytesSync(16));
    const privacyIv = s2b(forge.random.getBytesSync(16));
    const cc = forge.cipher.createCipher("AES-CBC", b2s(privacyKey));
    cc.start({ iv: b2s(privacyIv) });
    cc.update(forge.util.createBuffer(b2s(this.d.clientId)));
    cc.finish();
    const encClientId = s2b(cc.output.getBytes());
    const encPrivacyKey = s2b(this.cert.pub.encrypt(b2s(privacyKey), "RSA-OAEP", { md: forge.md.sha1.create() }));
    const eci = Buffer.concat([
      fStr(1, this.cert.providerId),
      fBytes(2, this.cert.serial),
      fBytes(3, encClientId),
      fBytes(4, privacyIv),
      fBytes(5, encPrivacyKey),
    ]);

    let requestId: Buffer;
    if (this.d.type === 2) {
      const rnd = s2b(forge.random.getBytesSync(4));
      const counter = Buffer.alloc(8);
      counter[0] = 1; // session number, little-endian
      const raw = Buffer.concat([rnd, Buffer.alloc(4), counter]); // 16 bytes
      requestId = Buffer.from(raw.toString("hex").toUpperCase(), "latin1");
    } else {
      requestId = s2b(forge.random.getBytesSync(16));
    }

    // ContentIdentification{1: WidevinePsshData{1:pssh_data(raw init data), 2:STREAMING, 3:request_id}}
    const wpd = Buffer.concat([fBytes(1, initData), fVarint(2, 1 /*STREAMING*/), fBytes(3, requestId)]);
    const contentId = fBytes(1, wpd);

    const nonce = 1 + Math.floor(Math.random() * (2 ** 31 - 1));
    const msg = Buffer.concat([
      fBytes(8, eci), // encrypted_client_id
      fBytes(2, contentId), // content_id
      fVarint(3, 1 /*NEW*/), // type
      fVarint(4, Math.floor(Date.now() / 1000)), // request_time
      fVarint(6, 21 /*VERSION_2_1*/), // protocol_version
      fVarint(7, nonce), // key_control_nonce
    ]);
    const md = forge.md.sha1.create();
    md.update(b2s(msg));
    const pss = forge.pss.create({
      md: forge.md.sha1.create(),
      mgf: forge.mgf.mgf1.create(forge.md.sha1.create()),
      saltLength: 20,
    });
    const signature = s2b((this.d.privateKey as any).sign(md, pss));
    this.encContext = deriveEncContext(msg);
    return Buffer.concat([fVarint(1, 1 /*LICENSE_REQUEST*/), fBytes(2, msg), fBytes(3, signature)]);
  }

  parseLicense(licenseBytes: Buffer): ContentKey {
    if (!this.encContext) throw new Error("call getChallenge first");
    const sm = parseFields(licenseBytes);
    const licMsg = bufferField(sm, 2);
    const sessionKeyEnc = bufferField(sm, 4);
    const sessionKey = s2b(
      (this.d.privateKey as any).decrypt(b2s(sessionKeyEnc), "RSA-OAEP", {
        md: forge.md.sha1.create(),
        mgf1: { md: forge.md.sha1.create() },
      }),
    );
    const encKey = cmac(sessionKey, Buffer.concat([Buffer.from([1]), this.encContext]));
    const lic = parseFields(licMsg);
    for (const kc of (lic[3] as Buffer[] | undefined) || []) {
      const f = parseFields(kc);
      if (Number(firstField(f, 4)) !== 2 /*CONTENT*/) continue;
      const dec = forge.cipher.createDecipher("AES-CBC", b2s(encKey));
      dec.start({ iv: b2s(bufferField(f, 2)) });
      dec.update(forge.util.createBuffer(b2s(bufferField(f, 3))));
      dec.finish();
      return { kid: bufferField(f, 1).toString("hex"), key: s2b(dec.output.getBytes()).toString("hex") };
    }
    throw new Error("no CONTENT key in license");
  }
}

export function psshInitData(psshBox: Buffer): Buffer {
  const ver = psshBox[8]!;
  let o = 8 + 4 + 16; // size(4)+type(4)+ver/flags(4)+systemid(16)
  if (ver > 0) {
    const kc = psshBox.readUInt32BE(o);
    o += 4 + 16 * kc;
  }
  const dataSize = psshBox.readUInt32BE(o);
  o += 4;
  return psshBox.subarray(o, o + dataSize);
}

void bufEq;
