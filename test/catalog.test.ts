import { describe, expect, it } from 'vitest';
import { ProtocolError } from '../src';
import { makeVinkius, type Route } from './helpers/mock-fetch';

describe('CatalogClient', () => {
  it('normalizes a paginated list response', async () => {
    const route: Route = {
      method: 'GET',
      path: /^\/catalog\/mcps$/,
      respond: () => ({
        body: {
          data: [{ id: 'github', slug: 'github', title: 'GitHub' }],
          links: { first: 'a', last: 'b', prev: null, next: null },
          meta: { current_page: 1, from: 1, last_page: 1, path: '/', per_page: 50, to: 1, total: 1 },
        },
      }),
    };
    const { vinkius } = makeVinkius([route]);
    const page = await vinkius.catalog.list();
    expect(page.data).toHaveLength(1);
    expect(page.meta?.total).toBe(1);
  });

  it('unwraps a single-resource detail response', async () => {
    const route: Route = {
      method: 'GET',
      path: /^\/catalog\/mcps\/github$/,
      respond: () => ({ body: { data: { id: 'github', slug: 'github', credential_schema: {} } } }),
    };
    const { vinkius } = makeVinkius([route]);
    const detail = await vinkius.catalog.get('github');
    expect(detail.slug).toBe('github');
  });

  it('uses the marketplace search endpoint and normalizes its results', async () => {
    const route: Route = {
      method: 'GET',
      path: /^\/marketplace\/search$/,
      respond: () => ({
        body: {
          results: [
            {
              id: 'coindesk-bitcoin-price-index',
              slug: 'coindesk-bitcoin-price-index',
              title: 'CoinDesk Bitcoin Price Index',
              short_description: 'Get real-time Bitcoin prices.',
              publisher_type: 'verified',
              listing_type: 'paid',
              server_type: 'managed',
              tools_count: 8,
              requires_auth: false,
            },
          ],
          has_more: true,
          page: 1,
        },
      }),
    };
    const { vinkius, calls } = makeVinkius([route]);
    const result = await vinkius.catalog.search('cryptocurrency price');

    expect(calls[0]?.query.get('q')).toBe('cryptocurrency price');
    expect(calls[0]?.query.get('page')).toBe('1');
    expect(result.hasMore).toBe(true);
    expect(result.page).toBe(1);
    // listing_type is taken straight from the wire — never derived from server_type.
    expect(result.items[0]).toEqual({
      id: 'coindesk-bitcoin-price-index',
      slug: 'coindesk-bitcoin-price-index',
      title: 'CoinDesk Bitcoin Price Index',
      short_description: 'Get real-time Bitcoin prices.',
      publisher_type: 'verified',
      listing_type: 'paid',
      requires_buyer_auth: false,
      server_type: 'managed',
      tools_count: 8,
    });
  });

  it('throws a ProtocolError when a search item is missing its listing_type', async () => {
    const route: Route = {
      method: 'GET',
      path: /^\/marketplace\/search$/,
      respond: () => ({
        body: {
          results: [
            {
              id: 'x',
              slug: 'x',
              title: 'X',
              // deliberately no listing_type
            },
          ],
          has_more: false,
          page: 1,
        },
      }),
    };
    const { vinkius } = makeVinkius([route]);
    await expect(vinkius.catalog.search('x')).rejects.toThrow(ProtocolError);
  });

  it('treats a body without a results array as a ProtocolError', async () => {
    const route: Route = {
      method: 'GET',
      path: /^\/marketplace\/search$/,
      respond: () => ({ body: { foo: 'bar' } }),
    };
    const { vinkius } = makeVinkius([route]);
    await expect(vinkius.catalog.search('x')).rejects.toThrow(ProtocolError);
  });
});
