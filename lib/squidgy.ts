import fs from 'fs/promises';
import path from 'path';

// Path to a directory of Squidgy-style agent configs (each subdir contains
// system_prompt.md + config.yaml). Set SQUIDGY_AGENTS_DIR in .env.local.
const AGENTS_DIR = process.env.SQUIDGY_AGENTS_DIR || '';

const SKIP = new Set(['shared', 'admin', 'README.md', '.DS_Store']);

export interface SquidgyAgent {
  id: string;
  name: string;
  emoji: string;
  description: string;
  tagline: string;
  category: string;
  initialMessage: string;
  systemPrompt: string;
  webhookUrl: string | null;
  avatarUrl: string | null;
  enabled: boolean;
  adminOnly: boolean;
}

function field(yaml: string, key: string): string {
  const re = new RegExp(`^\\s{2,}${key}:\\s*['"]?([^'"\\n]*?)['"]?\\s*$`, 'm');
  const m = yaml.match(re);
  return m?.[1]?.trim() || '';
}

function bool(yaml: string, key: string): boolean {
  return field(yaml, key).toLowerCase() === 'true';
}

export async function listSquidgyAgents(): Promise<SquidgyAgent[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(AGENTS_DIR);
  } catch {
    return [];
  }

  const out: SquidgyAgent[] = [];
  for (const id of entries) {
    if (SKIP.has(id) || id.startsWith('.')) continue;
    const dir = path.join(AGENTS_DIR, id);
    let stat;
    try {
      stat = await fs.stat(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const promptPath = path.join(dir, 'system_prompt.md');
    const yamlPath = path.join(dir, 'config.yaml');

    const [systemPrompt, yaml] = await Promise.all([
      fs.readFile(promptPath, 'utf-8').catch(() => ''),
      fs.readFile(yamlPath, 'utf-8').catch(() => ''),
    ]);
    if (!systemPrompt || !yaml) continue;

    const enabled = bool(yaml, 'enabled');
    const adminOnly = bool(yaml, 'admin_only');
    if (!enabled || adminOnly) continue;

    const webhookMatch = yaml.match(/webhook_url:\s*['"]?([^'"\n]+)['"]?/);

    // YAML stores `avatar: /Squidgy AI Assistants Avatars/10.png`. Map that to
    // our locally-served /avatars/10.png copy.
    const avatarMatch = yaml.match(/^\s+avatar:\s*['"]?([^'"\n]+?)['"]?\s*$/m);
    let avatarUrl: string | null = null;
    if (avatarMatch) {
      const fname = avatarMatch[1].split('/').pop();
      if (fname) avatarUrl = `/avatars/${fname}`;
    }

    out.push({
      id,
      name: field(yaml, 'name') || id,
      emoji: field(yaml, 'emoji') || '🤖',
      description: field(yaml, 'description'),
      tagline: field(yaml, 'tagline'),
      category: field(yaml, 'category') || 'general',
      initialMessage: field(yaml, 'initial_message'),
      systemPrompt,
      webhookUrl: webhookMatch?.[1]?.trim() || null,
      avatarUrl,
      enabled,
      adminOnly,
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function getSquidgyAgent(id: string): Promise<SquidgyAgent | null> {
  const all = await listSquidgyAgents();
  return all.find((a) => a.id === id) || null;
}
