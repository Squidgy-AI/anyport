// Central registry of inbound importers. Each module exports `probe()` and
// `invoke()` (for endpoint-style) or `introspect()` and `callTool()` (for
// MCP-style). PRD: docs/PRD_INBOUND_IMPORT.md.

export * as endpoint from './endpoint';
export * as mcp from './mcp';

// Resolve a value at a dot-path within an arbitrary JSON value.
// E.g. extractByPath({a:{b:'x'}}, 'a.b') → 'x'.
// Numeric segments index arrays.
export function extractByPath(obj: unknown, dotPath: string): unknown {
  if (!dotPath) return obj;
  const parts = dotPath.split('.');
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur) && /^\d+$/.test(p)) {
      cur = cur[Number(p)];
    } else if (typeof cur === 'object') {
      cur = cur[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

// Best-effort autodetect of where the assistant text lives in a JSON response.
// Returns a path string suitable for extractByPath. Used by the endpoint importer
// when the user doesn't supply one explicitly.
const COMMON_PATHS = [
  'response',
  'message',
  'output',
  'text',
  'content',
  'reply',
  'answer',
  'data.response',
  'data.message',
  'data.output',
  'choices.0.message.content',
  'choices.0.text',
];

export function autodetectTextPath(body: unknown): string | null {
  for (const p of COMMON_PATHS) {
    const v = extractByPath(body, p);
    if (typeof v === 'string' && v.trim().length > 0) return p;
  }
  // Fall back to looking for the first string value in the body's top level.
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length > 0) return k;
    }
  }
  return null;
}
