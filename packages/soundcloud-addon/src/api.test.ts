import { afterEach, describe, expect, test } from "bun:test";
import { hydrateTracks, msToSeconds, type SoundCloudTrack, trackToTrack } from "./api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("SoundCloud canonical track metadata", () => {
  test("omits sub-second durations that would round to zero", () => {
    expect(msToSeconds(1)).toBeNull();
    expect(msToSeconds(499)).toBeNull();
    expect(msToSeconds(500)).toBe(1);
  });

  test("maps provider metadata without assigning a label account ID to the credited artist", () => {
    const track = trackToTrack({
      id: 123,
      kind: "track",
      title: "Signal",
      duration: 185_400,
      genre: " Electronic ",
      release_date: "2024-06-14T00:00:00Z",
      bpm: "128.5",
      key_signature: " F#m ",
      track_number: "3",
      track_total: 12,
      disc_number: 1,
      disc_total: "2",
      user: {
        id: 99,
        username: "Example Records",
      },
      publisher_metadata: {
        artist: "Artist One, Artist Two",
        album_title: "Night Signals",
        explicit: true,
      },
    });

    expect(track.artists).toEqual([{ id: null, name: "Artist One, Artist Two" }]);
    expect(track.album).toEqual({ id: null, name: "Night Signals" });
    expect(track.genres).toEqual(["Electronic"]);
    expect(track.releaseYear).toBe(2024);
    expect(track.albumArtists).toEqual([{ id: null, name: "Artist One, Artist Two" }]);
    expect(track.trackNumber).toBe(3);
    expect(track.trackTotal).toBe(12);
    expect(track.discNumber).toBe(1);
    expect(track.discTotal).toBe(2);
    expect(track.bpm).toBe(128.5);
    expect(track.musicalKey).toBe("F#m");
  });

  test("preserves partial-track metadata while adding hydrated playback fields", async () => {
    const partial: SoundCloudTrack = {
      id: 456,
      kind: "track",
      title: "Hydrated Signal",
      genre: "Ambient",
      release_date: "2021-02-03T00:00:00Z",
      track_number: 4,
      publisher_metadata: {
        artist: "Signal Artist",
        album_title: "Signals",
      },
      user: {
        id: 12,
        username: "Signal Artist",
      },
    };
    const hydrated: SoundCloudTrack = {
      id: 456,
      kind: "track",
      title: "Hydrated Signal",
      duration: 240_000,
      bpm: 92,
      key_signature: "Am",
      user: {
        id: 12,
        username: "Signal Artist",
        avatar_url: "https://i1.sndcdn.com/avatars-test-large.jpg",
      },
      media: {
        transcodings: [
          {
            url: "https://api.test/transcoding",
            format: { protocol: "progressive", mime_type: "audio/mpeg" },
          },
        ],
      },
    };

    globalThis.fetch = (async () => new Response(JSON.stringify([hydrated]))) as unknown as typeof fetch;

    const [result] = await hydrateTracks({}, [partial]);
    expect(result).toMatchObject({
      genre: "Ambient",
      release_date: "2021-02-03T00:00:00Z",
      track_number: 4,
      bpm: 92,
      key_signature: "Am",
      duration: 240_000,
      publisher_metadata: {
        artist: "Signal Artist",
        album_title: "Signals",
      },
    });
    expect(result?.media?.transcodings).toHaveLength(1);

    const canonical = trackToTrack(result!);
    expect(canonical.genres).toEqual(["Ambient"]);
    expect(canonical.releaseYear).toBe(2021);
    expect(canonical.trackNumber).toBe(4);
    expect(canonical.bpm).toBe(92);
    expect(canonical.musicalKey).toBe("Am");
  });
});
