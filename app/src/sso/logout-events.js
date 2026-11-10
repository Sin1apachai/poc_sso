const { pool } = require("../db/database");
const listeners = new Map();
function end(res) {
  if (!res.writableEnded) {
    res.write("event: logout\ndata: {}\n\n");
    res.end();
  }
}

async function listen(req, res) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  if (!req.session.sso) {
    return end(res);
  }
  const id = req.sessionID;
  const set = listeners.get(id) || new Set();
  set.add(res);
  listeners.set(id, set);
  res.on("close", () => {
    set.delete(res);
    if (!set.size) {
      listeners.delete(id);
    }
  });
  try {
    // Register before checking storage so an overlapping back-channel logout cannot be missed.
    const { rows } = await pool.query(
      "SELECT sid FROM session WHERE sid=$1 AND sess->'sso' IS NOT NULL",
      [id],
    );
    if (!rows[0]) {
      return end(res);
    }
    if (!res.writableEnded) {
      res.write(": listening\n\n");
    }
  } catch {
    res.end();
  }
}

function notify(id) {
  for (const res of listeners.get(id) || []) {
    end(res);
  }
  listeners.delete(id);
}
module.exports = { listen, notify };
