/**
 * Catalog discovery.
 *
 *   GET /catalog/mcps                    → paginated CatalogConnector
 *   GET /catalog/mcps/{slug}             → CatalogConnectorDetail (+ credential_schema)
 *   GET /marketplace/search?q=...&page=1 → CatalogSearchResult (items + hasMore + page)
 */
import type { HttpClient } from '../core/http';
import { ProtocolError } from '../core/errors';
import { normalizePaginated, pageIterator, unwrapItem } from '../core/pagination';
import type {
  CatalogConnector,
  CatalogConnectorDetail,
  CatalogSearchResult,
  Paginated,
  RequestOptions,
} from '../types';

interface MarketplaceSearchBody {
  results?: unknown;
  has_more?: unknown;
  page?: unknown;
}

/** Map one marketplace/search result item to a {@link CatalogConnector}; malformed items throw. */
function toSearchConnector(item: unknown, index: number): CatalogConnector {
  const it = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;

  if (typeof it.id !== 'string' || it.id.trim() === '') {
    throw new ProtocolError(`Malformed marketplace search item at index ${index}: missing id.`, {
      details: item,
    });
  }
  if (typeof it.slug !== 'string' || it.slug.trim() === '') {
    throw new ProtocolError(`Malformed marketplace search item at index ${index}: missing slug.`, {
      details: item,
    });
  }
  if (typeof it.title !== 'string') {
    throw new ProtocolError(`Malformed marketplace search item at index ${index}: missing title.`, {
      details: item,
    });
  }
  if (typeof it.listing_type !== 'string') {
    throw new ProtocolError(`Malformed marketplace search item at index ${index}: missing listing_type.`, {
      details: item,
    });
  }

  const connector: CatalogConnector = {
    id: it.id,
    slug: it.slug,
    title: it.title,
    short_description: typeof it.short_description === 'string' ? (it.short_description as string) : null,
    publisher_type: typeof it.publisher_type === 'string' ? (it.publisher_type as string) : 'community',
    listing_type: it.listing_type,
    // wire key is `requires_auth`
    requires_buyer_auth: it.requires_buyer_auth === true || it.requires_auth === true,
  };
  if (typeof it.server_type === 'string') connector.server_type = it.server_type;
  if (typeof it.tools_count === 'number') connector.tools_count = it.tools_count;
  return connector;
}

/** Normalize a marketplace/search body; a missing `results` array throws a {@link ProtocolError}. */
export function normalizeMarketplaceSearch(body: unknown): CatalogSearchResult {
  const response = body as MarketplaceSearchBody;
  if (!response || typeof response !== 'object' || !Array.isArray(response.results)) {
    throw new ProtocolError('Malformed marketplace search response: missing results array.', {
      details: body,
    });
  }

  const items = response.results.map((item, index) => toSearchConnector(item, index));
  return {
    items,
    hasMore: response.has_more === true,
    page: typeof response.page === 'number' ? response.page : 1,
  };
}

export class CatalogClient {
  constructor(private readonly http: HttpClient) {}

  /** List public connectors (page-based, 50 per page). */
  async list(opts: { page?: number } & RequestOptions = {}): Promise<Paginated<CatalogConnector>> {
    const body = await this.http.get<unknown>('/catalog/mcps', {
      query: { page: opts.page },
      signal: opts.signal,
      idempotencyKey: opts.idempotencyKey,
      timeoutMs: opts.timeoutMs,
    });
    return normalizePaginated<CatalogConnector>(body);
  }

  /**
   * Iterate every catalog connector across all pages. Convenience over `list()`
   * for callers that want the full catalog without manual page bookkeeping.
   */
  async *iterate(opts: { page?: number } & RequestOptions = {}): AsyncIterable<CatalogConnector> {
    // Seed with the explicitly-requested page (default 1) if given, so a caller
    // can resume from a known page; otherwise start at the first page.
    const first = await this.list({ ...opts });
    yield* pageIterator(first, (page) => this.list({ ...opts, page }));
  }

  /** Fetch a single connector by slug (or uuid), including its credential schema. */
  async get(slug: string, opts: RequestOptions = {}): Promise<CatalogConnectorDetail> {
    const body = await this.http.get<unknown>(`/catalog/mcps/${encodeURIComponent(slug)}`, {
      signal: opts.signal,
      idempotencyKey: opts.idempotencyKey,
      timeoutMs: opts.timeoutMs,
    });
    return unwrapItem<CatalogConnectorDetail>(body);
  }

  /** Search the marketplace; returns a paged {@link CatalogSearchResult}. */
  async search(
    query: string,
    opts: { page?: number } & RequestOptions = {},
  ): Promise<CatalogSearchResult> {
    const body = await this.http.get<unknown>('/marketplace/search', {
      query: { q: query, page: opts.page ?? 1 },
      signal: opts.signal,
      idempotencyKey: opts.idempotencyKey,
      timeoutMs: opts.timeoutMs,
    });
    return normalizeMarketplaceSearch(body);
  }
}
