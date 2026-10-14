import { describe, expect, it, vi } from 'vitest';
import { OverageError, QuotaError, RateLimitError } from '../src';
import { RuntimeClient } from '../src/core/runtime';
import { DEFAULT_RETRY } from '../src/core/retry';

/** A RuntimeClient whose fetch answers `tools/call` with a fixed JSON-RPC result. */
function makeClient(result: unknown): RuntimeClient {
  const fetchImpl = vi.fn(
    async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof globalThis.fetch;

  return new RuntimeClient('http://localhost:9090/vk_live_test/mcp', {
    timeoutMs: 5000,
    retry: { ...DEFAULT_RETRY, maxRetries: 0 },
    fetch: fetchImpl,
    userAgent: 'test',
  });
}

/** A runtime gate block, as the tool pipeline emits it. */
function blocked(kind: string, text: string, upgradeUrl?: string) {
  const structuredContent: Record<string, unknown> = { vinkius_block: kind };
  if (upgradeUrl) structuredContent.upgrade_url = upgradeUrl;
  return {
    content: [{ type: 'text', text }],
    isError: true,
    structuredContent,
  };
}

describe('RuntimeClient — vinkius_block sentinel', () => {
  it('maps a plan-quota block to a QuotaError carrying the upgrade URL', async () => {
    const client = makeClient(blocked('quota', 'VINKIUS SUBSCRIPTION REQUIRED…', 'https://cloud.vinkius.com/settings/upgrade'));
    const err = (await client.callTool('t', {}).catch((e: unknown) => e)) as QuotaError;
    expect(err).toBeInstanceOf(QuotaError);
    expect(err.code).toBe('quota_exceeded');
    expect(err.upgradeUrl).toBe('https://cloud.vinkius.com/settings/upgrade');
    expect(err.message).toContain('VINKIUS SUBSCRIPTION REQUIRED');
  });

  it('maps an overage block to an OverageError', async () => {
    const client = makeClient(blocked('overage', 'PAYMENT REQUIRED — OVERAGE CHARGE DECLINED', 'https://cloud.vinkius.com/billing'));
    const err = (await client.callTool('t', {}).catch((e: unknown) => e)) as OverageError;
    expect(err).toBeInstanceOf(OverageError);
    expect(err.code).toBe('overage_blocked');
    expect(err.upgradeUrl).toBe('https://cloud.vinkius.com/billing');
  });

  it('maps a circuit-breaker block to a RateLimitError', async () => {
    const client = makeClient(blocked('circuit_breaker', '[SYSTEM] CRITICAL: budget ceiling exceeded'));
    await expect(client.callTool('t', {})).rejects.toBeInstanceOf(RateLimitError);
  });

  it('leaves a read-only preview block in-band (no typed error)', async () => {
    const client = makeClient(blocked('preview', 'Tool execution requires a production token.'));
    const res = await client.callTool('t', {});
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ vinkius_block: 'preview' });
  });

  it('leaves an ordinary upstream tool failure in-band (no sentinel)', async () => {
    const client = makeClient({
      content: [{ type: 'text', text: 'upstream returned 500' }],
      isError: true,
    });
    const res = await client.callTool('t', {});
    expect(res.isError).toBe(true);
  });
});
