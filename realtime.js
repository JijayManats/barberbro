const clients = new Map();

function addRealtimeClient(req, res) {
  res.status(200);
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  res.write(": connected\n\n");
  const cleanup = () => {
    clearInterval(heartbeat);
    clearTimeout(expirationTimer);
    clients.delete(res);
  };

  clients.set(res, cleanup);

  const heartbeat = setInterval(() => {
    if (res.destroyed || res.writableEnded) {
      cleanup();
      return;
    }

    try {
      res.write(": keep-alive\n\n");
    } catch (error) {
      cleanup();
      console.error("Realtime heartbeat failed:", error.message);
    }
  }, 20000);

  const expiresAt = Number(req.auth?.exp) * 1000;
  const remainingLifetime = expiresAt - Date.now();
  const expirationTimer = remainingLifetime > 0
    ? setTimeout(() => res.end(), remainingLifetime)
    : null;

  res.on("close", cleanup);
  res.on("finish", cleanup);
}

function publishDataUpdate() {
  for (const [client, cleanup] of clients) {
    if (client.destroyed || client.writableEnded) {
      cleanup();
      continue;
    }

    try {
      client.write("event: update\ndata: {}\n\n");
    } catch (error) {
      cleanup();
      console.error("Realtime update delivery failed:", error.message);
    }
  }
}

module.exports = {
  addRealtimeClient,
  publishDataUpdate,
};
