import { system, world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

function msg(str) {
    world.sendMessage(`${JSON.stringify(str)}`)
}

system.beforeEvents.startup.subscribe(e => {
    e.blockComponentRegistry.registerCustomComponent("dorios:dummy_base", {

        onPlace(e) {
            const { block, dimension } = e;
            const btmCtr = block.bottomCenter();
            // ───── Leer cardinal direction del bloque ─────
            const dir = block.permutation.getState("minecraft:cardinal_direction");
            let rotation = 0

            if (dir == 'west') {
                rotation = 180;
            }
            if (dir == 'north') {
                rotation = 270
            }
            if (dir == 'south') {
                rotation = 90
            }

            const dummy = dimension.spawnEntity("dorios:dummy", btmCtr, { initialRotation: rotation });

            dummy.setDynamicProperty("dps_enabled", true);
            dummy.setDynamicProperty("dps_per_player", true);
            dummy.setDynamicProperty("dps_mode_time", true);
            dummy.setDynamicProperty("dps_time_window", 200);
            dummy.setDynamicProperty("dps_hit_window", 10);
            dummy.setDynamicProperty("dps_show_max", true);
        },

        onPlayerInteract(e) {
            const { player, block, dimension } = e;
            const loc = block.bottomCenter();

            const dummy = dimension.getEntities({
                type: "dorios:dummy",
                location: loc,
                maxDistance: 1
            })[0];

            if (!dummy) return;

            const enabled = dummy.getDynamicProperty("dps_enabled") ?? true;
            const perPlayer = dummy.getDynamicProperty("dps_per_player") ?? true;
            const modeTime = dummy.getDynamicProperty("dps_mode_time") ?? true;
            const timeWindow = dummy.getDynamicProperty("dps_time_window") ?? 200;
            const hitWindow = dummy.getDynamicProperty("dps_hit_window") ?? 10;
            const showMax = dummy.getDynamicProperty("dps_show_max") ?? true;

            const form = new ModalFormData()
                .title("Dummy DPS Settings")

                // Toggles
                .toggle("Enable DPS", { defaultValue: enabled })
                .toggle("DPS Per Player", { defaultValue: perPlayer })
                .toggle("Use Time Mode (DPS)", { defaultValue: modeTime })
                .toggle("Show Max Hit", { defaultValue: showMax })

                // Sliders
                .slider(
                    "Time Window (ticks)",
                    timeWindow,
                    timeWindow * 5,
                    {
                        defaultValue: timeWindow,
                        valueStep: 10
                    }
                )
                .slider(
                    "Hit Window",
                    hitWindow,
                    hitWindow * 5,
                    {
                        defaultValue: hitWindow,
                        valueStep: 1
                    }
                );

            form.show(player).then(res => {
                if (res.canceled) return;

                const [
                    newEnabled,
                    newPerPlayer,
                    newModeTime,
                    newShowMax,
                    newTimeWindow,
                    newHitWindow
                ] = res.formValues;

                dummy.setDynamicProperty("dps_enabled", newEnabled);
                dummy.setDynamicProperty("dps_per_player", newPerPlayer);
                dummy.setDynamicProperty("dps_mode_time", newModeTime);
                dummy.setDynamicProperty("dps_show_max", newShowMax);
                dummy.setDynamicProperty("dps_time_window", Math.floor(newTimeWindow));
                dummy.setDynamicProperty("dps_hit_window", Math.floor(newHitWindow));

                player.sendMessage("§aDummy DPS settings updated.");
            });
        }
    });
});
