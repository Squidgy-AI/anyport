# Anyport MCP chat-app for Reboot Cloud.
FROM ghcr.io/reboot-dev/reboot-base:0.40.1

WORKDIR /app

COPY requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY .rbtrc .rbtrc
COPY main.py main.py

# Reboot Cloud sets PORT in the runtime env; rbt serve run picks it up.
CMD ["rbt", "serve", "run"]
