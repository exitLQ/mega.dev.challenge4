import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Digest } from '../src/digest/types.js';

const line = (o: Record<string, unknown>) => JSON.stringify(o);

const NORMAL =
  [
    line({ at: '2026-10-01T02:00:00+01:00', job: 'zeta-sync', status: 'ok', owner: 'ana' }),
    line({ at: '2026-10-01T02:05:00+01:00', job: 'alpha-backup', status: 'retry', owner: null }),
    line({ at: '2026-10-01T02:06:00+01:00', job: 'alpha-backup', status: 'retry', owner: null }),
    line({ at: '2026-10-01T02:07:00+01:00', job: 'alpha-backup', status: 'retry', owner: null }),
    line({ at: '2026-10-01T02:08:00+01:00', job: 'alpha-backup', status: 'ok', owner: null }),
    line({ at: '2026-10-01T02:10:00+01:00', job: 'mid-report', status: 'fail', owner: 'bo', error: 'boom' }),
    line({ at: '2026-10-01T02:11:00+01:00', job: 'quiet-clean', status: 'ok', owner: 'cy' }),
  ].join('\n') + '\n';

const BAD =
  [
    line({ at: '2026-10-02T02:00:00+01:00', job: 'good-one', status: 'ok', owner: 'ana' }),
    'this is not json',
    line({ at: '2026-10-02T02:01:00+01:00', job: 'good-two', status: 'ok', owner: 'bo' }),
  ].join('\n') + '\n';

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  writeFileSync(join(tmp, '2026-10-01.jsonl'), NORMAL);
  writeFileSync(join(tmp, '2026-10-02.jsonl'), BAD);
  writeFileSync(join(tmp, '2026-10-03.jsonl'), '');
  app = createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir: tmp,
  });
});

const rowFor = (html: string, job: string) => html.split('<tr').find((r) => r.includes(job)) ?? '';

describe('GET /digest/:night', () => {
  it('lists the jobs and marks warn rows', async () => {
    const res = await app.request('/digest/2026-10-01');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<table');
    for (const j of ['alpha-backup', 'mid-report', 'quiet-clean', 'zeta-sync']) expect(html).toContain(j);
    expect(rowFor(html, 'alpha-backup')).toContain('class="warn"'); // 3 retries
    expect(rowFor(html, 'mid-report')).toContain('class="warn"'); // last status fail
    expect(rowFor(html, 'quiet-clean')).not.toContain('class="warn"');
    expect(rowFor(html, 'zeta-sync')).not.toContain('class="warn"');
  });

  it('says nothing ran for an empty file', async () => {
    const res = await app.request('/digest/2026-10-03');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('is 404 when there is no file', async () => {
    expect((await app.request('/digest/2026-10-09')).status).toBe(404);
  });

  it('reports bad lines', async () => {
    const res = await app.request('/digest/2026-10-02');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('bad lines: 1');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the Digest', async () => {
    const res = await app.request('/api/digest/2026-10-01');
    expect(res.status).toBe(200);
    const d = (await res.json()) as Digest;
    expect(d.night).toBe('2026-10-01');
    expect(d.badLines).toBe(0);
    expect(d.counts).toEqual({ ok: 3, retry: 3, fail: 1 });
    expect(d.rows.map((r) => r.job)).toEqual(['alpha-backup', 'mid-report', 'quiet-clean', 'zeta-sync']);
    expect(d.rows[0]).toMatchObject({ job: 'alpha-backup', retries: 3, runs: 4, lastStatus: 'ok', owner: null });
  });

  it('is 404 with a JSON error when there is no file', async () => {
    const res = await app.request('/api/digest/2026-10-09');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: '2026-10-09' });
  });

  it('gives no rows for an empty file', async () => {
    const res = await app.request('/api/digest/2026-10-03');
    expect(res.status).toBe(200);
    expect(((await res.json()) as Digest).rows).toEqual([]);
  });

  it('counts a bad line and keeps the other rows', async () => {
    const d = (await (await app.request('/api/digest/2026-10-02')).json()) as Digest;
    expect(d.badLines).toBe(1);
    expect(d.rows.map((r) => r.job)).toEqual(['good-one', 'good-two']);
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order', async () => {
    const d = (await (await app.request('/api/digest/2026-10-01')).json()) as Digest;
    const html = await (await app.request('/digest/2026-10-01')).text();
    const positions = d.rows.map((r) => html.indexOf(r.job));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
