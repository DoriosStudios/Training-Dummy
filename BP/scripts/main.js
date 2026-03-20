import 'dummy_block'
import 'damage_number'

import { world, system } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

const BLOCKS_PER_TICK = 4000;
const ISLAND_CONFIGS = new Map();

const DEFAULT_ISLAND_CONFIG = {
    type: "normal",
    radius: 16,
    height: 4,
    layers: {
        top: "minecraft:grass_block",
        middle: "minecraft:dirt",
        bottom: "minecraft:stone"
    }
};

function rand(x, z, seed) {
    const s = Math.sin(x * 127.1 + z * 311.7 + seed * 101.3) * 43758.5453;
    return s - Math.floor(s);
}

function smoothNoise(x, z, seed) {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const x1 = x0 + 1;
    const z1 = z0 + 1;

    const sx = x - x0;
    const sz = z - z0;

    const n00 = rand(x0, z0, seed);
    const n10 = rand(x1, z0, seed);
    const n01 = rand(x0, z1, seed);
    const n11 = rand(x1, z1, seed);

    const ix0 = n00 + (n10 - n00) * sx;
    const ix1 = n01 + (n11 - n01) * sx;

    return ix0 + (ix1 - ix0) * sz;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

function getPlayerConfigKey(player) {
    return player.id ?? player.name;
}

function getIslandConfig(player) {
    const key = getPlayerConfigKey(player);
    const existing = ISLAND_CONFIGS.get(key);
    if (existing) return existing;

    const config = {
        ...DEFAULT_ISLAND_CONFIG,
        layers: { ...DEFAULT_ISLAND_CONFIG.layers }
    };

    ISLAND_CONFIGS.set(key, config);
    return config;
}

function normalizeBlockId(value, fallback) {
    const trimmed = `${value ?? ""}`.trim();
    if (!trimmed) return fallback;
    return trimmed.includes(":") ? trimmed : `minecraft:${trimmed}`;
}

function getIslandTypeLabel(type) {
    if (type === "spiky") return "Picos laterales";
    if (type === "rounded") return "Redondeada";
    return "Normal";
}

function getTopOffset(radial, radius, edgeNoise, surfaceNoise) {
    const plateauBlocks = radius <= 12 ? 1.5 : radius <= 14 ? 2 : 2.5;
    const plateauRadius = 1 - (plateauBlocks / radius);

    let offset = 0;

    if (radial < plateauRadius) {
        offset = 0;
    } else {
        const t = (radial - plateauRadius) / (1 - plateauRadius);
        offset -= Math.pow(t, 1.15) * 1.35;

        const edgeMask = smoothstep(0.08, 0.75, t);
        offset += (edgeNoise - 0.5) * 0.55 * edgeMask;
    }

    const plateauMask = 1 - smoothstep(plateauRadius * 0.7, plateauRadius, radial);
    offset += (surfaceNoise - 0.5) * 0.55 * plateauMask;

    return offset;
}

function getBottomDepthNormal(radial, height) {
    let t = 1 - radial;
    t = clamp(t, 0, 1);

    const shoulder = Math.pow(t, 0.58) * height * 0.9;
    const body = Math.pow(t, 1.55) * height * 1.15;
    const tail = Math.pow(t, 3.8) * height * 1.75;

    return shoulder + body + tail;
}

function getBottomDepthSpiky(radial, height, dx, dz, radius, seed) {
    let depth = getBottomDepthNormal(radial, height) * 0.72;

    const normalizedX = radius === 0 ? 0 : dx / radius;
    const normalizedZ = radius === 0 ? 0 : dz / radius;

    const leftPeak =
        Math.exp(-((normalizedX + 0.55) ** 2) / 0.16) *
        Math.exp(-(normalizedZ ** 2) / 0.3);
    const rightPeak =
        Math.exp(-((normalizedX - 0.55) ** 2) / 0.16) *
        Math.exp(-(normalizedZ ** 2) / 0.3);

    depth += (leftPeak + rightPeak) * height * 1.1;

    if (radius >= 11) {
        const smallPeakLeft =
            Math.exp(-((normalizedX + 0.82) ** 2) / 0.06) *
            Math.exp(-((normalizedZ - 0.2) ** 2) / 0.24);
        const smallPeakRight =
            Math.exp(-((normalizedX - 0.82) ** 2) / 0.06) *
            Math.exp(-((normalizedZ + 0.2) ** 2) / 0.24);

        depth += (smallPeakLeft + smallPeakRight) * height * 0.45;
    }

    const spikeNoise = smoothNoise(dx * 0.32 + seed, dz * 0.32 - seed, seed + 777);
    const spikeMask = 1 - smoothstep(0.55, 0.95, radial);
    depth += (spikeNoise - 0.5) * height * 0.35 * spikeMask;

    return depth;
}

function getBottomDepthRounded(radial, height) {
    const t = clamp(1 - radial, 0, 1);
    return Math.pow(t, 1.8) * height * 1.35;
}

function getBottomDepthByType(type, radial, height, dx, dz, radius, seed) {
    if (type === "spiky") {
        return getBottomDepthSpiky(radial, height, dx, dz, radius, seed);
    }

    if (type === "rounded") {
        return getBottomDepthRounded(radial, height);
    }

    return getBottomDepthNormal(radial, height);
}

function getBlockForDepth(depth, totalDepth, layerBlocks) {
    if (depth === 0) {
        return layerBlocks.top;
    }

    const middleDepth = Math.max(2, Math.floor(totalDepth * 0.22));
    if (depth <= middleDepth) {
        return layerBlocks.middle;
    }

    return layerBlocks.bottom;
}

async function openIslandTypeForm(player) {
    const config = getIslandConfig(player);
    const res = await new ActionFormData()
        .title("Tipo de isla")
        .body(`Actual: ${getIslandTypeLabel(config.type)}`)
        .button("Normal")
        .button("Picos laterales")
        .button("Redondeada")
        .show(player);

    if (res.canceled) return;

    const types = ["normal", "spiky", "rounded"];
    config.type = types[res.selection] ?? config.type;
    player.sendMessage(`§aTipo actualizado: ${getIslandTypeLabel(config.type)}.`);
}

async function openSizeForm(player) {
    const config = getIslandConfig(player);
    const res = await new ModalFormData()
        .title("Alto y radio")
        .slider("Radio", 4, 256, {
            defaultValue: config.radius,
            valueStep: 1
        })
        .slider("Alto", 2, 64, {
            defaultValue: config.height,
            valueStep: 1
        })
        .show(player);

    if (res.canceled) return;

    const [radius, height] = res.formValues;
    config.radius = Math.floor(radius);
    config.height = Math.floor(height);
    player.sendMessage(`§aTamano actualizado: radio ${config.radius}, alto ${config.height}.`);
}

async function openLayerBlocksForm(player) {
    const config = getIslandConfig(player);
    const res = await new ModalFormData()
        .title("Bloques de capas")
        .textField("Capa superior", "minecraft:grass_block", { defaultValue: config.layers.top })
        .textField("Capa media", "minecraft:dirt", { defaultValue: config.layers.middle })
        .textField("Capa inferior", "minecraft:stone", { defaultValue: config.layers.bottom })
        .show(player);

    if (res.canceled) return;

    const [top, middle, bottom] = res.formValues;
    config.layers.top = normalizeBlockId(top, config.layers.top);
    config.layers.middle = normalizeBlockId(middle, config.layers.middle);
    config.layers.bottom = normalizeBlockId(bottom, config.layers.bottom);

    player.sendMessage("§aBloques de capas actualizados.");
}

async function openIslandConfigMenu(player) {
    const config = getIslandConfig(player);
    const res = await new ActionFormData()
        .title("Configuracion de isla")
        .body(
            `Tipo: ${getIslandTypeLabel(config.type)}\n` +
            `Radio: ${config.radius}\n` +
            `Alto: ${config.height}\n` +
            `Superior: ${config.layers.top}\n` +
            `Media: ${config.layers.middle}\n` +
            `Inferior: ${config.layers.bottom}`
        )
        .button("Tipo de isla")
        .button("Alto y radio")
        .button("Bloques por capa")
        .button("Restablecer")
        .show(player);

    if (res.canceled) return;

    if (res.selection === 0) {
        await openIslandTypeForm(player);
        return openIslandConfigMenu(player);
    }

    if (res.selection === 1) {
        await openSizeForm(player);
        return openIslandConfigMenu(player);
    }

    if (res.selection === 2) {
        await openLayerBlocksForm(player);
        return openIslandConfigMenu(player);
    }

    ISLAND_CONFIGS.set(getPlayerConfigKey(player), {
        ...DEFAULT_ISLAND_CONFIG,
        layers: { ...DEFAULT_ISLAND_CONFIG.layers }
    });
    player.sendMessage("§aConfiguracion restablecida.");
    return openIslandConfigMenu(player);
}

function createIslandTask(dim, center, radius, height, seed, config) {
    const { x: cx, y: cy, z: cz } = center;

    let x = -radius;
    let z = -radius;

    return function step() {
        let placed = 0;

        while (placed < BLOCKS_PER_TICK) {
            const dx = x;
            const dz = z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist <= radius) {
                const radial = dist / radius;

                const edgeNoise = smoothNoise((cx + x) * 0.18, (cz + z) * 0.18, seed);
                const surfaceNoise = smoothNoise((cx + x) * 0.10, (cz + z) * 0.10, seed + 137);
                const bottomNoise = smoothNoise((cx + x) * 0.14, (cz + z) * 0.14, seed + 421);

                const surfaceBaseY = cy + height;
                const topOffset = getTopOffset(radial, radius, edgeNoise, surfaceNoise);
                const topY = Math.floor(surfaceBaseY + topOffset);

                let bottomDepth = getBottomDepthByType(config.type, radial, height, dx, dz, radius, seed);

                const bottomMask =
                    smoothstep(0.12, 0.55, radial) *
                    (1 - smoothstep(0.92, 1, radial));

                bottomDepth += (bottomNoise - 0.5) * 1.2 * bottomMask;

                const bottomY = Math.floor(surfaceBaseY - bottomDepth);

                if (bottomY <= topY) {
                    const totalDepth = topY - bottomY;

                    for (let y = bottomY; y <= topY; y++) {
                        const depth = topY - y;
                        const block = getBlockForDepth(depth, totalDepth, config.layers);

                        dim.getBlock({
                            x: cx + x,
                            y,
                            z: cz + z
                        })?.setType(block);

                        placed++;
                    }
                }
            }

            z++;
            if (z > radius) {
                z = -radius;
                x++;
                if (x > radius) return true;
            }
        }

        return false;
    };
}

world.beforeEvents.itemUse.subscribe((ev) => {
    const { source: player, itemStack } = ev;

    if (!player || itemStack?.typeId !== "minecraft:stick") return;

    if (player.isSneaking) {
        system.run(() => {
            openIslandConfigMenu(player).catch((error) => {
                player.sendMessage(`§cNo se pudo abrir el menu: ${error}`);
            });
        });
        return;
    }

    const loc = player.location;
    const config = getIslandConfig(player);
    const radius = config.radius;
    const height = config.height;
    const seed = Math.random() * 9999;

    const center = {
        x: Math.floor(loc.x),
        y: Math.floor(loc.y) - height,
        z: Math.floor(loc.z)
    };

    const task = createIslandTask(player.dimension, center, radius, height, seed, config);

    const job = system.runInterval(() => {
        if (task()) system.clearRun(job);
    }, 1);
});
