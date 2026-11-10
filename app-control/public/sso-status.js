(() => {
  const panel = document.getElementById("sso-panel");
  if (!panel) {
    return;
  }
  const label = document.getElementById("sso-status");
  const note = document.getElementById("sso-status-note");
  const modal = document.getElementById("sso-modal");
  const message = document.getElementById("sso-modal-message");
  const retry = document.getElementById("sso-retry");
  const pending = ["checking", "ready", "redirecting"];
  let state = { status: panel.dataset.status, attempts: 0, message: panel.dataset.message },
    inFlight = false,
    leaving = false,
    failedNotified = false;
  const waiting = "กำลังสร้าง SSO session กรุณารอสักครู่";
  const failed = "ไม่สามารถสร้าง SSO session ได้ กรุณาลองเชื่อมต่อใหม่หรือติดต่อผู้ดูแลระบบ";
  function show(text) {
    message.textContent = text;
    if (!modal.open) {
      modal.showModal();
    }
  }
  function render() {
    retry.disabled = pending.includes(state.status);
    label.textContent = state.label;
    note.textContent = state.note || "";
    note.hidden = !state.note;
    retry.textContent = state.buttonLabel;
    if (state.status === "failed" && !failedNotified) {
      failedNotified = true;
      show(state.message || failed);
    }
    if (state.status === "ready" && !leaving) {
      leaving = true;
      document.getElementById("sso-continue").requestSubmit();
    }
  }
  async function refresh() {
    const response = await fetch("/sso/status", {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error("Status unavailable");
    }
    const fresh = await response.json();
    const formToken = document.querySelector('#sso-continue input[name="csrf"]').value;
    if (fresh.csrf !== formToken) {
      // Another tab signed in or rotated the session. Reload the identity and forms together.
      leaving = true;
      window.location.replace("/");
      return { status: "reloading" };
    }
    state = fresh;
    render();
    return state;
  }
  async function poll() {
    if (inFlight || leaving) {
      return;
    }
    inFlight = true;
    try {
      await refresh();
    } catch {
      label.textContent = "ตรวจสอบสถานะ SSO ไม่ได้ กรุณาลองใหม่";
    } finally {
      inFlight = false;
      if (!leaving) {
        setTimeout(poll, pending.includes(state.status) ? 1000 : 10000);
      }
    }
  }
  document.querySelectorAll("[data-system-link]").forEach((link) =>
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        await refresh();
        if (leaving) {
          return;
        }
        if (state.status === "success") {
          window.location.assign(link.href);
          return;
        }
        show(state.message || (pending.includes(state.status) ? waiting : failed));
      } catch {
        show("ตรวจสอบสถานะ SSO ไม่ได้ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ");
      }
    }),
  );
  if (panel.dataset.notice === "1") {
    show(state.message || (pending.includes(state.status) ? waiting : failed));
  }
  poll();
})();
