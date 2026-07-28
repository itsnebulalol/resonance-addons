import { afterEach, describe, expect, test } from "bun:test";
import { handleFavoriteCollection, handleLike } from "./mutations";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("SoundCloud favorite mutations", () => {
  test("uses the authenticated web-client like route", async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? new Request(input, init) : new Request(input.toString(), init);
      requests.push(request);
      if (new URL(request.url).pathname === "/me") {
        return Response.json({ id: 123 });
      }
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    await handleLike({ oauthToken: "token", datadome: "cookie-value" }, "liked", "456");
    await handleLike({ oauthToken: "token", datadome: "cookie-value" }, "none", "456");

    expect(requests[1]?.method).toBe("PUT");
    expect(new URL(requests[1]!.url).pathname).toBe("/users/123/track_likes/456");
    expect(requests[1]?.headers.get("Cookie")).toBe("datadome=cookie-value");
    expect(requests[3]?.method).toBe("DELETE");
  });

  test("explains the additional cookie when DataDome blocks mutation", async () => {
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? new Request(input, init) : new Request(input.toString(), init);
      if (new URL(request.url).pathname === "/me") {
        return Response.json({ id: 123 });
      }
      return Response.json({ message: "Forbidden" }, { status: 403 });
    }) as typeof fetch;

    await expect(handleLike({ oauthToken: "token" }, "liked", "456")).rejects.toThrow("datadome cookie");
  });

  test("exposes the synthetic Likes collection", async () => {
    expect(await handleFavoriteCollection()).toEqual({
      id: "__likes__",
      provider: "net.itsnebula.soundcloud",
      title: "Likes",
      author: null,
      trackCount: null,
      thumbnailURL: null,
      canAddTracks: false,
      canDelete: false,
    });
  });
});
