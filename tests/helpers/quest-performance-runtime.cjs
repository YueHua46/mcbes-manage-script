const path = require("node:path");
const { build } = require("esbuild");

// Actual quest runtime, presets, repository and generation store; only engine/business boundaries are mocked.
async function createQuestRuntime() {
  const stubs = {
    mc: `
      const initializers=[]; const properties=new Map();let reads=0,writes=0;
      export class Player {}
      export const system={currentTick:0,run:f=>{initializers.push(f);return 1}};
      export const world={getDynamicProperty:k=>{reads++;return properties.get(k)},
        setDynamicProperty:(k,v)=>{writes++;if(v===undefined)properties.delete(k);else properties.set(k,v)}};
      export function initialize(){initializers.splice(0).forEach(f=>f())}
      export function resetCounts(){reads=0;writes=0}
      export function counts(){return {reads,writes}}
    `,
    database: `const stores=new Map();export class Database {
      constructor(name){this.data={};stores.set(name,this)}get(k){return this.data[k]}getAll(){return this.data}
      set(k,v){this.data[k]=v}delete(k){delete this.data[k]}save(){}
    } export const getDatabase=name=>stores.get(name);`,
    identity: `const profiles=new Map();export const setProfile=(name,p)=>profiles.set(name,p);
      const profile=name=>profiles.get(name)??{id:'cmid_'+name,currentName:name,knownNames:[name]};
      export default {getProfileForPlayer:p=>profile(p.name),resolvePlayerKeyForPlayer:p=>profile(p.name).id,
        getProfileByName:name=>profile(name)};`,
    definitions: `let definitions=[],revision=0;
      export const setDefinitions=next=>{definitions=next;revision++};
      export default {isReady:()=>true,getRevision:()=>revision,getAll:()=>definitions,get:id=>definitions.find(d=>d.id===id)};
      export const formatFilterValue=v=>String(v);export const getQuestRewardSchema=()=>({fields:[]});`,
    policy: `let enabled=true,presets=true;export const setEnabled=v=>enabled=v;
      export const setPresets=v=>presets=v;export const isQuestSystemEnabled=()=>enabled;
      export const arePresetQuestsEnabled=()=>presets;`,
    handlers: `export const createRuntimeQuestRewardHandlers=()=>({get:()=>undefined});`,
    online: `export const isRealPlayerEntity=()=>true;`,
  };
  const mapping = [
    [/^@minecraft\/server$/, "mc"],
    [/shared\/database\/database$/, "database"],
    [/identity-service$/, "identity"],
    [/quest-definition$/, "definitions"],
    [/quest-runtime-policy$/, "policy"],
    [/runtime-reward-handlers$/, "handlers"],
    [/online-players$/, "online"],
  ];
  const result = await build({
    stdin: {
      contents: `
      export {default as service} from './scripts/features/quest/services/quest-player';
      export {default as catalog} from './scripts/features/quest/services/quest-catalog';
      export {default as repo} from './scripts/features/quest/state/quest-state-repository';
      export * as mc from '@minecraft/server';
      export * as policy from './scripts/features/quest/services/quest-runtime-policy';
      export * as definitions from './scripts/features/quest/services/quest-definition';
      export * as identity from './scripts/features/player/services/identity-service';
      export * as database from './scripts/shared/database/database';
      export {QuestWorkBudget} from './scripts/features/quest/runtime/quest-work-budget';
    `,
      resolveDir: path.resolve(__dirname, "../.."),
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    plugins: [
      {
        name: "quest-boundaries",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            const match = mapping.find(([pattern]) => pattern.test(args.path));
            if (match) return { path: match[1], namespace: "stub" };
          });
          build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path], loader: "ts" }));
        },
      },
    ],
  });
  const module = { exports: {} };
  new Function("module", "exports", result.outputFiles[0].text)(module, module.exports);
  module.exports.mc.initialize();
  return module.exports;
}

module.exports = { createQuestRuntime };
