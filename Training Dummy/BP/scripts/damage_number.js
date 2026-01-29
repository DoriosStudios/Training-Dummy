import { world, system } from "@minecraft/server";

// ───── Limpieza (GLOBAL) ─────
const HIT_MODE_CLEAR_TICKS = 100;
const DPS_CLEAR_AFTER_TICKS = 100;

// ───── Floating damage (GLOBAL) ─────
const DAMAGE_FLOAT_LIFETIME = 20;

// dummyId -> Map(playerId -> data)
const dpsMap = new Map();

/*
data = {
  windowActive,
  windowDamage,
  windowHits,
  maxHit,
  windowStartTick,
  lastDisplayTick,
  lastComputedText,
  lastComputedValue,
  playerName
}
*/

// ─────────────────────────────────────────────
// Floating damage
// ─────────────────────────────────────────────
function summonDamage(entity, damage) {
    const dim = entity.dimension;
    const loc = entity.location;

    const spawnLoc = {
        x: loc.x + (Math.random() - 0.5) * 0.6,
        y: loc.y + Math.random() * 0.4,
        z: loc.z + (Math.random() - 0.5) * 0.6
    };

    const dmgEntity = dim.spawnEntity("dorios:damage", spawnLoc);

    let baseColor = "§f";
    if (damage >= 15) baseColor = "§c";
    else if (damage >= 8) baseColor = "§6";
    else if (damage >= 4) baseColor = "§e";

    let ticks = 0;

    const interval = system.runInterval(() => {
        if (!dmgEntity.isValid) {
            system.clearRun(interval);
            return;
        }

        let fadeColor = baseColor;
        if (ticks > 12) fadeColor = "§7";
        if (ticks > 16) fadeColor = "§8";

        dmgEntity.nameTag = `${fadeColor}-${damage}`;

        dmgEntity.applyImpulse({
            x: (Math.random() - 0.5) * 0.002,
            y: 0.015,
            z: (Math.random() - 0.5) * 0.002
        });

        ticks++;
        if (ticks > DAMAGE_FLOAT_LIFETIME) {
            dmgEntity.remove();
            system.clearRun(interval);
        }
    }, 1);
}

// ─────────────────────────────────────────────
// Registro de daño
// ─────────────────────────────────────────────
function registerDamage(dummy, player, damage) {

    const DPS_ENABLED = dummy.getDynamicProperty("dps_enabled") ?? true;
    if (!DPS_ENABLED) return;

    const DPS_MODE_TIME = dummy.getDynamicProperty("dps_mode_time") ?? true;

    const dummyId = dummy.id;
    const playerId = player.id;

    if (!dpsMap.has(dummyId)) {
        dpsMap.set(dummyId, new Map());
    }

    const playerMap = dpsMap.get(dummyId);

    if (!playerMap.has(playerId)) {
        playerMap.set(playerId, {
            windowActive: false,
            windowDamage: 0,
            windowHits: 0,
            maxHit: 0,
            windowStartTick: 0,
            lastDisplayTick: 0,
            lastComputedText: "",
            lastComputedValue: 0,
            playerName: player.name
        });
    }

    const data = playerMap.get(playerId);

    if (!data.windowActive) {
        data.windowActive = true;
        data.windowStartTick = system.currentTick;
        data.windowDamage = 0;
        data.windowHits = 0;
        data.maxHit = 0;
    }

    data.windowDamage += damage;
    data.windowHits++;
    data.maxHit = Math.max(data.maxHit, damage);
}

// ─────────────────────────────────────────────
// Evento principal
// ─────────────────────────────────────────────
world.afterEvents.entityHurt.subscribe(e => {
    const { hurtEntity, damageSource, damage } = e;
    const player = damageSource.damagingEntity;

    if (player?.typeId !== "minecraft:player") return;
    if (!hurtEntity?.typeId.includes("dummy")) return;

    summonDamage(hurtEntity, damage);
    registerDamage(hurtEntity, player, damage);

    const health = hurtEntity.getComponent("minecraft:health");
    if (health) health.resetToMaxValue();
});

// ─────────────────────────────────────────────
// DPS / AVG por dummy (configurable)
// ─────────────────────────────────────────────
system.runInterval(() => {
    for (const [dummyId, playerMap] of dpsMap) {
        const dummy = world.getEntity(dummyId);
        if (!dummy || !dummy.isValid) {
            dpsMap.delete(dummyId);
            continue;
        }

        const DPS_PER_PLAYER = dummy.getDynamicProperty("dps_per_player") ?? true;
        const DPS_MODE_TIME = dummy.getDynamicProperty("dps_mode_time") ?? true;
        const DPS_TIME_WINDOW_TICKS = dummy.getDynamicProperty("dps_time_window") ?? 200;
        const DPS_HIT_WINDOW = dummy.getDynamicProperty("dps_hit_window") ?? 10;
        const DPS_SHOW_MAX_DAMAGE = dummy.getDynamicProperty("dps_show_max") ?? true;

        const entries = [];

        for (const [playerId, data] of playerMap) {

            // ───── MODO TIEMPO ─────
            if (DPS_MODE_TIME && data.windowActive) {
                const elapsed = system.currentTick - data.windowStartTick;

                if (elapsed >= DPS_TIME_WINDOW_TICKS) {
                    const seconds = DPS_TIME_WINDOW_TICKS / 20;
                    const dps = data.windowDamage / seconds;

                    let line = `§6${data.playerName} §fDPS: ${dps.toFixed(1)}`;
                    if (DPS_SHOW_MAX_DAMAGE) line += ` §7| Max: ${data.maxHit}`;

                    data.lastComputedText = line;
                    data.lastComputedValue = dps;
                    data.lastDisplayTick = system.currentTick;

                    data.windowActive = false;
                }
            }

            // ───── MODO GOLPES ─────
            if (!DPS_MODE_TIME && data.windowActive) {
                if (data.windowHits >= DPS_HIT_WINDOW) {
                    const avg = data.windowDamage / data.windowHits;

                    let line = `§6${data.playerName} §fAVG: ${avg.toFixed(1)}`;
                    if (DPS_SHOW_MAX_DAMAGE) line += ` §7| Max: ${data.maxHit}`;

                    data.lastComputedText = line;
                    data.lastComputedValue = avg;
                    data.lastDisplayTick = system.currentTick;

                    data.windowActive = false;
                }
            }

            // ───── Limpieza por inactividad (ambos modos) ─────
            if (data.lastComputedText) {
                const inactive = system.currentTick - data.lastDisplayTick;
                if (inactive > DPS_CLEAR_AFTER_TICKS) {
                    playerMap.delete(playerId);
                    continue;
                }
            }

            if (data.lastComputedText) {
                entries.push({
                    value: data.lastComputedValue,
                    line: data.lastComputedText
                });
            }
        }

        if (entries.length === 0) {
            dummy.nameTag = "";
            continue;
        }

        entries.sort((a, b) => b.value - a.value);

        dummy.nameTag = DPS_PER_PLAYER
            ? entries.map(e => e.line).join("\n")
            : entries[0].line;
    }
}, 20);
