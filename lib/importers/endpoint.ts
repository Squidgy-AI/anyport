// T1 — BYO Endpoint Adapter.
//
// Importer for "I have an HTTP endpoint that takes chat input and returns a
// response. Wrap it as an Anyport agent." The endpoint stays the brain;
// Anyport adds metering, hosting, and Squidgy distribution on top.

import type { EndpointConfig, ProbeResult } from '../types';
import { autodetectTextPath, extractByPath } from './index';

export interface ProbeInput {
  url: string;
  method?: 'POST' | 'GET';
  auth?: EndpointConfig['auth'];
  authSecret?: string; // plaintext only at probe time; never persisted here
  request?: Partial<EndpointConfig['request']>;
  response?: Partial<EndpointConfig['response']>;
  // probe message — defaults to "ping"
  sample?: string;
}

const PROBE_TIMEOUT_MS = 15_000;

function buildHeaders(auth: EndpointConfig['auth'] | undefined, authSecret?: string): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!auth || auth.kind === 'none') return h;
  if (auth.kind === 'bearer' && authSecret) {
    h.Authorization = `Bearer ${authSecret}`;
  } else if (auth.kind === 'header' && authSecret) {
    h[auth.name] = authSecret;
  }
  return h;
}

function buildBody(messageField: string, message: string, extra?: Record<string, unknown>): string {
  const body: Record<string, unknown> = { ...(extra || {}), [messageField || 'message']: message };
  return JSON.stringify(body);
}

export async function probe(input: ProbeInput): Promise<ProbeResult & { resolvedTextPath?: string }> {
  if (!input.url) return { ok: false, message: 'url is required' };
  if (!/^https?:\/\//i.test(input.url)) {
    return { ok: false, message: 'url must start with http:// or https://' };
  }

  const method = input.method || 'POST';
  const headers = buildHeaders(input.auth, input.authSecret);
  const messageField = input.request?.messageField || 'message';
  const sample = input.sample || 'ping';
  const body = method === 'POST' ? buildBody(messageField, sample, input.request?.extra) : undefined;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(input.url, {
      method,
      headers,
      body,
      signal: ctrl.signal,
    });
  } catch (err: any) {
    return { ok: false, message: `network error: ${err?.message || String(err)}` };
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return { ok: false, message: `endpoint returned ${resp.status}: ${text.slice(0, 200)}` };
  }

  const ct = resp.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    const text = await resp.text();
    // We allow plain-text responses — text body itself is the message.
    if (text.trim().length === 0) {
      return { ok: false, message: 'endpoint returned empty body' };
    }
    return {
      ok: true,
      message: 'plain-text response detected (text body is the assistant message)',
      sample: text.slice(0, 500),
      resolvedTextPath: '',
    };
  }

  const json = await resp.json().catch(() => null);
  if (json == null) {
    return { ok: false, message: 'endpoint returned malformed JSON' };
  }

  const requestedPath = input.response?.textPath;
  if (requestedPath) {
    const v = extractByPath(json, requestedPath);
    if (typeof v !== 'string' || v.trim().length === 0) {
      return {
        ok: false,
        message: `response path "${requestedPath}" did not resolve to a non-empty string`,
        sample: json,
      };
    }
    return {
      ok: true,
      message: `extracted assistant text from "${requestedPath}"`,
      sample: json,
      resolvedTextPath: requestedPath,
    };
  }

  const detected = autodetectTextPath(json);
  if (!detected) {
    return {
      ok: false,
      message: 'could not autodetect a text field — supply response.textPath explicitly',
      sample: json,
    };
  }
  return {
    ok: true,
    message: `autodetected assistant text at "${detected}"`,
    sample: json,
    resolvedTextPath: detected,
  };
}

export async function invoke(
  config: EndpointConfig,
  message: string,
  authSecret?: string,
  context?: { sessionId?: string; userId?: string },
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const method = config.method || 'POST';
  const headers = buildHeaders(config.auth, authSecret);
  const messageField = config.request.messageField || 'message';

  const extra: Record<string, unknown> = { ...(config.request.extra || {}) };
  if (config.request.userField && context?.userId) extra[config.request.userField] = context.userId;
  if (config.request.sessionField && context?.sessionId) extra[config.request.sessionField] = context.sessionId;

  const body = method === 'POST' ? buildBody(messageField, message, extra) : undefined;

  let resp: Response;
  try {
    resp = await fetch(config.url, { method, headers, body });
  } catch (err: any) {
    return { ok: false, error: `network error: ${err?.message || String(err)}` };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return { ok: false, error: `${resp.status}: ${text.slice(0, 200)}` };
  }

  const ct = resp.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    const text = await resp.text();
    return { ok: true, text: text.trim() };
  }

  const json = await resp.json().catch(() => null);
  if (json == null) return { ok: false, error: 'malformed JSON response' };

  const path = config.response.textPath;
  if (!path) {
    if (typeof json === 'string') return { ok: true, text: json };
    return { ok: false, error: 'no textPath configured and response is not a string' };
  }
  const v = extractByPath(json, path);
  if (typeof v !== 'string') {
    return { ok: false, error: `path "${path}" did not resolve to a string` };
  }
  return { ok: true, text: v };
}
