import { observe, type PerformanceObserver, type Phase } from '../performance.js';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { z } from 'zod';
import { AppError } from '../domain.js';
import type { ProviderFailure } from '../room-contract.js';

/** Preserve only allowlisted RPC metadata; provider prose/data may contain private input. */
export class RpcRejectionError extends AppError {
  readonly diagnostic: ProviderFailure;
  constructor(method: string, error: unknown) {
    const safeMethod: ProviderFailure['method'] = ['initialize', 'config/read', 'thread/start', 'thread/resume', 'turn/start'].includes(method) ? method as ProviderFailure['method'] : 'other';
    super('RPC_ERROR', `App-server rejected ${safeMethod}.`);
    const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const message = typeof value.message === 'string' && value.message.length <= 200 ? value.message : '';
    const sessionMethod = safeMethod === 'thread/start' || safeMethod === 'thread/resume';
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    const reason: ProviderFailure['reason'] = sessionMethod && new RegExp(`^thread ${uuid} already has an active writer$`, 'i').test(message) ? 'active-writer' :
      sessionMethod && new RegExp(`^no rollout found for thread id ${uuid}$`, 'i').test(message) ? 'thread-not-found' : 'rejected';
    this.diagnostic = { provider: 'codex', method: safeMethod, reason,
      ...(typeof value.code === 'number' && Number.isSafeInteger(value.code) ? { rpcCode: value.code } : {}) };
  }
  beforeTurnSubmission() {
    this.diagnostic.turnRequestSent = false;
    this.message = this.diagnostic.reason === 'active-writer' ? 'Codex 工作階段被其他程序占用；本次回合尚未送出，請重建工作階段。' :
      this.diagnostic.reason === 'thread-not-found' ? 'Codex 工作階段不存在；本次回合尚未送出，請重建工作階段。' :
        'Codex 工作階段建立或恢復遭拒；本次回合尚未送出，請重建工作階段。';
  }
}

export type ProcessSpec = { executable: string; args: string[]; cwd: string; signal: AbortSignal; env?: NodeJS.ProcessEnv; observePerformance?: PerformanceObserver | undefined; startedPhase?: Phase };
export interface JsonConnection {
  send(value: unknown): void;
  endInput(text?: string): void;
  next(): Promise<unknown>;
  finish(): Promise<void>;
  close(): Promise<void>;
}
export type ProcessFactory = (spec: ProcessSpec) => JsonConnection;
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const MAX_QUEUE_BYTES = 8 * 1024 * 1024;
const rpcMessage = z.object({
  id: z.union([z.number(), z.string()]).optional(), method: z.string().optional(),
  params: z.unknown().optional(), result: z.unknown().optional(), error: z.unknown().optional(),
});

