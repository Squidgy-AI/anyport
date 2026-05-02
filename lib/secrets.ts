// Per-PRD: encrypted-at-rest auth secrets for imported agents.
// Phase 1 — envelope encryption with a key from process.env.ANYPORT_SECRET_KEY.
// Phase 2 — migrate to Supabase Vault or external KMS.
//
// Format: iv (16) | ciphertext | authTag (16), all stored in `encrypted_value` bytea.

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { nanoid } from 'nanoid';
import { supabase } from './supabase';

const ALGO = 'aes-256-gcm';

function key(): Buffer {
  const raw = process.env.ANYPORT_SECRET_KEY;
  if (!raw) throw new Error('ANYPORT_SECRET_KEY not set — required for storing import secrets');
  // Accept either 32 raw bytes hex (64 chars) or any string ≥ 32 chars (hashed-trimmed).
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  if (raw.length < 32) {
    throw new Error('ANYPORT_SECRET_KEY must be 64 hex chars (32 bytes) or a string ≥ 32 chars');
  }
  return Buffer.from(raw.slice(0, 32), 'utf8');
}

export async function storeSecret(agentId: string, plaintext: string): Promise<string> {
  const id = `sec_${nanoid(16)}`;
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([iv, enc, tag]);

  const { error } = await supabase
    .from('anyport_secrets')
    .insert({ id, agent_id: agentId, encrypted_value: blob });
  if (error) throw new Error(`failed to store secret: ${error.message}`);
  return id;
}

export async function readSecret(secretId: string): Promise<string> {
  const { data, error } = await supabase
    .from('anyport_secrets')
    .select('encrypted_value')
    .eq('id', secretId)
    .single();
  if (error || !data) throw new Error('secret not found');

  // Supabase returns bytea as a hex-prefixed string ('\x...') in the JS client.
  const raw = data.encrypted_value as string | Buffer;
  let blob: Buffer;
  if (Buffer.isBuffer(raw)) {
    blob = raw;
  } else if (typeof raw === 'string' && raw.startsWith('\\x')) {
    blob = Buffer.from(raw.slice(2), 'hex');
  } else {
    blob = Buffer.from(raw as any);
  }

  const iv = blob.subarray(0, 16);
  const tag = blob.subarray(blob.length - 16);
  const enc = blob.subarray(16, blob.length - 16);

  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
