import "./style.css";

const app = document.querySelector<HTMLElement>("#app");

if (!app) throw new Error("Procplants requires an #app mount point.");

app.dataset.bootState = "loading";
app.innerHTML = `
  <section class="app-loading" role="status" aria-live="polite">
    <strong>Loading Procplants</strong>
    <span>Preparing the procedural plant lab…</span>
  </section>
`;

void import("./main")
  .then(() => {
    app.dataset.bootState = "ready";
  })
  .catch((error: unknown) => {
    app.dataset.bootState = "error";
    app.innerHTML = `
      <section class="app-loading app-loading-error" role="alert">
        <strong>Procplants could not start</strong>
        <span>Reload the page to try again.</span>
      </section>
    `;
    console.error("[procplants] Lab bootstrap failed.", error);
  });
