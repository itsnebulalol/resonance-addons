import { expect, test } from "bun:test";
import { decodeTTSManifest } from "./tts";

const narrationManifest =
  "CtQBCsUBCgRQT1NUGhVjbGllbnQtdHRzL3YxL2Z1bGZpbGwiowESlgE8c3BlYW" +
  "sgeG1sOmxhbmc9ImVuLVVTIj5PSyBsZXQncyBtb3ZlIG9uIHRvIGEgInN1bnNl" +
  "dCIgdmliZS4gRmlyc3QgdXAsIDxlbnRpdHkgdHlwZT0iYXJ0aXN0IiB1cmk9Ij" +
  "FIQmpqMjJ3emJzY0laOXNFYjVkeWYiPkpvbmFzIEJsdWU8L2VudGl0eT4uPC9z" +
  "cGVhaz4YBSgBMAY4xNgCKAEqCg0AAIDBFQAAQMA=";

test("Spotify narration manifests expose the native fulfill request body", () => {
  const body = decodeTTSManifest(narrationManifest);
  const text = new TextDecoder().decode(body);

  expect(body.length).toBeGreaterThan(100);
  expect(text).toContain('<speak xml:lang="en-US">');
  expect(text).toContain("Jonas Blue");
});

test("Spotify narration manifests reject malformed envelopes", () => {
  expect(() => decodeTTSManifest("AQID")).toThrow("no external audio request");
});
