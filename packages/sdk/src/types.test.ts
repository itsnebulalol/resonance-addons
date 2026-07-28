import { describe, expect, test } from "bun:test";

import { type PlaylistDetail, playlistRevision, type Track } from "./types";

const baseTrack: Track = {
  id: "track-id",
  provider: "provider-id",
  title: "Track",
  artists: [{ id: "artist-id", name: "Artist" }],
  album: { id: "album-id", name: "Album" },
  duration: "3:30",
  durationSeconds: 210,
  thumbnailURL: "https://example.com/art.jpg",
  isExplicit: false,
};

describe("Track", () => {
  test("accepts sparse and enriched canonical metadata", () => {
    const enriched: Track = {
      ...baseTrack,
      genres: ["Electronic", "House"],
      releaseYear: 2026,
      albumArtists: [{ id: "album-artist-id", name: "Album Artist" }],
      trackNumber: 3,
      trackTotal: 12,
      discNumber: 1,
      discTotal: 2,
      bpm: 124.5,
      musicalKey: "8A",
    };

    expect(baseTrack.genres).toBeUndefined();
    expect(enriched).toMatchObject({
      genres: ["Electronic", "House"],
      releaseYear: 2026,
      trackNumber: 3,
      trackTotal: 12,
      discNumber: 1,
      discTotal: 2,
      bpm: 124.5,
      musicalKey: "8A",
    });
  });
});

describe("Playlist entries", () => {
  test("preserves duplicate tracks with occurrence-specific identity", () => {
    const detail: PlaylistDetail = {
      id: "playlist",
      title: "Playlist",
      author: null,
      description: null,
      trackCount: "2 tracks",
      thumbnailURL: null,
      entries: [
        { id: "entry-1", track: baseTrack },
        { id: "entry-2", track: baseTrack },
      ],
      continuation: null,
      revision: null,
      editCapabilities: {
        canRename: true,
        canChangeArtwork: false,
        canReorder: true,
        canRemoveItems: true,
      },
    };

    expect(detail.entries[0]?.track.id).toBe(detail.entries[1]?.track.id);
    expect(detail.entries[0]?.id).not.toBe(detail.entries[1]?.id);
    expect(playlistRevision(detail.title, detail.entries)).not.toBe(
      playlistRevision(detail.title, detail.entries.toReversed()),
    );
  });
});