export class JsonLineProcess implements JsonConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private queue: Array<{ value: unknown; bytes: number }> = [];
  private queueBytes = 0;
  private waiter: { resolve: (value: unknown) => void; reject: (error: Error) => void } | undefined;
  private failure: Error | undefined;
  private ended = false;
  private readonly exited: Promise<void>;
  private readonly abort: () => void;
  private terminating: Promise<void> | undefined;

  constructor(private readonly spec: ProcessSpec) {
    spec.signal.throwIfAborted();
    this.child = spawn(spec.executable, spec.args, {
      cwd: spec.cwd, stdio: 'pipe', shell: false, windowsHide: true, env: spec.env ?? process.env,
      detached: process.platform !== 'win32',
    });
    this.child.once('spawn', () => observe(spec.observePerformance, spec.startedPhase ?? 'inferenceStarted'));
    this.exited = new Promise((resolve) => this.child.once('close', (code) => {
      this.ended = true;
      if (code !== 0) this.fail(new AppError('PROCESS_EXIT', 'Agent process did not exit successfully.'));
      else if (this.buffer.trim()) this.fail(new AppError('INVALID_JSON', 'Agent output ended with an incomplete JSON line.'));
      else this.waiter?.reject(new AppError('PROCESS_CLOSED', 'Agent output ended before a complete result.'));
      this.waiter = undefined;
      resolve();
    }));
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.receive(chunk));
    // Stderr may contain credentials or complete prompts. Drain it without logging it.
    this.child.stderr.resume();
    this.child.on('error', () => this.fail(new AppError('PROCESS_START', 'Could not start the configured agent executable.')));
    this.child.stdin.on('error', () => this.fail(new AppError('PROCESS_INPUT', 'Agent input pipe failed.')));
    this.abort = () => {
      this.fail(new AppError('CANCELLED', 'Agent request cancelled.'));
      void this.terminate();
    };
    spec.signal.addEventListener('abort', this.abort, { once: true });
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.queue = [];
    this.queueBytes = 0;
    this.buffer = '';
    this.waiter?.reject(this.failure);
    this.waiter = undefined;
    void this.terminate();
  }

  private terminate(): Promise<void> {
    if (this.terminating) return this.terminating;
    if (!this.child.pid || (process.platform === 'win32' && (this.ended || this.child.exitCode !== null))) return Promise.resolve();
    const pid = this.child.pid;
    this.terminating = process.platform === 'win32' ? new Promise<void>((resolve) => {
      // This PID belongs to our still-live ChildProcess. Kill its tree before the parent exits.
      execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 4_000 }, () => { if (!this.ended) this.child.kill(); resolve(); });
    }) : this.terminateGroup(pid);
    return this.terminating;
  }

  private async terminateGroup(pid: number): Promise<void> {
    const signal = (value: NodeJS.Signals | 0): boolean => {
      try { process.kill(-pid, value); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
    };
    if (!signal('SIGTERM')) return;
    const deadline = Date.now() + 1_500;
    while (Date.now() < deadline) {
      if (!signal(0)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    // Descendants can retain stdio after their parent exits. Address our group, never the app's group.
    signal('SIGKILL');
  }

  private receive(chunk: string): void {
    if (this.failure) return;
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > MAX_BUFFER_BYTES) {
      this.fail(new AppError('OUTPUT_LIMIT', 'Agent output exceeded the line size limit.'));
      return;
    }
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const value: unknown = JSON.parse(line);
        if (this.waiter) {
          this.waiter.resolve(value);
          this.waiter = undefined;
        } else {
          const bytes = Buffer.byteLength(line);
          this.queue.push({ value, bytes });
          this.queueBytes += bytes;
          if (this.queue.length > 1_000 || this.queueBytes > MAX_QUEUE_BYTES) {
            this.fail(new AppError('OUTPUT_LIMIT', 'Agent output queue exceeded its limit.'));
            return;
          }
        }
      } catch {
        this.fail(new AppError('INVALID_JSON', 'Agent emitted invalid JSON.'));
        return;
      }
    }
  }

  send(value: unknown): void {
    if (this.failure) throw this.failure;
    if (this.ended) throw new AppError('PROCESS_CLOSED', 'Agent process is closed.');
    this.child.stdin.write(JSON.stringify(value) + '\n');
  }

  endInput(text = ''): void { this.child.stdin.end(text); }

  async next(): Promise<unknown> {
    if (this.failure) throw this.failure;
    if (this.queue.length) {
      const item = this.queue.shift()!;
      this.queueBytes -= item.bytes;
      return item.value;
    }
    if (this.ended) throw new AppError('PROCESS_CLOSED', 'Agent output ended before a complete result.');
    if (this.waiter) throw new Error('Concurrent reads are not supported.');
    return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
  }

  async finish(): Promise<void> {
    await this.exited;
    if (this.failure) throw this.failure;
  }

  async close(): Promise<void> {
    this.spec.signal.removeEventListener('abort', this.abort);
    await this.terminate();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([this.exited, new Promise<void>((_, reject) => {
      timer = setTimeout(() => {
        if (process.platform !== 'win32' && this.child.pid) {
          try { process.kill(-this.child.pid, 'SIGKILL'); } catch { /* The owned group may already have exited. */ }
        } else this.child.kill('SIGKILL');
        reject(new AppError('PROCESS_STUCK', 'Owned agent process did not exit; session cannot be reused.'));
      }, 5_000);
    })]).finally(() => { if (timer) clearTimeout(timer); });
  }
}

export class RpcConnection {
  private id = 0;
  private notifications: Array<{ method: string; params: unknown }> = [];
  private notificationBytes = 0;
  constructor(private readonly connection: JsonConnection) {}
  notify(method: string, params?: unknown): void { this.connection.send({ method, params }); }

  private async read(): Promise<z.infer<typeof rpcMessage>> {
    const parsed = rpcMessage.safeParse(await this.connection.next());
    if (!parsed.success) throw new AppError('INVALID_PROTOCOL', 'Invalid app-server envelope.');
    const message = parsed.data;
    if (message.method && message.id !== undefined) {
      // No agent-initiated approval, tool execution or user interaction is authorized here.
      this.connection.send({ id: message.id, error: { code: -32601, message: 'CandC does not authorize server-initiated actions.' } });
      throw new AppError('UNEXPECTED_ACTION', 'Agent requested an action outside the no-tool policy.');
    }
    return message;
  }

  async request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.id;
    this.connection.send({ id, method, params });
    while (true) {
      const message = await this.read();
      if (message.id === id) {
        if (message.error !== undefined) throw new RpcRejectionError(method, message.error);
        return message.result;
      }
      if (message.method) {
        const notification = { method: message.method, params: message.params };
        this.notifications.push(notification);
        this.notificationBytes += Buffer.byteLength(JSON.stringify(notification));
      }
      if (this.notifications.length > 1_000 || this.notificationBytes > MAX_QUEUE_BYTES) {
        this.notifications = [];
        this.notificationBytes = 0;
        throw new AppError('OUTPUT_LIMIT', 'App-server notification queue exceeded its limit.');
      }
    }
  }

  async next(): Promise<{ method: string; params: unknown }> {
    const buffered = this.notifications.shift();
    if (buffered) {
      this.notificationBytes -= Buffer.byteLength(JSON.stringify(buffered));
      return buffered;
    }
    const message = await this.read();
    if (!message.method) throw new AppError('INVALID_PROTOCOL', 'Unexpected app-server response.');
    return { method: message.method, params: message.params };
  }
}
