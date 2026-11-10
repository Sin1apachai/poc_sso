if (window.parent !== window) {
  window.parent.postMessage({ type: "sso-complete" }, document.body.dataset.controlOrigin);
} else {
  window.location.replace("/");
}
