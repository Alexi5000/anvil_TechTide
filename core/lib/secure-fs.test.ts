// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, statSync, symlinkSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPrivateTempDir, writeFileAtomic, writeFileAtomicSync, writeFileExclusiveSync, readFileWithStat, readFileIfExistsSync } from './secure-fs';

const dirs: string[] = [];
function scratch() { const dir = mkdtempSync(join(tmpdir(), 'anvil-fs-test-')); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true}); });
describe('agent state filesystem operations', () => {
  it('creates isolated owner-only temporary directories', () => {
    const root = scratch();
    const one = createPrivateTempDir('agent-', root);
    const two = createPrivateTempDir('agent-', root);
    expect(one).not.toBe(two);
    expect(statSync(one).mode & 0o777).toBe(0o700);
  });
  it('replaces complete state and preserves private permissions', async () => {
    const root = scratch(); const target = join(root, 'state.json');
    writeFileSync(target, '{}'); chmodSync(target, 0o600);
    writeFileAtomicSync(target, '{"status":"working"}');
    expect(JSON.parse(readFileSync(target, 'utf8')).status).toBe('working');
    await writeFileAtomic(target, '{"status":"complete"}');
    expect(JSON.parse(readFileSync(target, 'utf8')).status).toBe('complete');
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(readdirSync(root)).toEqual(['state.json']);
  });
  it('does not overwrite existing paths with exclusive creation', () => {
    const root = scratch(); const target = join(root, 'secret'); const link = join(root, 'link');
    writeFileSync(target, 'keep'); symlinkSync(target, link);
    expect(writeFileExclusiveSync(link, 'replace')).toBe(false);
    expect(readFileSync(target, 'utf8')).toBe('keep');
    expect(writeFileExclusiveSync(join(root, 'new'), 'new', 0o600)).toBe(true);
  });
  it('retains intentional symlink destinations for state updates', () => {
    const root = scratch(); const target = join(root, 'state'); const link = join(root, 'link');
    writeFileSync(target, 'old'); symlinkSync(target, link);
    writeFileAtomicSync(link, 'new');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('new');
  });
  it('reads metadata and content from a single open handle', async () => {
    const root = scratch(); const target = join(root, 'state');
    writeFileSync(target, 'state');
    const result = await readFileWithStat(target);
    expect(result?.content?.toString()).toBe('state');
    expect(result?.stat.size).toBe(5);
    expect((await readFileWithStat(root))?.content).toBeNull();
    expect(readFileIfExistsSync(join(root, 'missing'))).toBeNull();
  });
});
