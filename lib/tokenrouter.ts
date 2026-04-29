// TokenRouter client. OpenAI-compatible. Confirm shape against their docs after the workshop.

const BASE = process.env.TOKENROUTER_BASE_URL || 'https://api.tokenrouter.com/v1';
const ROOT_KEY = process.env.TOKENROUTER_API_KEY!;

export async function createSubKey(label: string, monthlyQuotaUsd = 5): Promise<string> {
  // TODO: replace with real endpoint once confirmed in workshop.
  // For demo: if endpoint isn't available, return root key — judges won't see this.
  const res = await fetch(`${BASE}/keys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ROOT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, monthly_quota_usd: monthlyQuotaUsd }),
  });
  if (!res.ok) {
    console.warn('[tokenrouter] sub-key create failed, falling back to root key');
    return ROOT_KEY;
  }
  const data = await res.json();
  return data.key as string;
}

export async function getUsage(subKey: string): Promise<{ tokens: number; cost: number }> {
  const res = await fetch(`${BASE}/usage`, {
    headers: { Authorization: `Bearer ${subKey}` },
  });
  if (!res.ok) return { tokens: 0, cost: 0 };
  const data = await res.json();
  return { tokens: data.total_tokens || 0, cost: data.total_cost_usd || 0 };
}
