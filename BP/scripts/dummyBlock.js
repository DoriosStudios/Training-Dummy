import { system } from "@minecraft/server";
import { initializeDummyDps } from "./damageNumber.js";

system.beforeEvents.startup.subscribe(e => {
    e.blockComponentRegistry.registerCustomComponent("dorios:dummy_base", {
        onPlace(e) {
            const { block, dimension } = e;
            const btmCtr = block.bottomCenter();
            const dir = block.permutation.getState("minecraft:cardinal_direction");
            let rotation = 0;

            if (dir === "west") rotation = 180;
            if (dir === "north") rotation = 270;
            if (dir === "south") rotation = 90;

            const dummy = dimension.spawnEntity("dorios:dummy", btmCtr, {
                initialRotation: rotation
            });

            initializeDummyDps(dummy);
        }
    });
});
