import { beforeEach, describe, expect, test } from "bun:test";

import { handleStream } from "./stream";

const cacheIdentity = "a".repeat(64);
const preparationID = "b".repeat(64);
let backendResponse: Record<string, unknown>;

describe("Apple Music stream descriptor", () => {
  beforeEach(() => {
    backendResponse = {
      state: "ready",
      url: "v1/audio/track.m4a?expires=2000000000&signature=fixture",
      bitrate: 1_000_000,
      durationSeconds: 180,
      format: "audio/mp4",
      contentLength: null,
      cacheIdentity,
      partialPersistence: "immutablePrefix",
      quality: {
        codec: "alac",
        sampleRate: 96_000,
        bitDepth: 24,
        channels: 2,
      },
      preparation: {
        id: preparationID,
        state: "ready",
        statusUrl: `v1/preparations/${preparationID}`,
      },
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(backendResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
  });

  test("maps a growing immutable prefix with independent preparation controls", async () => {
    const stream = await handleStream("123", "https://applemusic.test", "server-token");

    expect(stream.state).toBe("ready");
    if (stream.state !== "ready") throw new Error("expected ready stream");
    expect(stream.container).toBe("fragmentedMp4");
    expect(stream.codec).toBe("alac");
    expect(stream.contentLength).toBeNull();
    expect(stream.rangeSupport).toBe("bytes");
    expect(stream.seekMode).toBe("byteRange");
    expect(stream.cacheIdentity).toBe(cacheIdentity);
    expect(stream.partialPersistence).toBe("immutablePrefix");
    expect(stream.preparation?.id).toBe(preparationID);
    expect(stream.preparation?.id).not.toBe(stream.cacheIdentity);
    expect(stream.preparation?.statusRequest?.requestHeaders.Authorization).toBe("Bearer server-token");
  });

  test("maps a finalized representation to validated ranges", async () => {
    backendResponse.contentLength = 12_345;
    backendResponse.partialPersistence = "validatedRanges";
    backendResponse.preparation = null;

    const stream = await handleStream("123", "https://applemusic.test", "server-token");

    expect(stream.state).toBe("ready");
    if (stream.state !== "ready") throw new Error("expected ready stream");
    expect(stream.contentLength).toBe(12_345);
    expect(stream.partialPersistence).toBe("validatedRanges");
    expect(stream.preparation).toBeNull();
  });

  test("rejects a missing exact representation identity", async () => {
    delete backendResponse.cacheIdentity;

    await expect(handleStream("123", "https://applemusic.test", "server-token")).rejects.toThrow("no cache identity");
  });

  test("rejects a preparation identity that aliases the representation", async () => {
    backendResponse.preparation = {
      id: cacheIdentity,
      state: "ready",
      statusUrl: `v1/preparations/${cacheIdentity}`,
    };

    await expect(handleStream("123", "https://applemusic.test", "server-token")).rejects.toThrow(
      "must differ from cache identity",
    );
  });
});
