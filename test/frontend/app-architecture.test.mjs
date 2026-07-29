import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const SRC_DIR = fileURLToPath(new URL("../../src/", import.meta.url));
const MAX_ORCHESTRATOR_BYTES = 20_000;

async function readManifest() {
  return JSON.parse(await readFile(join(SRC_DIR, "app", "manifest.json"), "utf8"));
}

test("src/app.js stays a thin orchestrator under 20 KB", async () => {
  const size = (await stat(join(SRC_DIR, "app.js"))).size;
  assert.ok(
    size < MAX_ORCHESTRATOR_BYTES,
    `src/app.js must stay below ${MAX_ORCHESTRATOR_BYTES} bytes, got ${size}`,
  );
});

test("orchestrator loads exactly the manifest parts in order", async () => {
  const orchestrator = await readFile(join(SRC_DIR, "app.js"), "utf8");
  const manifest = await readManifest();
  assert.ok(Array.isArray(manifest.parts) && manifest.parts.length >= 10);
  let previous = -1;
  for (const part of manifest.parts) {
    const position = orchestrator.indexOf(`"${part}"`);
    assert.ok(position > previous, `${part} must appear in src/app.js in manifest order`);
    previous = position;
  }
});

test("app modules are valid classic scripts and preserve the original bootstrap", async () => {
  const manifest = await readManifest();
  const parts = [];
  for (const part of manifest.parts) {
    const text = await readFile(join(SRC_DIR, part), "utf8");
    assert.ok(text.trim().length > 0, `${part} must not be empty`);
    new vm.Script(text, { filename: part });
    assert.doesNotMatch(text, /<script/i, `${part} must not embed script tags`);
    parts.push(text);
  }
  const combined = parts.join("");
  new vm.Script(combined, { filename: "app-combined.js" });
  assert.ok(combined.includes("initAutomation();renderWeek();"), "bootstrap order must be preserved");
  assert.ok(combined.includes("const PLAYERS="), "players catalog must live in the app modules");
  assert.ok(combined.includes("const FIXTURES="), "fixtures catalog must live in the app modules");
});
