import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const weberPennMode = process.argv.includes("--weber-penn");
const appPort = Number(process.env.PROCPLANTS_PRODUCTION_DAG_SMOKE_PORT ?? 4199);
const debugPort = Number(process.env.PROCPLANTS_PRODUCTION_DAG_SMOKE_DEBUG_PORT ?? 9249);
const chromeCandidates = process.platform === "win32"
  ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const chrome = await Promise.any(chromeCandidates.map(async (candidate) => {
  await access(candidate);
  return candidate;
})).catch(() => null);
if (!chrome) throw new Error("Chrome or Edge is required for the production DAG browser smoke test");

const waitForJson = async (url, timeoutMs = 60_000) => {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${url}: ${String(lastError ?? "not ready")}`);
};

const waitForOk = async (url, timeoutMs = 60_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Preview may not have bound its socket yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
};

const profile = await mkdtemp(join(tmpdir(), "procplants-production-dag-browser-"));
const preview = spawn(process.execPath, [
  join(root, "node_modules", "vite", "bin", "vite.js"),
  "preview", "--host", "127.0.0.1", "--port", String(appPort),
], { cwd: root, stdio: "ignore", windowsHide: true });
let browser;
try {
  await waitForOk(`http://127.0.0.1:${appPort}/`);
  browser = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--disable-crashpad", "--no-first-run", "--disable-extensions",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    weberPennMode
      ? `http://127.0.0.1:${appPort}/?p=oakCanopy&s=oakCanopy&seed=807026&d=0.02`
      : `http://127.0.0.1:${appPort}/?p=understoryShrub&s=understoryShrub&seed=807026&d=0.15`,
  ], { stdio: "ignore", windowsHide: true });
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json`);
  const target = targets.find((entry) => entry.type === "page" && entry.url.includes(String(appPort)));
  assert.ok(target?.webSocketDebuggerUrl, "headless browser page target must be available");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let commandId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const callback = pending.get(message.id);
    if (callback) {
      pending.delete(message.id);
      callback(message);
    }
  });
  const command = (method, params = {}) => new Promise((resolvePromise) => {
    const id = ++commandId;
    pending.set(id, resolvePromise);
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command("Page.enable");
  await command("Runtime.enable");
  let stableDocuments = 0;
  for (let attempt = 0; attempt < 100 && stableDocuments < 3; attempt++) {
    const probe = await command("Runtime.evaluate", {
      expression: "({ ready: document.readyState, href: location.href })",
      returnByValue: true,
    });
    const value = probe.result?.result?.value;
    stableDocuments = !probe.error && value?.ready === "complete" && String(value?.href ?? "").includes(String(appPort))
      ? stableDocuments + 1
      : 0;
    if (stableDocuments < 3) await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  assert.equal(stableDocuments, 3);
  const evaluated = await command("Runtime.evaluate", {
    expression: `
      (async () => {
        const weberPennMode = ${JSON.stringify(weberPennMode)};
        const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
        const app = document.querySelector('#app');
        const triangles = () => Number(document.querySelector('#triangles').textContent.replaceAll(',', ''));
        const waitForIdle = async () => {
          for (let i = 0; i < 180 && document.querySelector('#regenerate')?.disabled; i++) await wait(100);
          for (let i = 0; i < 180 && app?.dataset.heroLodPending !== 'false'; i++) await wait(100);
          await wait(350);
        };
        await waitForIdle();
        const baselineTriangles = triangles();
        document.querySelector('#inspectGraph').click();
        for (let i = 0; i < 180 && !document.querySelector('.graph-node-editor'); i++) await wait(100);
        const rowFor = (stage) => [...document.querySelectorAll('.graph-node-list > li')]
          .find((entry) => entry.querySelector('.graph-node small')?.textContent?.startsWith(stage));
        let foliage = rowFor('foliage');
        const seedLabel = [...foliage.querySelectorAll('label')].find((label) => label.textContent.includes('stage seed'));
        const seedInput = seedLabel.querySelector('input');
        seedInput.value = '1234';
        seedInput.dispatchEvent(new Event('change', { bubbles: true }));
        for (let i = 0; i < 180 && app.dataset.productionDagPath !== 'typed-artifacts'; i++) await wait(100);
        await waitForIdle();
        const seededTriangles = triangles();
        const seededHash = app.dataset.productionDagHash;
        const seededArtifacts = Number(app.dataset.productionDagArtifacts);

        let rewiredTriangles = seededTriangles;
        let rewiredHash = seededHash;
        if (!weberPennMode) {
          foliage = rowFor('foliage');
          const dependencySelect = foliage.querySelector('.graph-dependency-editor select');
          const branchingOption = [...dependencySelect.options].find((option) => option.textContent === 'Branch hierarchy');
          dependencySelect.value = branchingOption.value;
          [...foliage.querySelectorAll('.graph-dependency-editor button')]
            .find((button) => button.textContent === 'Remove input').click();
          await waitForIdle();
          rewiredTriangles = triangles();
          rewiredHash = app.dataset.productionDagHash;
        }

        let exportedBlob = null;
        const originalCreateObjectUrl = URL.createObjectURL;
        const originalAnchorClick = HTMLAnchorElement.prototype.click;
        URL.createObjectURL = (blob) => { exportedBlob = blob; return 'blob:production-dag-smoke'; };
        HTMLAnchorElement.prototype.click = () => {};
        document.querySelector('#exportJson').click();
        for (let i = 0; i < 180 && !exportedBlob; i++) await wait(100);
        const exported = JSON.parse(await exportedBlob.text());
        URL.createObjectURL = originalCreateObjectUrl;
        HTMLAnchorElement.prototype.click = originalAnchorClick;

        document.querySelector('.graph-editor-actions button').click();
        for (let i = 0; i < 180 && app.dataset.productionDagPath !== 'legacy-canonical'; i++) await wait(100);
        await waitForIdle();
        return {
          baselineTriangles,
          seededTriangles,
          rewiredTriangles,
          resetTriangles: triangles(),
          seededHash,
          rewiredHash,
          seededArtifacts,
          pathAfterReset: app.dataset.productionDagPath,
          exportPath: exported.authoring.productionDag?.path,
          exportRecords: exported.authoring.productionDag?.records?.length,
          exportExecuted: exported.authoring.productionDag?.records?.filter((record) => record.status === 'executed').length,
          exportSeedRecord: exported.authoring.productionDag?.records?.find((record) => record.stage === 'foliage')?.seed,
          exportFoliageArtifactKind: exported.authoring.productionDag?.records?.find((record) => record.stage === 'foliage')?.artifactKind,
          overrideKinds: exported.authoring.generatorOverrides.map((operation) => operation.op),
          foliageDependencies: exported.authoring.generatorGraph.nodes.find((node) => node.stage === 'foliage')?.dependsOn,
        };
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(evaluated.exceptionDetails, undefined, evaluated.exceptionDetails?.text);
  const result = evaluated.result?.result?.value;
  assert.equal(result.exportPath, "typed-artifacts");
  assert.equal(result.exportRecords, 9);
  assert.equal(result.exportExecuted, 8);
  assert.equal(result.exportSeedRecord, 1234);
  assert.equal(result.seededArtifacts, 8);
  assert.ok(result.overrideKinds.includes("set-seed"));
  if (weberPennMode) {
    assert.equal(result.exportFoliageArtifactKind, "weber-penn-parts");
    assert.ok(result.seededTriangles > 0 && result.baselineTriangles > 0,
      "both canonical and typed Weber-Penn browser paths must render geometry");
    assert.equal(result.foliageDependencies.length, 2);
  } else {
    assert.notEqual(result.seededTriangles, result.baselineTriangles, "independent foliage seed must change live typed output");
    assert.notEqual(result.rewiredTriangles, result.seededTriangles, "removing the branching input must change live typed output");
    assert.notEqual(result.seededHash, result.rewiredHash);
    assert.ok(result.overrideKinds.includes("remove-dependency"));
    assert.ok(result.overrideKinds.includes("set-parent-scope"));
    assert.equal(result.foliageDependencies.length, 1);
  }
  assert.equal(result.resetTriangles, result.baselineTriangles, "reset must restore exact canonical live triangles");
  assert.equal(result.pathAfterReset, "legacy-canonical");
  console.log(JSON.stringify(result));
  socket.close();
} finally {
  const stop = async (processHandle) => {
    if (!processHandle || processHandle.exitCode !== null) return;
    const exited = new Promise((resolvePromise) => processHandle.once("exit", resolvePromise));
    processHandle.kill();
    await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))]);
  };
  await stop(browser);
  await stop(preview);
  await rm(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 }).catch(() => {});
}
