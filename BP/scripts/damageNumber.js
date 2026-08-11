import { world, system } from "@minecraft/server";

const DUMMY_TYPE_ID = "dorios:dummy";
const DPS_WINDOW_TICKS = 20;
const DAMAGE_FLOAT_LIFETIME = 20;
const DUMMY_DIMENSIONS = ["overworld", "nether", "the_end"];

// dummyId -> { dummy, hits: Array<{ tick, damage }>, lastNameTag }
const dpsMap = new Map();

function formatDps(dps) {
    return `\u00A76DPS: \u00A7f${dps.toFixed(1)}`;
}

export function initializeDummyDps(dummy) {
    if (!dummy || !dummy.isValid || dummy.typeId !== DUMMY_TYPE_ID) return null;

    let state = dpsMap.get(dummy.id);
    if (!state) {
        state = {
            dummy,
            hits: [],
            lastNameTag: ""
        };
        dpsMap.set(dummy.id, state);
    } else {
        state.dummy = dummy;
    }

    const initialNameTag = formatDps(0);
    if (state.hits.length === 0 && dummy.nameTag !== initialNameTag) {
        dummy.nameTag = initialNameTag;
        state.lastNameTag = initialNameTag;
    }

    return state;
}

function pruneExpiredHits(state, currentTick) {
    while (state.hits.length > 0 && currentTick - state.hits[0].tick >= DPS_WINDOW_TICKS) {
        state.hits.shift();
    }
}

function updateDummyDps(state, currentTick) {
    pruneExpiredHits(state, currentTick);

    const dps = state.hits.reduce((total, hit) => total + hit.damage, 0);
    const nameTag = formatDps(dps);

    if (state.lastNameTag !== nameTag || state.dummy.nameTag !== nameTag) {
        state.dummy.nameTag = nameTag;
        state.lastNameTag = nameTag;
    }
}

function initializeLoadedDummies() {
    for (const dimensionId of DUMMY_DIMENSIONS) {
        try {
            const dimension = world.getDimension(dimensionId);
            for (const dummy of dimension.getEntities({ type: DUMMY_TYPE_ID })) {
                initializeDummyDps(dummy);
            }
        } catch { }
    }
}

function summonDamage(entity, damage) {
    const dim = entity.dimension;
    const loc = entity.location;

    const angle = Math.random() * Math.PI * 2;
    const radius = 0.5 + Math.random() * 0.5;

    const spawnLoc = {
        x: loc.x + Math.cos(angle) * radius,
        y: loc.y + 0.4 + Math.random() * 0.4,
        z: loc.z + Math.sin(angle) * radius
    };

    const dmgEntity = dim.spawnEntity("dorios:damage", spawnLoc);

    let baseColor = "\u00A7f";
    if (damage >= 15) baseColor = "\u00A7c";
    else if (damage >= 8) baseColor = "\u00A76";
    else if (damage >= 4) baseColor = "\u00A7e";

    let ticks = 0;

    const interval = system.runInterval(() => {
        if (!dmgEntity.isValid) {
            system.clearRun(interval);
            return;
        }

        let fadeColor = baseColor;
        if (ticks > 12) fadeColor = "\u00A77";
        if (ticks > 16) fadeColor = "\u00A78";

        dmgEntity.nameTag = `${fadeColor}${damage}:heart:`;

        dmgEntity.applyImpulse({
            x: (Math.random() - 0.5) * 0.003,
            y: 0.015,
            z: (Math.random() - 0.5) * 0.003
        });

        ticks++;
        if (ticks > DAMAGE_FLOAT_LIFETIME) {
            dmgEntity.remove();
            system.clearRun(interval);
        }
    }, 1);
}

function registerDamage(dummy, damage) {
    const state = initializeDummyDps(dummy);
    if (!state) return;

    state.hits.push({
        tick: system.currentTick,
        damage
    });

    updateDummyDps(state, system.currentTick);
}

world.afterEvents.entityHurt.subscribe(({ hurtEntity, damageSource, damage }) => {
    const player = damageSource.damagingEntity;

    if (player?.typeId !== "minecraft:player") return;
    if (hurtEntity?.typeId !== DUMMY_TYPE_ID) return;

    summonDamage(hurtEntity, damage);
    registerDamage(hurtEntity, damage);

    const health = hurtEntity.getComponent("minecraft:health");
    if (health) health.resetToMaxValue();
});

system.runInterval(() => {
    const currentTick = system.currentTick;

    for (const [dummyId, state] of dpsMap) {
        if (!state.dummy?.isValid) {
            dpsMap.delete(dummyId);
            continue;
        }

        updateDummyDps(state, currentTick);
    }

    if (currentTick % 20 === 0) initializeLoadedDummies();
}, 1);

world.afterEvents.worldLoad.subscribe(() => {
    system.run(initializeLoadedDummies);
});
