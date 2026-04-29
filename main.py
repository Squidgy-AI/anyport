import os
from pathlib import Path
from openai import OpenAI

env_path = Path(__file__).parent / ".env.local"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())

client = OpenAI(
    base_url=os.environ.get("TOKENROUTER_BASE_URL", "https://api.tokenrouter.com/v1"),
    api_key=os.environ["TOKENROUTER_API_KEY"],
)

response = client.chat.completions.create(
    model="z-ai/glm-5.1",
    messages=[
        {"role": "system", "content": "Talk like a pirate."},
        {
            "role": "user",
            "content": "How do I check if a Python object is an instance of a class?",
        },
    ],
)

print(response.choices[0].message.content)
