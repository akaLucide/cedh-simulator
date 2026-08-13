package cedh.sim;

import forge.LobbyPlayer;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;

import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * TEST-ONLY: removes the pre-execution gate so Forge is deliberately reached.
 *
 * <p>The production probe refuses an incompletely audited action before Forge
 * ever sees it, which is the correct behaviour but also means the decision hook
 * of last resort is never exercised. A guard that is never reached cannot be
 * shown to work, so this subclass suppresses <em>only</em> the pre-execution
 * refusal and inherits {@code payCostToPreventEffect} unchanged. Reaching the
 * hook and observing it throw is the proof.</p>
 *
 * <p>This class is reachable only through {@link ChoiceHookFaultProbeMain}. No
 * production code path can select it, and the production gate is untouched.</p>
 */
public final class ChoiceHookFaultControllerAi extends LandActionProbeControllerAi {
    public ChoiceHookFaultControllerAi(
            Player player,
            LobbyPlayer lobbyPlayer,
            boolean targetSeat,
            int seat,
            String targetPhase,
            String sourceName,
            String stageIntoHand,
            boolean auditOnly,
            Path beforeOutput,
            Path afterOutput,
            AtomicBoolean actionIssued,
            AtomicBoolean completed
    ) {
        super(player, lobbyPlayer, targetSeat, seat, targetPhase, sourceName, stageIntoHand,
                auditOnly, beforeOutput, afterOutput, actionIssued, completed);
    }

    @Override
    protected void refuseIfIncomplete(SpellAbility ability, List<UnrepresentedChoice> choices) {
        System.out.println(
                "PROBE_GATE_BYPASSED=" + choices.size()
                        + " unrepresented choice(s) deliberately passed to Forge"
        );
    }
}
