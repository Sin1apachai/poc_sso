const responseForm = document.getElementById("sso-response");
if (responseForm) {
  const frame = document.querySelector('iframe[name="kc-handoff"]');
  const appOrigin = new URL(responseForm.dataset.fallback).origin;
  const timer = setTimeout(() => window.location.replace(responseForm.dataset.fallback), 12000);
  window.addEventListener("message", (event) => {
    if (
      event.origin === appOrigin &&
      event.source === frame.contentWindow &&
      event.data?.type === "sso-complete"
    ) {
      clearTimeout(timer);
      window.location.replace(appOrigin + "/");
    }
  });
  responseForm.submit();
}
