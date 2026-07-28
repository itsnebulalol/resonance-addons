# Resonance Addons

A collection of addons for [Resonance](https://resonance.stkc.win).

## Addons

All addons are available on the [Resonance Addons homepage](https://resonance.itsnebula.net).

| Addon | Description |
|-------|-------------|
| **YouTube Music** | Stream, browse, search, manage your library, and sync listening history with YouTube Music |
| **Spotify** | Stream, browse, search, manage your library, and sync listening history with Spotify |
| **Apple Music** | Stream, browse, search, manage your library, and sync listening history with Apple Music |
| **LRCLIB** | Fetch synchronized and plain-text lyrics from LRCLIB |
| **SoundCloud** | Stream, browse, search, manage your library, and sync listening history with SoundCloud |

Spotify and Apple Music use separate self-hosted streaming servers. The addon bundles keep catalog,
library, search, and mutation requests on-device, while their Docker backends handle provider media
acquisition and decryption. They are currently private.

## Development

Requires [Bun](https://bun.sh).

```sh
bun install
```

### Build

```sh
# Build all addons as .resonance packages
bun run build

# Build a single addon
bun run build:youtubemusic
bun run build:spotify
bun run build:applemusic
bun run build:lrclib
bun run build:soundcloud
```

### Lint & Format

```sh
bun run check    # lint + format (auto-fix)
bun run lint     # lint only
bun run format   # format only (auto-fix)
```

## Project Structure

```
packages/
  sdk/                  Shared addon SDK (defineAddon, types, errors)
  youtubemusic-addon/   YouTube Music addon
  spotify-addon/        Spotify addon
  applemusic-addon/     Apple Music addon
  lrclib-addon/         LRCLIB lyrics addon
  soundcloud-addon/     SoundCloud addon
public/
  index.html            Static homepage
servers/                Private submodule containing Apple Music and Spotify servers
scripts/
  addons.ts             Canonical addon metadata and build list
  build.ts              Builds all addons using Bun.build()
  smoke.ts              Smoke tests for built bundles
```

## Creating an Addon

Each addon uses `defineAddon` from `@resonance-addons/sdk` to declare its manifest and handlers:

```ts
import { defineAddon } from "@resonance-addons/sdk";

export const addon = defineAddon({
  id: "net.itsnebula.example",
  name: "Example",
  description: "An example addon",
  version: "1.0.0",
  resources: [{ type: "stream", idPrefixes: ["net.itsnebula.example"] }],
  handlers: {
    resolveStream: (config, trackId) => {
      // ...
    },
  },
});
```

### History Providers

Declare `{ type: "history", idPrefixes: [...] }` and implement
`recordHistory(config, trackId, event)` to sync committed listens. Resonance resolves tracks from
other catalog providers before calling the handler, so `trackId` is already in the History
provider's namespace.

```ts
recordHistory: async (config, trackId, event) => {
  // Translate the committed listen into the provider's scrobble or playback-reporting API.
}
```

`event` includes `playbackId`, `startedAtMs`, `reportedAtMs`, `listenedSeconds`,
`positionSeconds`, `durationSeconds`, and `completed`. History providers are independently enabled
with checkboxes; every checked provider receives the listen.

### Playlist Mutations

Playlist mutation support is split into independent capabilities and handlers:

```ts
capabilities: {
  supportsAddToPlaylist: true,
  supportsCreatePlaylist: true,
  supportsRemoveFromPlaylist: true,
},
handlers: {
  addToPlaylist: async (config, trackId, playlistId) => {},
  createPlaylist: async (config, name) => ({
    id: "provider-local-id",
    provider: "net.itsnebula.example",
    title: name,
    author: null,
    trackCount: "0 tracks",
    thumbnailURL: null,
    canAddTracks: true,
  }),
  removeFromPlaylist: async (config, trackId, playlistId) => {},
}
```

Return `canAddTracks: false` for read-only playlist summaries. Playlist details should return
`canEdit: true` only when the authenticated user may remove tracks. Do not advertise a mutation
capability until its handler succeeds against the provider API.

The suite creates a disposable playlist on Spotify, SoundCloud, Apple Music, and YouTube Music,
verifies add and remove behavior through the source handlers, and deletes or removes the playlist
from the account in `finally`.

The build script produces a self-contained `.resonance` package for each addon. Each package is a UTF-8
JavaScript IIFE with the Resonance format header and sets `globalThis.__resonance_addon__` when executed.

Install a package by choosing it from Resonance Settings, or by opening the `.resonance` file from Files,
Safari, or AirDrop. Resonance keeps a verified local copy and syncs installed packages privately through
iCloud.

## License

Resonance Addons are licensed under [GPL-3.0](LICENSE).
