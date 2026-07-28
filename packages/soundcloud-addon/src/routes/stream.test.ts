import { beforeEach, describe, expect, mock, test } from "bun:test";

let track: any;

mock.module("../api", () => ({
  PROVIDER_ID: "com.resonance.soundcloud",
  fetchTrack: async () => track,
  hasPlayableTranscoding: () => true,
  scFetch: async () => ({
    url: "https://media.test/audio?Expires=2000000000",
  }),
}));

const { handleStream } = await import("./stream");

const config = {
  clientId: "fixture",
};

describe("SoundCloud stream descriptor", () => {
  beforeEach(() => {
    track = {
      id: 123,
      duration: 180_000,
      media: {
        transcodings: [
          {
            url: "https://api.test/hls",
            preset: "aac_160k",
            quality: "sq",
            format: {
              protocol: "hls",
              mime_type: 'audio/mp4; codecs="mp4a.40.2"',
            },
          },
          {
            url: "https://api.test/progressive",
            preset: "mp3_128k",
            quality: "sq",
            format: {
              protocol: "progressive",
              mime_type: "audio/mpeg",
            },
          },
        ],
      },
    };
  });

  test("selects progressive media and leaves unknown range semantics honest", async () => {
    const stream = await handleStream(config as any, "123");
    expect(stream.state).toBe("ready");
    if (stream.state !== "ready") throw new Error("expected ready stream");
    expect(stream.transport).toBe("progressive");
    expect(stream.container).toBe("mp3");
    expect(stream.codec).toBe("mp3");
    expect(stream.bitrate).toBe(128_000);
    expect(stream.rangeSupport).toBe("unknown");
    expect(stream.seekMode).toBe("restartFromZero");
    expect(stream.partialPersistence).toBe("validatedRanges");
    expect(stream.expiresAtUnixMilliseconds).toBe(2_000_000_000_000);
  });

  test("rejects HLS-only tracks", async () => {
    track.media.transcodings = track.media.transcodings.slice(0, 1);
    await expect(handleStream(config as any, "123")).rejects.toThrow("only available as HLS");
  });
});
