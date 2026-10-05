import { describe, it, expect, vi } from 'vitest';
import { providerStatus, type CliProbeResult } from '../src/environment.js';

const success = (output: string): CliProbeResult => ({ ok: true, missing: false, output });
describe('CLI readiness diagnostics without real provider execution', () => {
  it('passes observation hooks through existing version/login probes without adding commands', async () => {
    const phases: string[] = [], commands: string[][] = [];
    const result = await providerStatus('codex', async (_executable, args, observer) => {
      commands.push(args); observer?.('loginProcessStarted');
      return success(args[0] === '--version' ? '0.160.0' : 'Logged in using ChatGPT');
    }, phase => phases.push(phase));
    expect(result.ready).toBe(true); expect(commands).toEqual([['--version'], ['login', 'status']]);
    expect(phases).toEqual(['loginProcessStarted', 'loginProcessStarted']);
  });
  it.each(['codex', 'claude', 'gemini', 'grok'] as const)('distinguishes absent %s from launch failure and never exposes raw process output', async provider => {
    const missing = vi.fn(async () => ({ ok: false, missing: true, output: 'secret=private-value' }));
    expect(await providerStatus(provider, missing)).toMatchObject({ state: 'missing', ready: false, validated: false, version: null });
    expect(missing).toHaveBeenCalledTimes(1);
    const failed = await providerStatus(provider, async () => ({ ok: false, missing: false, output: 'failure 9.9.9 secret=private-value' }));
    expect(failed).toMatchObject({ state: 'start-failed', ready: false, version: null });
    expect(JSON.stringify(failed)).not.toContain('private-value');
  });
  it('rejects unknown and unvalidated versions before inspecting login', async () => {
    for (const text of ['unrecognized output', 'codex 9.9.9']) {
      const probe = vi.fn(async () => success(text));
      expect(await providerStatus('codex', probe)).toMatchObject({ state: 'unverified', ready: false });
      expect(probe).toHaveBeenCalledTimes(1);
    }
  });
  it.each(['gemini', 'grok'] as const)('keeps installed %s unverified until native authentication and tool policy are tested', async provider => {
    const probe = vi.fn(async () => success('version 1.2.3'));
    expect(await providerStatus(provider, probe)).toMatchObject({ version: '1.2.3', state: 'unverified', ready: false, validated: false });
    expect(probe).toHaveBeenCalledTimes(1);
  });
  it('recognizes the Codex login command nonzero not-logged-in result without confusing it with a launch failure', async () => {
    const probe = vi.fn(async (_, args: string[]) => args[0] === '--version' ? success('codex-cli 0.160.0') : { ok: false, missing: false, output: 'Not logged in' });
    expect(await providerStatus('codex', probe)).toMatchObject({ state: 'login-required', validated: true, ready: false, loginCommand: 'codex login' });
    expect(await providerStatus('codex', async (_, args) => args[0] === '--version' ? success('0.160.0') : success('Logged in using ChatGPT'))).toMatchObject({ state: 'ready', ready: true, reason: null });
  });
  it('recognizes Claude subscription authentication and keeps API login or unrecognized diagnostics unavailable', async () => {
    for (const [auth, expected] of [[{ loggedIn: false, authMethod: 'none' }, 'login-required'], [{ loggedIn: true, authMethod: 'api_key' }, 'login-required'], [{ loggedIn: true, authMethod: 'claude.ai' }, 'ready']] as const) {
      expect(await providerStatus('claude', async (_, args) => success(args[0] === '--version' ? '2.1.287 (Claude Code)' : JSON.stringify(auth)))).toMatchObject({ state: expected, ready: expected === 'ready' });
    }
    expect(await providerStatus('claude', async (_, args) => args[0] === '--version' ? success('2.1.287') : { ok: false, missing: false, output: 'secret=auth-check-error' })).toMatchObject({ state: 'auth-check-failed', ready: false });
  });
});
