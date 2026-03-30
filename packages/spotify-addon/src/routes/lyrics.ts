import { getAccessToken, spotifyFetch } from "../auth";
import { searchSpotifyTrack } from "./search";

interface SpotifySyllable {
  startTimeMs: string;
  endTimeMs: string;
  chars: string;
}

interface SpotifyLine {
  startTimeMs: string;
  words: string;
  syllables?: SpotifySyllable[];
  endTimeMs?: string;
}

interface SpotifyLyricsResponse {
  lyrics: {
    syncType: string;
    lines: SpotifyLine[];
  };
}

export async function handleLyrics(spDc: string, title?: string, artist?: string, _videoId?: string): Promise<any> {
  if (!title && !artist) return null;

  const token = await getAccessToken(spDc);

  const result = await searchSpotifyTrack(token, title ?? "", artist ?? "");
  if (!result) return null;
  const spotifyTrackId = result.id;

  const res = await spotifyFetch(
    `https://spclient.wg.spotify.com/color-lyrics/v2/track/${spotifyTrackId}/image/spotify%3Aimage%3Aab67616d0000b273?format=json&vocalRemoval=false&market=from_token`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "App-Platform": "WebPlayer",
        Accept: "application/json",
      },
    },
  );

  if (res.status === 404) return null;
  if (!res.ok) return null;

  const data = (await res.json()) as SpotifyLyricsResponse;
  const { syncType, lines } = data.lyrics;

  let mappedSyncType: string;
  if (syncType === "WORD_SYNCED") {
    mappedSyncType = "wordSynced";
  } else if (syncType === "LINE_SYNCED") {
    mappedSyncType = "lineSynced";
  } else {
    mappedSyncType = "unsynced";
  }

  const mappedLines = lines
    .filter((line) => line.words.trim().length > 0)
    .map((line, i) => {
      const startTimeMs = parseInt(line.startTimeMs, 10);
      const endTimeMs = line.endTimeMs ? parseInt(line.endTimeMs, 10) || null : null;

      const words =
        mappedSyncType === "wordSynced" && line.syllables?.length
          ? line.syllables.map((syl, j) => ({
              id: j,
              startTimeMs: parseInt(syl.startTimeMs, 10),
              endTimeMs: parseInt(syl.endTimeMs, 10),
              text: syl.chars,
            }))
          : [];

      return {
        id: i,
        startTimeMs,
        endTimeMs,
        text: line.words,
        words,
      };
    });

  return {
    syncType: mappedSyncType,
    lines: mappedLines,
  };
}
