import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const exampleDist = join(__dirname, "..", "examples", "interactive-visualizer", "dist");

// The published adapter checkout may omit this optional example and its build
// output. Run these assertions when the example distribution is present.
describe.skipIf(!existsSync(join(exampleDist, "app.html")) || !existsSync(join(exampleDist, "server.js")))("interactive visualizer", () => {
  it("dist/app.html exists and contains chart.js", () => {
    const html = readFileSync(
      join(__dirname, "..", "examples", "interactive-visualizer", "dist", "app.html"),
      "utf-8",
    );
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("chart.js");
    expect(html).toContain('<div id="app">');
  });

  it("dist/server.js exists and is executable", () => {
    const server = readFileSync(
      join(__dirname, "..", "examples", "interactive-visualizer", "dist", "server.js"),
      "utf-8",
    );
    expect(server).toContain("#!/usr/bin/env node");
    expect(server).toContain("show_chart");
    expect(server).toContain("interactive-visualizer");
  });
});
