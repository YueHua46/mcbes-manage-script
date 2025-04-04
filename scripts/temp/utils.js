function getPlayerLocation(o) {
  return `${o.location.x.toFixed(0)}, ${o.location.y.toFixed(0)}, ` + o.location.z.toFixed(0);
}
export { getPlayerLocation };
