import { system } from '@minecraft/server';
import { color } from '../utils/color';
class Particle {
    constructor() { }
    createLandParticle(player, pos) {
        system.run(() => {
            try {
                player.spawnParticle('minecraft:endrod', {
                    x: pos.x + 0.5,
                    y: pos.y + 0.3,
                    z: pos.z + 0.5,
                });
            }
            catch (error) { }
        });
    }
    createLandParticleArea(player, pos) {
        system.run(() => {
            const startPos = pos[0];
            const endPos = pos[1];
            if (startPos.y === endPos.y) {
                // If Y values are the same, create a 2D rectangle on the XZ plane
                const corners = [
                    { x: startPos.x, y: startPos.y, z: startPos.z },
                    { x: endPos.x, y: startPos.y, z: startPos.z },
                    { x: startPos.x, y: startPos.y, z: endPos.z },
                    { x: endPos.x, y: startPos.y, z: endPos.z },
                ];
                const edges = [
                    [corners[0], corners[1]],
                    [corners[1], corners[3]],
                    [corners[3], corners[2]],
                    [corners[2], corners[0]],
                ];
                for (const [start, end] of edges) {
                    this.createParticleLine(player, start, end);
                }
            }
            else {
                // Create a 3D cube
                const corners = [
                    { x: startPos.x, y: startPos.y, z: startPos.z },
                    { x: endPos.x, y: startPos.y, z: startPos.z },
                    { x: startPos.x, y: endPos.y, z: startPos.z },
                    { x: endPos.x, y: endPos.y, z: startPos.z },
                    { x: startPos.x, y: startPos.y, z: endPos.z },
                    { x: endPos.x, y: startPos.y, z: endPos.z },
                    { x: startPos.x, y: endPos.y, z: endPos.z },
                    { x: endPos.x, y: endPos.y, z: endPos.z },
                ];
                const edges = [
                    [corners[0], corners[1]],
                    [corners[1], corners[3]],
                    [corners[3], corners[2]],
                    [corners[2], corners[0]], // Bottom
                    [corners[4], corners[5]],
                    [corners[5], corners[7]],
                    [corners[7], corners[6]],
                    [corners[6], corners[4]], // Top
                    [corners[0], corners[4]],
                    [corners[1], corners[5]],
                    [corners[2], corners[6]],
                    [corners[3], corners[7]], // Verticals
                ];
                for (const [start, end] of edges) {
                    this.createParticleLine(player, start, end);
                }
            }
        });
    }
    createParticleLine(player, startPos, endPos) {
        const distance = Math.sqrt(Math.pow(endPos.x - startPos.x, 2) + Math.pow(endPos.y - startPos.y, 2) + Math.pow(endPos.z - startPos.z, 2));
        if (distance === 0) {
            //   player.sendMessage(color.red('错误：起始点和结束点相同，无法生成线段'))
            return;
        }
        const steps = Math.ceil(distance / 1.5); // Adjust the distance between particles
        const step = {
            x: (endPos.x - startPos.x) / steps,
            y: (endPos.y - startPos.y) / steps,
            z: (endPos.z - startPos.z) / steps,
        };
        for (let i = 0; i <= steps; i++) {
            const pos = {
                x: startPos.x + step.x * i,
                y: startPos.y + step.y * i,
                z: startPos.z + step.z * i,
            };
            if (isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z)) {
                player.sendMessage(color.red('错误：生成粒子时出现无效坐标'));
                return;
            }
            try {
                player.spawnParticle('minecraft:endrod', {
                    x: pos.x + 0.5,
                    y: pos.y + 0.3,
                    z: pos.z + 0.5,
                });
            }
            catch (error) { }
        }
    }
    getAreaBlocks(startPos, endPos) {
        const x = Math.abs(startPos.x - endPos.x);
        const y = Math.abs(startPos.y - endPos.y);
        const z = Math.abs(startPos.z - endPos.z);
        return x * y * z;
    }
}
export default new Particle();
//# sourceMappingURL=Particle.js.map