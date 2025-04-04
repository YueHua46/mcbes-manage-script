import { HttpHeader, HttpRequest, HttpRequestMethod, http } from "@minecraft/server-net";
async function requestEvent(e, t) {
  e = new HttpRequest("http://127.0.0.1:3000/" + e);
  (e.body = JSON.stringify(t)),
    (e.method = HttpRequestMethod.Post),
    (e.headers = [new HttpHeader("Content-Type", "application/json")]),
    await http.request(e);
}
async function playerBrawlEvent(e, t) {
  requestEvent("player_brawl", { hitPlayer: e.name, damagingPlayer: t.name });
}
async function playerUseFireEvent(e, t, a) {
  await requestEvent("player_use_fire", { playerName: e, playerLocation: t, typeId: a });
}
async function playerUnBox(e, t) {
  await requestEvent("player_un_box", { playerName: e, playerLocation: t });
}
async function playerAttackVillager(e, t) {
  await requestEvent("player_attack_villager", { playerName: e, playerLocation: t });
}
export { playerBrawlEvent, playerUseFireEvent, playerUnBox, playerAttackVillager };
