export const DEFAULT_STOREFRONT = "us";
const API_BASE = "https://amp-api.music.apple.com";

export class StorefrontResolver {
  private readonly cache = new Map<string, string>();

  async resolve(userToken: string, load: () => Promise<string | null | undefined>): Promise<string> {
    const cacheKey = userToken.trim();
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    let storefront = DEFAULT_STOREFRONT;
    try {
      storefront = (await load())?.trim().toLowerCase() || DEFAULT_STOREFRONT;
    } catch {
      storefront = DEFAULT_STOREFRONT;
    }
    this.cache.set(cacheKey, storefront);
    return storefront;
  }
}

export function catalogURL(storefront: string, path: string): string {
  const normalizedStorefront = storefront.trim().toLowerCase() || DEFAULT_STOREFRONT;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}/v1/catalog/${normalizedStorefront}${normalizedPath}`;
}
