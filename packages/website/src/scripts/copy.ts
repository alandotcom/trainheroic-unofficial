function copyText(text: string, button: HTMLButtonElement): void {
  const done = (): void => {
    button.classList.add("is-copied");
    button.setAttribute("aria-label", "Copied");
    window.setTimeout(() => {
      button.classList.remove("is-copied");
      button.setAttribute("aria-label", "Copy to clipboard");
    }, 2000);
  };

  if (navigator.clipboard?.writeText) {
    void (async () => {
      try {
        await navigator.clipboard.writeText(text);
        done();
      } catch {
        fallback();
      }
    })();
    return;
  }

  fallback();

  function fallback(): void {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.append(area);
    area.select();
    try {
      document.execCommand("copy");
      done();
    } finally {
      area.remove();
    }
  }
}

function bindCopyButtons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) => {
    if (button.dataset.copyBound === "true") return;
    button.dataset.copyBound = "true";

    button.addEventListener("click", () => {
      const host = button.closest<HTMLElement>("[data-copy-source]");
      const source = host?.querySelector<HTMLElement>("[data-copy-text]");
      if (!source) return;
      copyText(source.textContent?.trim() ?? "", button);
    });
  });
}

bindCopyButtons();
document.addEventListener("astro:page-load", () => bindCopyButtons());
