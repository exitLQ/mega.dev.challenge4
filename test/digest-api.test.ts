import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/read.js';
import type { Digest } from '../src/digest/types.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

describe('GET /api/digest/:night', () => {
  it('returns 200 with the jobs in readNight order', async () => {
    const res = await createApp(config).request('/api/digest/2026-10-28');
    expect(res.status).toBe(200);
    const digest = (await res.json()) as Digest;
    const expected = readNight('runs', '2026-10-28');
    expect(digest.rows.length).toBeGreaterThan(0);
    expect(digest.rows.map((r) => r.job)).toEqual(expected?.rows.map((r) => r.job));
  });

  it('404s for a night without a log', async () => {
    const res = await createApp(config).request('/api/digest/2020-01-01');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: '2020-01-01' });
  });
});
