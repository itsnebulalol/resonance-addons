import { describe, expect, test } from "bun:test";
import type { BackendStreamResponse } from "./stream";
import { mapBackendStreamResponse } from "./stream";

function response(
  partialPersistence: BackendStreamResponse["partialPersistence"],
  preparationId = "lease-1",
): BackendStreamResponse {
  return {
    state: "ready",
    url: "v1/audio/lease-1/media.flac?expires=1900000000&signature=test",
    bitrate: 1_411_200,
    durationSeconds: 180,
    format: "audio/flac",
    contentLength: null,
    bitDepth: 24,
    transport: "progressive",
    rangeSupport: "bytes",
    seekMode: "byteRange",
    cacheIdentity: "spotify:file:stable-representation",
    partialPersistence,
    preparation: {
      id: preparationId,
      statusRequest: {
        url: `v1/streams/${preparationId}/media/status`,
        method: "get",
        requestHeaders: {},
      },
      cancelRequest: {
        url: `v1/streams/${preparationId}/media/cancel`,
        method: "delete",
        requestHeaders: {},
      },
      refreshRequest: null,
    },
    pollAfterMilliseconds: null,
  };
}

describe("Spotify stream contract", () => {
  test("maps growing outputs to immutable-prefix persistence", () => {
    const stream = mapBackendStreamResponse(response("immutablePrefix"), "https://spotify.example/");

    expect(stream.partialPersistence).toBe("immutablePrefix");
    expect(stream.cacheIdentity).toBe("spotify:file:stable-representation");
  });

  test("maps static and finalized outputs to validated ranges", () => {
    const stream = mapBackendStreamResponse(response("validatedRanges"), "https://spotify.example/");

    expect(stream.partialPersistence).toBe("validatedRanges");
  });

  test("keeps preparation leases separate from representation identity", () => {
    const first = mapBackendStreamResponse(response("immutablePrefix", "lease-a"), "https://spotify.example/");
    const second = mapBackendStreamResponse(response("immutablePrefix", "lease-b"), "https://spotify.example/");

    expect(first.cacheIdentity).toBe(second.cacheIdentity);
    expect(first.preparation?.id).toBe("lease-a");
    expect(second.preparation?.id).toBe("lease-b");
    expect(first.preparation?.id).not.toBe(first.cacheIdentity);
  });

  test("rejects an absent representation identity", () => {
    const result = response("validatedRanges");
    result.cacheIdentity = " ";

    expect(() => mapBackendStreamResponse(result, "https://spotify.example/")).toThrow("no cache identity");
  });

  test("rejects unsupported partial persistence", () => {
    const result = response("validatedRanges");
    result.partialPersistence = "none";

    expect(() => mapBackendStreamResponse(result, "https://spotify.example/")).toThrow("invalid partial persistence");
  });

  test("rejects incomplete preparation and byte-range contracts", () => {
    const missingPreparation = response("validatedRanges");
    missingPreparation.preparation = undefined as never;
    expect(() => mapBackendStreamResponse(missingPreparation, "https://spotify.example/")).toThrow(
      "no preparation identity",
    );

    const invalidRange = response("validatedRanges");
    invalidRange.rangeSupport = "unknown";
    expect(() => mapBackendStreamResponse(invalidRange, "https://spotify.example/")).toThrow(
      "invalid byte-range contract",
    );
  });
});
