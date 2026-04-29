import { NextResponse } from 'next/server';

/**
 * Generate an image from a prompt.
 *
 * Tries HF Z-Image-Turbo space first (per brief). Falls back to
 * Pollinations.ai (no auth, instant) if the HF call fails or times out.
 *
 * Returns a publicly-loadable image URL the chat page can <img src=...>.
 */
export async function POST(req: Request) {
  const { prompt } = await req.json();
  if (!prompt || typeof prompt !== 'string') {
    return NextResponse.json({ error: 'prompt required' }, { status: 400 });
  }

  const hfToken = process.env.HF_TOKEN;
  if (hfToken) {
    try {
      // HF Inference API for any text-to-image model. Z-Image-Turbo space
      // route — if it 404s we fall back. Returns image bytes directly.
      const resp = await fetch(
        'https://api-inference.huggingface.co/models/Tongyi-Zhiwen/Z-Image-Turbo',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inputs: prompt }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (resp.ok) {
        const ct = resp.headers.get('content-type') || '';
        if (ct.startsWith('image/')) {
          const buf = Buffer.from(await resp.arrayBuffer());
          const dataUrl = `data:${ct};base64,${buf.toString('base64')}`;
          return NextResponse.json({ url: dataUrl, source: 'hf' });
        }
      }
    } catch (e) {
      // fall through to Pollinations
    }
  }

  // Pollinations fallback. Always works, no auth, instant. Returns a URL the
  // browser can render directly — the service generates on first GET.
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?seed=${seed}&width=1024&height=1024&nologo=true`;
  return NextResponse.json({ url, source: 'pollinations' });
}
