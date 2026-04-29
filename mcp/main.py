"""Anyport MCP chat-app.

Generic Reboot DurableMCP server. Exposes a `chat` tool that talks to the
configured agent.

If WEBHOOK_URL is set, chat is routed through the agent's live Squidgy n8n
workflow (with all its real tools, knowledge bases, and memory). Otherwise
it falls back to a direct TokenRouter call using SYSTEM_PROMPT.

The chat tool returns a TextContent + an EmbeddedResource (text/html). MCP
clients that render HTML resources (claude.ai web, claude desktop) show
clickable suggestion cards and inline images natively.
"""
import asyncio
import html as html_lib
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Sequence

import httpx
from mcp.types import EmbeddedResource, TextContent, TextResourceContents
from openai import AsyncOpenAI
from reboot.aio.applications import Application
from reboot.mcp.server import DurableContext, DurableMCP

SYSTEM_PROMPT = os.environ.get("SYSTEM_PROMPT", "You are a helpful assistant.")
MODEL = os.environ.get("MODEL", "openai/gpt-4o-mini")
TOKENROUTER_API_KEY = os.environ["TOKENROUTER_API_KEY"]
TOKENROUTER_BASE_URL = os.environ.get(
    "TOKENROUTER_BASE_URL", "https://api.tokenrouter.com/v1"
)
AGENT_ID = os.environ.get("AGENT_ID", "local")
ANYPORT_USAGE_URL = os.environ.get("ANYPORT_USAGE_URL")
WEBHOOK_URL = os.environ.get("WEBHOOK_URL")  # squidgy n8n webhook (optional)
SESSION_ID = f"anyport_{AGENT_ID}_{uuid.uuid4().hex[:8]}"
# REQUIRED — UUID of the Squidgy user whose connected accounts the agent
# acts for. No default; set SQUIDGY_USER_ID in env.
USER_ID = os.environ.get("SQUIDGY_USER_ID", "")


def _derive_agent_name() -> str:
    """The n8n workflow keys off `agent_name` matching the webhook slug.

    For Sophia: webhook is `/webhook/social_media_agent` → agent_name must be
    `social_media_agent`, NOT the agent.id `social_media`. Derive from the
    URL path so we can't get this wrong.
    """
    if WEBHOOK_URL:
        path = urllib.parse.urlparse(WEBHOOK_URL).path
        return path.rstrip("/").rsplit("/", 1)[-1]
    return os.environ.get("AGENT_NAME", AGENT_ID)


AGENT_NAME = _derive_agent_name()

client = AsyncOpenAI(base_url=TOKENROUTER_BASE_URL, api_key=TOKENROUTER_API_KEY)
mcp = DurableMCP(path="/mcp")


def _report_usage(prompt_tokens: int, completion_tokens: int, model: str | None = None) -> None:
    if not ANYPORT_USAGE_URL:
        return
    try:
        payload = {
            "agent_id": AGENT_ID,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "model": model or MODEL,
        }
        req = urllib.request.Request(
            ANYPORT_USAGE_URL,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=2).read()
    except (urllib.error.URLError, TimeoutError):
        pass


async def _chat_via_webhook(message: str) -> str:
    """Route chat through the agent's live Squidgy n8n workflow.

    Payload shape (verified against squidgy_updated_backend n8nService.ts):
      user_id, user_mssg, session_id, agent_name (webhook slug),
      timestamp_of_call_made, request_id, sending_from.
    """
    payload = {
        "user_id": USER_ID,
        "user_mssg": message,
        "session_id": SESSION_ID,
        "agent_name": AGENT_NAME,
        "timestamp_of_call_made": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        "request_id": uuid.uuid4().hex,
        "sending_from": "User",
    }
    parts: list[str] = []
    async with httpx.AsyncClient(timeout=120) as http:
        async with http.stream(
            "POST", WEBHOOK_URL, json=payload, headers={"Accept": "application/x-ndjson"}
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if obj.get("type") == "item":
                    parts.append(obj.get("content", ""))
    text = "".join(parts).strip()
    _report_usage(0, 0, model="squidgy/n8n")
    return text or "(no response from agent)"


async def _chat_via_tokenrouter(message: str) -> str:
    response = await client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": message},
        ],
    )
    content = response.choices[0].message.content or ""
    usage = getattr(response, "usage", None)
    if usage:
        _report_usage(usage.prompt_tokens, usage.completion_tokens)
    return content


CARD_RE = re.compile(r"\$\*\*(.+?)\*\*\$")
MD_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
MD_LINK_RE = re.compile(r"(?<!!)\[([^\]]+)\]\((https?://[^)\s]+)\)")
BARE_IMG_URL_RE = re.compile(
    r"(?<![\(\"'])\b(https?://\S+\.(?:png|jpe?g|gif|webp|svg)(?:\?\S*)?)",
    re.IGNORECASE,
)
IMAGE_HOST_RE = re.compile(
    r"\.(amazonaws\.com|cloudfront\.net|googleusercontent\.com|imgur\.com|"
    r"unsplash\.com|cloudinary\.com|pollinations\.ai|templated\.io)",
    re.IGNORECASE,
)
MD_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
EQ_CLEAR_RE = re.compile(r"=clear=", re.IGNORECASE)


