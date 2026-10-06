const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { build } = require("esbuild");

async function runtime() {
  const stubs = {
    mc: `const runs=new Map();let id=0;export class Player{};export const clock={now:0};
      export const system={currentTick:0,runTimeout(f,d){const key=++id;runs.set(key,{f,tick:this.currentTick+d});return key},
        clearRun:key=>runs.delete(key)};
      export function step(){system.currentTick++;for(const [key,run] of [...runs]){
        if(run.tick<=system.currentTick&&runs.delete(key))run.f()}}
      export const pending=()=>runs.size;`,
    identity: `export default {resolvePlayerKeyForPlayer:p=>p.id};`,
    policy: `let enabled=true;export const setEnabled=v=>enabled=v;export const isQuestSystemEnabled=()=>enabled;`,
    providers: `import {clock} from '@minecraft/server';export const buildPlayerInventorySummary=()=>{
      clock.now+=2;return {items:new Map(),entries:[],builtAt:clock.now,providerVersion:2}};
      export const buildPlayerEquipmentSummary=()=>({});export const buildPlayerEffectsSummary=()=>({});`,
    business: `export const buildPlayerCreeperStateSummary=()=>({});`,
  };
  const mapping = [
    [/^@minecraft\/server$/, "mc"],
    [/identity-service$/, "identity"],
    [/quest-runtime-policy$/, "policy"],
    [/runtime-snapshot-providers$/, "providers"],
    [/creeper-state-provider$/, "business"],
  ];
  const result = await build({
    stdin: {
      contents: `export {default as queue} from './scripts/features/quest/snapshots/runtime-snapshot-queue';
      export {questDeferredWorkBudget as budget} from './scripts/features/quest/runtime/quest-work-budget';
      export * as mc from '@minecraft/server';
      export {setEnabled} from './scripts/features/quest/services/quest-runtime-policy';`,
      resolveDir: path.resolve(__dirname, ".."),
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    plugins: [
      {
        name: "queue-boundaries",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (a) => {
            const match = mapping.find(([regex]) => regex.test(a.path));
            if (match) return { path: match[1], namespace: "stub" };
          });
          build.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: stubs[a.path], loader: "ts" }));
        },
      },
    ],
  });
  const module = { exports: {} };
  new Function("module", "exports", result.outputFiles[0].text)(module, module.exports);
  return module.exports;
}

test("100-player snapshot backlog respects the shared time budget, coalesces and drains without losing players", async () => {
  const r = await runtime(),
    seen = [];
  const stop = r.queue.subscribe((p) => seen.push(p.id));
  const original = Date.now;
  Date.now = () => r.mc.clock.now;
  try {
    r.mc.system.runTimeout(
      () =>
        r.budget.run(r.mc.system.currentTick, () => {
          r.mc.clock.now += 3;
        }),
      2
    );
    for (let i = 0; i < 100; i++) {
      const p = { id: "p" + i, name: "p" + i, isValid: true };
      r.queue.mark(p, "inventory", "change");
      r.queue.mark(p, "inventory", "change-again");
    }
    r.mc.step();
    r.mc.step();
    assert.equal(seen.length, 1); // The other queue spent 3 ms; only one 2 ms job can start.
    for (let i = 0; i < 110; i++) r.mc.step();
    assert.equal(seen.length, 100);
    assert.equal(new Set(seen).size, 100);
    assert.equal(r.mc.pending(), 0);
    r.queue.mark({ id: "late", name: "late", isValid: true }, "inventory", "change");
    stop();
    assert.equal(r.mc.pending(), 0);
    r.mc.step();
    r.mc.step();
    assert.equal(seen.length, 100);
  } finally {
    Date.now = original;
  }
});

test("snapshot shutdown cannot replay old work after re-enabling", async () => {
  const r = await runtime(),
    seen = [];
  r.queue.subscribe((p) => seen.push(p.id));
  r.queue.mark({ id: "old", name: "old", isValid: true }, "inventory", "change");
  r.setEnabled(false);
  r.mc.step();
  r.mc.step();
  r.setEnabled(true);
  r.mc.step();
  r.mc.step();
  assert.deepEqual(seen, []);
  assert.equal(r.mc.pending(), 0);
});
