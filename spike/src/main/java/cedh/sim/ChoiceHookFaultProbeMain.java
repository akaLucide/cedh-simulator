package cedh.sim;

/**
 * TEST-ONLY entry point proving the decision hook of last resort still throws.
 *
 * <p>Runs the ordinary land-action probe with the pre-execution gate suppressed,
 * so an incompletely audited action reaches Forge on purpose. The expected
 * outcome is an {@code UnrepresentedChoiceException} raised from
 * {@code payCostToPreventEffect}, with {@code AbilityUtils.handleUnlessCost} in
 * the stack — evidence that Forge genuinely asked the question and the adapter
 * refused to let stock AI answer it.</p>
 */
public final class ChoiceHookFaultProbeMain {
    private ChoiceHookFaultProbeMain() {
    }

    public static void main(String[] args) {
        LandActionProbeMain.run(
                LandActionProbeMain.Arguments.parse(args),
                ChoiceHookFaultLobbyPlayerAi::new
        );
    }
}