def _looks_like_image_url(url: str) -> bool:
    """Heuristic: image-extension or known image-CDN host."""
    if re.search(r"\.(png|jpe?g|gif|webp|svg)(\?|$)", url, re.IGNORECASE):
        return True
    if IMAGE_HOST_RE.search(url):
        return True
    return False


def _upgrade_image_links(text: str) -> str:
    """Promote `[label](image-url)` and bare image URLs to markdown images so
    every MCP client renders them inline regardless of Sophia's wording."""

    def link_repl(m: re.Match) -> str:
        label, url = m.group(1), m.group(2)
        if _looks_like_image_url(url):
            return f"![{label}]({url})"
        return m.group(0)

    text = MD_LINK_RE.sub(link_repl, text)

    # Bare image URLs not already inside a markdown image
    def bare_repl(m: re.Match) -> str:
        url = m.group(1)
        return f"![image]({url})"

    return BARE_IMG_URL_RE.sub(bare_repl, text)


def _markdown_to_safe_html(text: str) -> str:
    """Best-effort markdown → HTML for the resource. Escapes everything first
    then re-injects images and bold. Newlines become <br>.
    """
    safe = html_lib.escape(text)
    # Re-inject images: ![alt](url) → <img>
    def img_repl(m: re.Match) -> str:
        alt = m.group(1)
        url = m.group(2)
        return f'<img src="{html_lib.escape(url)}" alt="{html_lib.escape(alt)}" loading="lazy" />'

    # Note: we already escaped the source; the regex matches the escaped
    # markdown form (the brackets/parens survive html.escape).
    safe = MD_IMAGE_RE.sub(img_repl, safe)
    # **bold** → <strong>
    safe = MD_BOLD_RE.sub(r"<strong>\1</strong>", safe)
    safe = safe.replace("\n", "<br>")
    return safe


def _render_html(body: str, cards: list[str]) -> str:
    body_html = _markdown_to_safe_html(body)
    cards_html = ""
    if cards:
        items = "".join(
            f'<button class="card" data-msg="{html_lib.escape(c)}">{html_lib.escape(c)}</button>'
            for c in cards
        )
        cards_html = f'<div class="cards">{items}</div>'
    return (
        '<!doctype html><html><head><meta charset="utf-8"><style>'
        "body{margin:0;padding:16px;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"
        "color:#e8e8ec;background:#15151b;border-radius:8px}"
        ".body{padding:12px 14px;background:#15211a;border:1px solid #2a4a35;border-radius:8px;white-space:pre-wrap}"
        ".body img{max-width:100%;border-radius:6px;margin:8px 0;display:block}"
        ".cards{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}"
        ".card{padding:8px 14px;background:#241a3a;border:1px solid #4a3a7a;color:#d8c8ff;"
        "border-radius:999px;font-size:13px;cursor:pointer;font-family:inherit}"
        ".card:hover{background:#2e2148;border-color:#5d4894}"
        "strong{color:#fff}"
        "</style></head><body>"
        f'<div class="body">{body_html}</div>'
        f"{cards_html}"
        "<script>"
        "document.querySelectorAll('.card').forEach(b=>b.addEventListener('click',()=>{"
        "var msg=b.dataset.msg;"
        "try{window.parent.postMessage({type:'mcp-ui:invoke-tool',payload:{tool:'chat',args:{message:msg}}},'*');}catch(e){}"
        "try{window.parent.postMessage({type:'tool',tool:'chat',args:{message:msg}},'*');}catch(e){}"
        "b.disabled=true;b.style.opacity=0.5;"
        "}));"
        "</script></body></html>"
    )


@mcp.tool()
async def chat(
    message: str, context: DurableContext
) -> Sequence[TextContent | EmbeddedResource]:
    """Talk to this agent. Returns a text reply plus a rich HTML resource
    with clickable suggestion cards and inline images for clients that render
    HTML resources (claude.ai, claude desktop)."""
    try:
        if WEBHOOK_URL:
            raw = await _chat_via_webhook(message)
        else:
            raw = await _chat_via_tokenrouter(message)
    except Exception as e:
        raw = (
            f"(webhook error: {e}; falling back)\n\n"
            + await _chat_via_tokenrouter(message)
        )

    # Sophia's workflow emits `=clear=` between thinking and final answer.
    # Drop everything before the last clear marker so the body is just the
    # delivered response.
    if EQ_CLEAR_RE.search(raw):
        raw = EQ_CLEAR_RE.split(raw)[-1].strip()

    # Promote any image-bearing links to markdown images so they render
    # inline in every MCP client (text-block embeds AND HTML resource).
    raw = _upgrade_image_links(raw)

    cards = [m.group(1).strip() for m in CARD_RE.finditer(raw)]
    body = CARD_RE.sub("", raw).strip()

    plain = body
    if cards:
        plain += "\n\nOptions:\n" + "\n".join(f"  • {c}" for c in cards)

    html = _render_html(body, cards)
    resource = EmbeddedResource(
        type="resource",
        resource=TextResourceContents(
            uri=f"ui://anyport/{AGENT_ID}/{uuid.uuid4().hex[:8]}",
            mimeType="text/html",
            text=html,
        ),
    )
    return [TextContent(type="text", text=plain), resource]


async def main() -> None:
    await mcp.application().run()


if __name__ == "__main__":
    asyncio.run(main())
