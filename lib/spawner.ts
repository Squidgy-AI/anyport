/**
 * Spawns one Reboot DurableMCP server + one cloudflared tunnel per published agent.
 *
 * Each agent gets:
 *  - a unique port (allocated by the OS, then captured)
 *  - its own SYSTEM_PROMPT/MODEL/AGENT_ID env
 *  - a public https://*.trycloudflare.com/mcp install URL
 *
 * For demo-from-laptop: this all runs on the dev machine. Process orphans
 * survive Anyport restart but are leaked; for hackathon scope that's fine.
 */
import { spawn, ChildProcess } from 'node:child_process';
import { mkdtempSync, openSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { supabase } from '@/lib/supabase';

const MCP_DIR = process.env.ANYPORT_MCP_DIR || `${process.cwd()}/mcp`;
const PORT_BASE = 9991;

interface SpawnInput {
  agentId: string;
  agentName?: string;
  systemPrompt: string;
  model: string;
  tokenRouterApiKey: string;
  anyportUsageUrl: string;
  webhookUrl?: string | null;
}

interface SpawnResult {
  port: number;
  rbtPid: number;
  tunnelUrl: string;
  tunnelPid: number;
}

async function nextPort(): Promise<number> {
  // Persist across Next.js restarts: pick max(stored port) + 1. Falls back to
  // PORT_BASE+1 if no agents exist yet. Survives spawner restarts because the
  // long-lived rbt processes retain their port records in the DB.
  const { data } = await supabase
    .from('anyport_agents')
    .select('port')
    .not('port', 'is', null)
    .order('port', { ascending: false })
    .limit(1);
  const max = data?.[0]?.port ?? PORT_BASE;
  return max + 1;
}

async function tailForUrl(
  path: string,
  timeoutMs: number,
  re: RegExp = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf-8');
      const m = content.match(re);
      if (m) return m[1] || m[0];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for tunnel URL in ${path}`);
}

async function killExisting(processName: string): Promise<void> {
  return new Promise((resolve) => {
    const k = spawn('pkill', ['-9', '-f', processName], { stdio: 'ignore' });
    k.on('exit', () => setTimeout(resolve, 1000));
  });
}

async function waitFor(re: RegExp, child: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const m = buf.match(re);
      if (m) {
        cleanup();
        resolve(m[0]);
      }
    };
    const onExit = () => {
      cleanup();
      reject(new Error(`process exited before matching ${re}; output:\n${buf.slice(-500)}`));
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error(`timed out waiting for ${re}; output:\n${buf.slice(-500)}`));
    };
    const cleanup = () => {
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
      child.off('exit', onExit);
      clearTimeout(timer);
    };
    const timer = setTimeout(onTimeout, timeoutMs);
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', onExit);
  });
}

export async function spawnAgent(input: SpawnInput): Promise<SpawnResult> {
  const port = await nextPort();

  // Each agent gets its own state directory so multiple instances don't clobber each other.
  const stateDir = mkdtempSync(join(tmpdir(), `anyport-${input.agentId}-`));

  const rbtArgs = [
    'run',
    'rbt',
    `--state-directory=${stateDir}`,
    'dev',
    'run',
    '--no-chaos',
    `--port=${port}`,
    `--env=SYSTEM_PROMPT=${input.systemPrompt}`,
    `--env=MODEL=${input.model}`,
    `--env=TOKENROUTER_API_KEY=${input.tokenRouterApiKey}`,
    `--env=AGENT_ID=${input.agentId}`,
    `--env=AGENT_NAME=${input.agentName || input.agentId}`,
    `--env=ANYPORT_USAGE_URL=${input.anyportUsageUrl}`,
    ...(input.webhookUrl ? [`--env=WEBHOOK_URL=${input.webhookUrl}`] : []),
    ...(process.env.DEMO_USER_ID ? [`--env=SQUIDGY_USER_ID=${process.env.DEMO_USER_ID}`] : []),
  ];

  // Use `script` to provide a TTY (rbt's chaos-monkey reader requires one).
  const rbt = spawn('script', ['-q', '/dev/null', 'uv', ...rbtArgs], {
    cwd: MCP_DIR,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitFor(/Application is serving traffic/, rbt, 90_000);
  rbt.unref();

  // ngrok handles routing. Free tier gives one static URL per account; we kill
  // any prior ngrok and point the fresh one at this rbt's port. The install
  // URL is therefore stable across publishes (only the agent behind it changes).
  await killExisting('ngrok');
  const tunnelLog = join(stateDir, 'ngrok.log');
  const logFd = openSync(tunnelLog, 'a');
  const tunnel = spawn('ngrok', ['http', `http://localhost:${port}`, '--log=stdout'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  tunnel.unref();
  const tunnelUrl = await tailForUrl(
    tunnelLog,
    30_000,
    /url=(https:\/\/[a-z0-9-]+\.ngrok-free\.[a-z]+)/,
  );

  return {
    port,
    rbtPid: rbt.pid!,
    tunnelUrl,
    tunnelPid: tunnel.pid!,
  };
}
