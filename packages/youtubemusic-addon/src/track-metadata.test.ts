import { describe, expect, test } from "bun:test";
import { parsePlaylistPanelVideoRaw } from "./routes/queue";
import { parseTrackMetadata } from "./track-metadata";

describe("YouTube Music track metadata", () => {
  test("normalizes explicit nested metadata into canonical fields", () => {
    expect(
      parseTrackMetadata({
        musicTrackMetadata: {
          genres: ["Electronic", { name: "House" }, ""],
          releaseDate: "2026-04-17",
          albumArtists: [
            { browseId: "artist-1", name: "Album Artist" },
            { navigationEndpoint: { browseEndpoint: { browseId: "artist-2" } }, text: "Guest Artist" },
          ],
          trackNumber: "3",
          totalTrackCount: 12,
          discNumber: 1,
          totalDiscCount: "2",
          beatsPerMinute: "124.5",
          keySignature: "8A",
        },
      }),
    ).toEqual({
      genres: ["Electronic", "House"],
      releaseYear: 2026,
      albumArtists: [
        { id: "artist-1", name: "Album Artist" },
        { id: "artist-2", name: "Guest Artist" },
      ],
      trackNumber: 3,
      trackTotal: 12,
      discNumber: 1,
      discTotal: 2,
      bpm: 124.5,
      musicalKey: "8A",
    });
  });

  test("keeps unavailable or presentation-only metadata undefined", () => {
    expect(
      parseTrackMetadata({
        subtitle: "Electronic • 2026 • 124 BPM • 8A",
        metadata: {
          genres: [],
          releaseYear: "unknown",
          albumArtists: [],
          trackNumber: 0,
          trackTotal: -1,
          discNumber: null,
          discTotal: "",
          bpm: "fast",
          musicalKey: " ",
        },
      }),
    ).toEqual({});
  });

  test("lets explicit track metadata override inherited album metadata", () => {
    expect(
      parseTrackMetadata(
        {
          trackMetadata: {
            releaseYear: 2025,
            trackNumber: 4,
          },
        },
        {
          releaseYear: 2024,
          albumArtists: [{ id: "album-artist", name: "Album Artist" }],
          trackTotal: 10,
        },
      ),
    ).toEqual({
      releaseYear: 2025,
      albumArtists: [{ id: "album-artist", name: "Album Artist" }],
      trackNumber: 4,
      trackTotal: 10,
    });
  });

  test("queue constructors include renderer-provided metadata", () => {
    const track = parsePlaylistPanelVideoRaw({
      videoId: "video-1",
      title: { runs: [{ text: "Track" }] },
      shortBylineText: { runs: [{ text: "Artist" }] },
      lengthText: { runs: [{ text: "3:12" }] },
      metadata: {
        genres: ["Pop"],
        releaseYear: 2024,
        trackNumber: 2,
        trackTotal: 11,
      },
    });

    expect(track).toMatchObject({
      id: "video-1",
      genres: ["Pop"],
      releaseYear: 2024,
      trackNumber: 2,
      trackTotal: 11,
    });
    expect(track?.discNumber).toBeUndefined();
    expect(track?.bpm).toBeUndefined();
  });
});
