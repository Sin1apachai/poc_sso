const modal = document.getElementById("access-denied");
if (modal) {
  modal.addEventListener("close", () => modal.remove());
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      if (modal.open) {
        modal.close();
      }
      modal.remove();
    }
  });
  modal.showModal();
}
