import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join, resolve } from 'node:path';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
import { loadStaticHtml } from '../lib/static-file-loader.js';
import { LandingPageError } from '../lib/landing-errors.js';

const mockedRead = readFile as unknown as ReturnType<typeof vi.fn>;

describe('loadStaticHtml', () => {
  const originalEnv = process.env.LANDING_STATIC_DIR;
  const baseDir = resolve(join(process.cwd(), 'test-landings'));

  beforeEach(() => {
    process.env.LANDING_STATIC_DIR = baseDir;
    mockedRead.mockReset();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.LANDING_STATIC_DIR;
    else process.env.LANDING_STATIC_DIR = originalEnv;
  });

  it('rejects path traversal with ..', async () => {
    await expect(loadStaticHtml('../../etc/passwd')).rejects.toMatchObject({
      code: 'STATIC_FILE_NOT_FOUND',
    });
    expect(mockedRead).not.toHaveBeenCalled();
  });

  it('rejects absolute traversal escaping base dir', async () => {
    await expect(loadStaticHtml('../outside.html')).rejects.toBeInstanceOf(
      LandingPageError,
    );
  });

  it('reads valid file within base dir', async () => {
    mockedRead.mockResolvedValueOnce('<html>ok</html>');
    const html = await loadStaticHtml('ems-zada-pater.html');
    expect(html).toBe('<html>ok</html>');
    expect(mockedRead).toHaveBeenCalledTimes(1);
    const calledPath = mockedRead.mock.calls[0]?.[0] as string;
    expect(calledPath.startsWith(baseDir)).toBe(true);
  });

  it('throws STATIC_FILE_NOT_FOUND on ENOENT', async () => {
    const err: NodeJS.ErrnoException = new Error('not found');
    err.code = 'ENOENT';
    mockedRead.mockRejectedValueOnce(err);
    await expect(loadStaticHtml('missing.html')).rejects.toMatchObject({
      code: 'STATIC_FILE_NOT_FOUND',
    });
  });
});
