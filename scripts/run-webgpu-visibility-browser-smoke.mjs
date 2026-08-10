import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const requestedDebugPort = process.env.PROCPLANTS_WEBGPU_DEBUG_PORT;
const debugPort = requestedDebugPort
  ? Number(requestedDebugPort)
  : await new Promise((resolvePort, rejectPort) => {
      const probe = createServer();
      probe.once("error", rejectPort);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        assert.ok(address && typeof address === "object");
        probe.close((error) => error ? rejectPort(error) : resolvePort(address.port));
      });
    });
const defaultChromeCandidates = process.platform === "win32"
  ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const chromeCandidates = process.env.PROCPLANTS_WEBGPU_BROWSER
  ? [process.env.PROCPLANTS_WEBGPU_BROWSER, ...defaultChromeCandidates]
  : defaultChromeCandidates;
let chrome = null;
for (const candidate of chromeCandidates) {
  try {
    await access(candidate);
    chrome = candidate;
    break;
  } catch {
    // Try the next deterministic candidate.
  }
}
if (!chrome) throw new Error("Chrome or Edge is required for the WebGPU visibility smoke test");

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
]);
const serverRequests = [];
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/") {
      response.writeHead(200, { "content-type": contentTypes.get(".html") });
      response.end('<!doctype html><title>procplants WebGPU smoke</title><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>');
      serverRequests.push({ pathname, status: 200 });
      return;
    }
    const path = resolve(root, `.${decodeURIComponent(pathname)}`);
    const relativePath = relative(root, path);
    const normalizedRelativePath = relativePath.replaceAll("\\", "/");
    const allowedThree = normalizedRelativePath.startsWith("node_modules/three/build/") && normalizedRelativePath.endsWith(".js");
    if (relativePath.startsWith("..") || (relativePath.split(/[\\/]/)[0] !== "dist-lib" && !allowedThree)) {
      response.writeHead(404).end();
      serverRequests.push({ pathname, status: 404, relativePath });
      return;
    }
    const data = await readFile(path);
    response.writeHead(200, { "content-type": contentTypes.get(extname(path)) ?? "application/octet-stream" });
    response.end(data);
    serverRequests.push({ pathname, status: 200 });
  } catch (error) {
    response.writeHead(404).end();
    serverRequests.push({ pathname: request.url ?? "", status: 404, error: error instanceof Error ? error.message : String(error) });
  }
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
assert.ok(address && typeof address === "object");
const port = address.port;
const profile = await mkdtemp(join(tmpdir(), "procplants-webgpu-smoke-"));
let browser;
const gpuFlags = process.platform === "win32"
  ? ["--enable-unsafe-webgpu", "--enable-features=WebGPU", "--enable-dawn-features=allow_unsafe_apis"]
  : ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer", "--use-angle=vulkan"];

const waitForJson = async (url, timeoutMs = 20_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Chrome may still be opening its debugging socket.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
};

