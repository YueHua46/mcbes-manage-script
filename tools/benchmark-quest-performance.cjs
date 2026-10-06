const { performance } = require("node:perf_hooks");
const { createQuestRuntime } = require("../tests/helpers/quest-performance-runtime.cjs");

// Node-side comparative benchmark. Does not measure engine provider/HUD cost or BDS TPS.
(async () => {
  const rows = [];
  for (const history of [0, 200]) {
    for (const kind of ["unchanged-inventory", "irrelevant-item", "iron-fact-change"]) {
      const r = await createQuestRuntime();
      const players = Array.from({ length: 100 }, (_, i) => ({ id: "bench" + i, name: "bench" + i, isValid: true }));
      const batch = (p, builtAt) => ({
        playerCmid: "cmid_" + p.name,
        reasons: ["inventory_change"],
        inventory: { items: new Map(), entries: [], builtAt, providerVersion: 2 },
      });
      for (const p of players) {
        r.service.ensureAutoAccepted(p);
        const aggregate = r.repo.loadForPlayer(p);
        for (let i = 0; i < history; i++)
          aggregate.instances["archive" + i] = {
            instanceId: "archive" + i,
            questId: "past" + i,
            definitionVersion: 1,
            periodKey: "once",
            attempt: 1,
            acceptedAt: 0,
            lifecycle: "claimed",
            progress: { goal: { kind: "number", value: 10 } },
            completedAt: 1,
            claimedAt: 2,
          };
        r.repo.saveForPlayer(p, aggregate);
        r.service.reconcileSnapshots(p, batch(p, 1));
      }
      for (const count of [20, 50, 100]) {
        r.mc.resetCounts();
        const original = JSON.stringify;
        let serializations = 0;
        JSON.stringify = (...args) => {
          serializations++;
          return original(...args);
        };
        const startedAt = performance.now();
        try {
          for (let repeat = 0; repeat < 10; repeat++)
            for (const p of players.slice(0, count)) {
              if (kind === "unchanged-inventory") r.service.reconcileSnapshots(p, batch(p, repeat + 2));
              else
                r.service.recordEvent(p, "item.obtain", {
                  item: kind === "irrelevant-item" ? "minecraft:barrier" : "minecraft:iron_ingot",
                  amount: 1,
                });
            }
        } finally {
          JSON.stringify = original;
        }
        rows.push({
          players: count,
          syntheticHistoricalInstances: history,
          work: kind,
          msPerAllPlayers: +((performance.now() - startedAt) / 10).toFixed(3),
          serializationsPerAllPlayers: serializations / 10,
          propertyCallsPerAllPlayers: Object.fromEntries(
            Object.entries(r.mc.counts()).map(([key, value]) => [key, value / 10])
          ),
        });
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        method:
          "Actual quest runtime with mocked engine/business boundaries; serial total cost, not TPS or queue latency.",
        rows,
      },
      null,
      2
    )
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
