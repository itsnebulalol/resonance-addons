import { beforeEach, describe, expect, mock, test } from "bun:test";

let playerResponse: any;
const iflVideoID = "ifl-video";

mock.module("../auth", () => ({
  ytFetch: async () => playerResponse,
}));

mock.module("../ifl", () => ({
  resolveIFL: async () => iflVideoID,
}));

const { handleStream } = await import("./stream");

const config = { refreshToken: "fixture" };

describe("YouTube Music stream descriptor", () => {
  beforeEach(() => {
    playerResponse = {
      playabilityStatus: { status: "OK" },
      streamingData: {
        adaptiveFormats: [
          {
            itag: 251,
            url: "https://cdn.test/webm?expire=2000000000&clen=999",
            mimeType: 'audio/webm; codecs="opus"',
            bitrate: 500_000,
          },
          {
            itag: 140,
            url: "https://cdn.test/audio?expire=2000000000&clen=12345",
            mimeType: 'audio/mp4; codecs="mp4a.40.2"',
            bitrate: 128_000,
            averageBitrate: 127_000,
            approxDurationMs: "180500",
            audioSampleRate: "44100",
            audioChannels: 2,
            contentLength: "12345",
          },
        ],
      },
    };
  });

  test("requires progressive MP4 and returns provider-owned metadata", async () => {
    const stream = await handleStream(config, "video");
    expect(stream.state).toBe("ready");
    if (stream.state !== "ready") throw new Error("expected ready stream");
    expect(stream.transport).toBe("progressive");
    expect(stream.container).toBe("mp4");
    expect(stream.codec).toBe("aac");
    expect(stream.contentLength).toBe(12_345);
    expect(stream.durationSeconds).toBe(180.5);
    expect(stream.sampleRate).toBe(44_100);
    expect(stream.channelCount).toBe(2);
    expect(stream.expiresAtUnixMilliseconds).toBe(2_000_000_000_000);
    expect(stream.requestHeaders.Origin).toBe("https://www.youtube.com");
    expect(stream.requestHeaders.Range).toBe("bytes=0-");
    expect(stream.requestHeaders["Accept-Encoding"]).toBe("identity");
    expect(stream.requestHeaders.Referer).toBe("https://www.youtube.com/");
    expect(stream.cachePolicy).toBe("cacheable");
    expect(stream.partialPersistence).toBe("validatedRanges");
    expect(stream.cacheIdentity).toContain("video:itag:140");
  });

  test("marks dynamic seed playback ephemeral", async () => {
    const stream = await handleStream(config, "_ifl");
    expect(stream.state).toBe("ready");
    if (stream.state !== "ready") throw new Error("expected ready stream");
    expect(stream.cachePolicy).toBe("ephemeral");
    expect(stream.partialPersistence).toBe("none");
    expect(stream.cacheIdentity).toContain(iflVideoID);
  });

  test("rejects WebM-only responses", async () => {
    playerResponse.streamingData.adaptiveFormats = playerResponse.streamingData.adaptiveFormats.slice(0, 1);
    await expect(handleStream(config, "video")).rejects.toThrow("No clear progressive audio/mp4 stream found");
  });
});
