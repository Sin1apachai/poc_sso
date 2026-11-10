// Serialize acceptance and logout for the same central user in this single-process PoC.
const pending = new Map();
async function withUserLock(sub, work) {
  const previous = pending.get(sub) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  pending.set(sub, current);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (pending.get(sub) === current) {
      pending.delete(sub);
    }
  }
}
module.exports = { withUserLock };
