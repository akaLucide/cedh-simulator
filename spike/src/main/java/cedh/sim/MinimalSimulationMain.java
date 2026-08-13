package cedh.sim;

import forge.gui.GuiBase;
import forge.view.SimulateMatch;

/**
 * Starts Forge's simulation mode without the normal desktop boot sequence.
 *
 * <p>The packaged Forge main class initializes telemetry, hardware reporting,
 * and other desktop-only services before dispatching to simulation mode. This
 * small launcher isolates the existing all-AI simulation entry point so it can
 * run in a displayless compatibility test.</p>
 */
public final class MinimalSimulationMain {
    private MinimalSimulationMain() {
    }

    public static void main(String[] args) {
        System.setProperty("java.util.Arrays.useLegacyMergeSort", "true");
        System.setProperty("sun.java2d.d3d", "false");
        GuiBase.setInterface(new HeadlessGuiBase());

        String[] forgeArgs = new String[args.length + 1];
        forgeArgs[0] = "sim";
        System.arraycopy(args, 0, forgeArgs, 1, args.length);
        SimulateMatch.simulate(forgeArgs);
    }
}
