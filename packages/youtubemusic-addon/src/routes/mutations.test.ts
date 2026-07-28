import { describe, expect, test } from "bun:test";
import { playlistArtworkAction, playlistArtworkBytes } from "./mutations";

describe("YouTube Music playlist artwork", () => {
  test("builds the first-party custom thumbnail action", () => {
    expect(playlistArtworkAction("encrypted-blob")).toEqual({
      action: "ACTION_SET_CUSTOM_THUMBNAIL",
      addedCustomThumbnail: {
        imageKey: {
          name: "studio_square_thumbnail",
          type: "PLAYLIST_IMAGE_TYPE_CUSTOM_THUMBNAIL",
        },
        playlistScottyEncryptedBlobId: "encrypted-blob",
      },
    });
  });

  test("accepts JPEG and PNG artwork", () => {
    expect(playlistArtworkBytes("AQIDBA==", "image/jpeg")).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(playlistArtworkBytes("AQIDBA==", "image/png")).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  test("rejects unsupported, empty, and oversized artwork", () => {
    expect(() => playlistArtworkBytes("AQIDBA==", "image/webp")).toThrow("must be JPEG or PNG");
    expect(() => playlistArtworkBytes("", "image/jpeg")).toThrow("empty");
    expect(() => playlistArtworkBytes(Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64"), "image/jpeg")).toThrow(
      "2 MB or smaller",
    );
  });
});
