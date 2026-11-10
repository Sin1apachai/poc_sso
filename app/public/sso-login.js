(() => {
  const link = document.querySelector("[data-sso-link]");
  if (!link) {
    return;
  }
  const status = document.getElementById("sso-connection-status");
  let checking = false;
  const unavailable = "ไม่สามารถเชื่อมต่อ SSO ได้ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ";
  function attach(modal) {
    modal.addEventListener("close", () => modal.remove());
    modal.showModal();
  }
  const existing = document.getElementById("sso-unavailable");
  if (existing) {
    attach(existing);
  }
  function showError(text) {
    if (document.getElementById("sso-unavailable")) {
      return;
    }
    const modal = document.createElement("dialog");
    modal.id = "sso-unavailable";
    const title = document.createElement("h2");
    title.textContent = "SSO ไม่พร้อมใช้งาน";
    const message = document.createElement("p");
    message.textContent = text;
    const form = document.createElement("form");
    form.method = "dialog";
    const button = document.createElement("button");
    button.textContent = "ตกลง";
    button.autofocus = true;
    form.append(button);
    modal.append(title, message, form);
    document.body.append(modal);
    attach(modal);
  }
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    if (checking) {
      return;
    }
    checking = true;
    link.setAttribute("aria-disabled", "true");
    status.textContent = "กำลังเชื่อมต่อ SSO กรุณารอสักครู่ (ครั้งที่ 1/3)";
    let polling = false;
    const timer = setInterval(async () => {
      if (polling) {
        return;
      }
      polling = true;
      try {
        const response = await fetch("/sso/connectivity", {
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok) {
          const value = await response.json();
          if (checking && value.status === "checking") {
            status.textContent =
              "กำลังเชื่อมต่อ SSO กรุณารอสักครู่ (ครั้งที่ " + value.attempts + "/3)";
          }
        }
      } catch {
      } finally {
        polling = false;
      }
    }, 750);
    try {
      const csrf = document.querySelector('form[action="/login"] input[name="csrf"]').value;
      const response = await fetch("/sso/preflight", {
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrf }),
        signal: AbortSignal.timeout(25000),
      });
      if (response.status === 403) {
        status.textContent = "กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง";
        showError("แบบฟอร์มหมดอายุ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง");
        return;
      }
      if (!response.ok) {
        throw new Error("SSO unavailable");
      }
      const result = await response.json();
      if (!result.available || typeof result.authorizationUrl !== "string") {
        throw new Error("SSO unavailable");
      }
      status.textContent = "เชื่อมต่อ SSO สำเร็จ กำลังยืนยันตัวตน";
      window.location.assign(result.authorizationUrl);
    } catch {
      status.textContent = "SSO ไม่พร้อมใช้งานในขณะนี้ ยังสามารถ Login ปกติได้";
      showError(unavailable);
    } finally {
      clearInterval(timer);
      checking = false;
      link.removeAttribute("aria-disabled");
    }
  });
})();