try {
  browser = spawn(chrome, [
    "--headless=new",
    ...gpuFlags,
    "--no-first-run",
    "--disable-extensions",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    `http://127.0.0.1:${port}/`,
  ], { stdio: "ignore", windowsHide: true });
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json`);
  const target = targets.find((entry) => entry.type === "page" && entry.url.includes(String(port)));
  assert.ok(target?.webSocketDebuggerUrl, "headless browser page target must be available");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener("open", resolveOpen, { once: true });
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
  const command = (method, params = {}) => new Promise((resolveCommand) => {
    const id = ++commandId;
    pending.set(id, resolveCommand);
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command("Runtime.enable");
  const expression = `
    (async () => {
      if (!navigator.gpu) return { available: false, reason: 'navigator.gpu unavailable' };
      const adapter = await navigator.gpu.requestAdapter() ?? await navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
      if (!adapter) return { available: false, reason: 'requestAdapter returned null' };
      const device = await adapter.requestDevice();
      const core = await import('/dist-lib/core.js');
      const webgpu = await import('/dist-lib/webgpu.js');
      const centers = new Float32Array([0, 0, 0, 5, 0, 0, 20, 0, 0]);
      const clusters = core.buildProcPlantVisibilityClusters(
        { centers, radii: new Float32Array([0.1, 0.1, 0.1]) },
        { cellSize: 4, maxInstancesPerCluster: 2 },
      );
      const lodDistances = [0, 3, 8];
      const draws = Array.from({ length: 3 }, () => ({ indexCount: 3, firstIndex: 0, baseVertex: 0 }));
      const view = core.createProcPlantVisibilityView([
        1, 0, 0, 10, -1, 0, 0, 10,
        0, 1, 0, 10, 0, -1, 0, 10,
        0, 0, 1, 10, 0, 0, -1, 10,
      ], [0, 0, 0], 12);
      const plan = webgpu.createProcPlantWebGpuVisibilityPlan(clusters, lodDistances, draws, { limits: device.limits });
      const reference = webgpu.referenceProcPlantWebGpuVisibility(clusters, lodDistances, draws, view);
      const runtime = await webgpu.createProcPlantWebGpuVisibilityRuntime(device, plan, { label: 'browser smoke' });
      const drawEncoder = webgpu.createProcPlantWebGpuIndexedIndirectDrawEncoder(runtime);

      device.pushErrorScope('validation');
      const renderModule = device.createShaderModule({ code: \`
        struct DrawParams { compactedOffset: u32, _padding0: u32, _padding1: u32, _padding2: u32 };
        struct VertexOutput { @builtin(position) position: vec4<f32>, @location(0) color: vec3<f32> };
        @group(0) @binding(0) var<storage, read> visibilityOutput: array<u32>;
        @group(0) @binding(1) var<uniform> drawParams: DrawParams;
        @vertex fn vertexMain(
          @builtin(vertex_index) vertexIndex: u32,
          @builtin(instance_index) instanceIndex: u32,
        ) -> VertexOutput {
          let placement = visibilityOutput[drawParams.compactedOffset + instanceIndex];
          let x = -0.45 + f32(placement) * 0.9;
          var local = vec2<f32>(-0.16, -0.5);
          if (vertexIndex == 1u) { local = vec2<f32>(0.16, -0.5); }
          if (vertexIndex == 2u) { local = vec2<f32>(0.0, 0.5); }
          var output: VertexOutput;
          output.position = vec4<f32>(x + local.x, local.y, 0.0, 1.0);
          output.color = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), placement == 1u);
          return output;
        }
        @fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
          return vec4<f32>(input.color, 1.0);
        }
      \` });
      const renderPipelineDescriptor = {
        layout: 'auto',
        vertex: { module: renderModule, entryPoint: 'vertexMain' },
        fragment: { module: renderModule, entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' },
      };
      const renderPipeline = device.createRenderPipelineAsync
        ? await device.createRenderPipelineAsync(renderPipelineDescriptor)
        : device.createRenderPipeline(renderPipelineDescriptor);
      const indexBuffer = device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(indexBuffer, 0, new Uint16Array([0, 1, 2, 0]));
      const laneUniforms = [];
      const laneBindGroups = [];
      for (let lod = 0; lod < plan.lodCount; lod++) {
        const laneUniform = device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(laneUniform, 0, new Uint32Array([
          plan.offsets.output.lodInstanceIndices + lod * plan.instanceCount, 0, 0, 0,
        ]));
        laneUniforms.push(laneUniform);
        laneBindGroups.push(device.createBindGroup({
          layout: renderPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: runtime.buffers.output } },
            { binding: 1, resource: { buffer: laneUniform } },
          ],
        }));
      }
      const renderTexture = device.createTexture({
        size: { width: 64, height: 8 },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      const pixelReadback = device.createBuffer({
        size: 64 * 4 * 8,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const setupError = await device.popErrorScope();
      if (setupError) throw new Error(\`WebGPU render setup failed: \${setupError.message}\`);
      device.pushErrorScope('validation');
      const commandEncoder = device.createCommandEncoder({ label: 'procplants compute and indirect draw smoke' });
      runtime.encode(commandEncoder, view);
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: renderTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      drawEncoder.encode(renderPass, (binding) => {
        if (binding.firstInstance !== 0) throw new Error('portable indirect commands must use firstInstance=0');
        renderPass.setPipeline(renderPipeline);
        renderPass.setIndexBuffer(indexBuffer, 'uint16');
        renderPass.setBindGroup(0, laneBindGroups[binding.lod]);
      });
      renderPass.end();
      commandEncoder.copyTextureToBuffer(
        { texture: renderTexture },
        { buffer: pixelReadback, bytesPerRow: 256, rowsPerImage: 8 },
        { width: 64, height: 8 },
      );
      device.queue.submit([commandEncoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      const validationError = await device.popErrorScope();
      if (validationError) throw new Error(\`WebGPU render validation failed: \${validationError.message}\`);
      await pixelReadback.mapAsync(GPUMapMode.READ);
      const pixels = new Uint8Array(pixelReadback.getMappedRange());
      let redPixels = 0;
      let greenPixels = 0;
      for (let pixel = 0; pixel < pixels.length; pixel += 4) {
        if (pixels[pixel] > 200 && pixels[pixel + 1] < 30) redPixels++;
        if (pixels[pixel + 1] > 200 && pixels[pixel] < 30) greenPixels++;
      }
      pixelReadback.unmap();
      if (redPixels === 0 || greenPixels === 0) {
        throw new Error(\`indirect draw pixel proof failed: red=\${redPixels}, green=\${greenPixels}\`);
      }

      const readback = await runtime.readback();
      const comparison = webgpu.compareProcPlantWebGpuVisibilityReadback(readback, reference);
      const diagnostics = runtime.diagnostics;
      const drawDiagnostics = drawEncoder.diagnostics;
      const adapterInfo = adapter.info ? {
        vendor: adapter.info.vendor ?? '',
        architecture: adapter.info.architecture ?? '',
        device: adapter.info.device ?? '',
        description: adapter.info.description ?? '',
      } : null;
      drawEncoder.dispose();
      runtime.dispose();
      for (const buffer of laneUniforms) buffer.destroy();
      indexBuffer.destroy();
      pixelReadback.destroy();
      renderTexture.destroy();
      const disposedState = runtime.diagnostics.state;
      if (typeof device.destroy === 'function') device.destroy();
      return { available: true, comparison, diagnostics, drawDiagnostics, pixelProof: { redPixels, greenPixels }, disposedState, adapterInfo };
    })()
  `;
  const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.result?.exceptionDetails) {
    const description = response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text;
    throw new Error(`${description}\nrequests=${JSON.stringify(serverRequests)}`);
  }
  const result = response.result?.result?.value;
  assert.ok(result);
  if (result.available) {
    assert.deepEqual(result.comparison, { matches: true, mismatchCount: 0 });
    assert.equal(result.diagnostics.dispatchCount, 1);
    assert.equal(result.diagnostics.readbackCount, 1);
    assert.equal(result.drawDiagnostics.encodedDrawCount, 3);
    assert.ok(result.pixelProof.redPixels > 0 && result.pixelProof.greenPixels > 0);
    assert.equal(result.disposedState, "disposed");
    console.log(JSON.stringify({ message: "procplant live WebGPU visibility smoke passed", ...result }));
  } else {
    console.log(JSON.stringify({ message: "procplant live WebGPU visibility smoke skipped", ...result }));
  }
  socket.close();
} finally {
  if (browser && browser.exitCode === null) {
    const exited = new Promise((resolveExit) => browser.once("exit", resolveExit));
    browser.kill();
    await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 2_000))]);
  }
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
