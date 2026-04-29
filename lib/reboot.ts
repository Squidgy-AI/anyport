// Reboot.dev client. Stubbed — fill in real endpoints after the 12:45 workshop.
// Goal: deploy a chat-app with our system prompt + tools, return install URL for Claude.

const BASE = process.env.REBOOT_BASE_URL || 'https://api.reboot.dev';
const KEY = process.env.REBOOT_API_KEY!;

export interface RebootDeployInput {
  agentId: string;
  name: string;
  systemPrompt: string;
  tools: Array<{ name: string; url: string }>;
  tokenRouterKey: string;
  model: string;
}

export interface RebootDeployResult {
  appId: string;
  installUrl: string;
}

export async function deployMcpApp(input: RebootDeployInput): Promise<RebootDeployResult> {
  // Real shape TBD from workshop. The fallback below lets the rest of the app be built/tested today.
  try {
    const res = await fetch(`${BASE}/apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.name,
        slug: input.agentId,
        runtime: 'mcp-chat',
        config: {
          system_prompt: input.systemPrompt,
          tools: input.tools,
          model: input.model,
          inference: {
            provider: 'tokenrouter',
            api_key: input.tokenRouterKey,
            base_url: process.env.TOKENROUTER_BASE_URL,
          },
        },
      }),
    });
    if (!res.ok) throw new Error(`reboot deploy failed: ${res.status}`);
    const data = await res.json();
    return { appId: data.app_id, installUrl: data.install_url };
  } catch (err) {
    console.warn('[reboot] deploy failed, falling back to self-hosted chat', err);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3040';
    return {
      appId: `local-${input.agentId}`,
      installUrl: `${appUrl}/agent/${input.agentId}`,
    };
  }
}
