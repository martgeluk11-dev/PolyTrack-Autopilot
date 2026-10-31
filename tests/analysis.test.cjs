const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("src/analysis.js", "utf8");
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const analyze = sandbox.window.PTAPAnalysis.analyze;

test("counts throttle duration", () => {
  const result = analyze([
    { t: 0, type: "keydown", key: "w" },
    { t: 1000, type: "keyup", key: "w" }
  ], 1000);
  assert.equal(result.totalsMs.throttle, 1000);
  assert.equal(result.percentages.throttle, 100);
});

test("counts overlapping brake and steering", () => {
  const result = analyze([
    { t: 0, type: "keydown", key: "ArrowDown" },
    { t: 100, type: "keydown", key: "a" },
    { t: 400, type: "keyup", key: "a" },
    { t: 700, type: "keyup", key: "ArrowDown" }
  ], 1000);
  assert.equal(result.totalsMs.brake, 700);
  assert.equal(result.totalsMs.left, 300);
  assert.equal(result.brakingWhileTurningMs, 300);
});

test("splits a run into eight time buckets", () => {
  const result = analyze([
    { t: 0, type: "keydown", key: "w" },
    { t: 1000, type: "keyup", key: "w" }
  ], 1000, 8);
  assert.equal(result.segments.length, 8);
  assert.ok(result.segments.every(segment => segment.throttleMs === 125));
});

test("closes an input that is still held at the end of the run", () => {
  const result = analyze([
    { t: 100, type: "keydown", key: "ArrowUp" }
  ], 500);
  assert.equal(result.totalsMs.throttle, 400);
});

test("does not double-count repeated keydown events", () => {
  const result = analyze([
    { t: 0, type: "keydown", key: "d" },
    { t: 100, type: "keydown", key: "d" },
    { t: 300, type: "keyup", key: "d" }
  ], 300);
  assert.equal(result.totalsMs.right, 300);
  assert.equal(result.transitions, 2);
});