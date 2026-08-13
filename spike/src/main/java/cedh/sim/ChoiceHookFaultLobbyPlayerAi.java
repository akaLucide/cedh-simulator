package cedh.sim;

import forge.game.player.Player;
import forge.game.player.PlayerController;

import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicBoolean;

/** TEST-ONLY: supplies the gate-bypassing controller for the A4 fault probe. */
public final class ChoiceHookFaultLobbyPlayerAi extends LandActionProbeLobbyPlayerAi {
    public ChoiceHookFaultLobbyPlayerAi(
            String name,
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
        super(name, targetSeat, seat, targetPhase, sourceName, stageIntoHand, auditOnly,
                beforeOutput, afterOutput, actionIssued, completed);
    }

    @Override
    protected PlayerController controller(Player player) {
        return new ChoiceHookFaultControllerAi(
                player,
                this,
                targetSeat,
                seat,
                targetPhase,
                sourceName,
                stageIntoHand,
                auditOnly,
                beforeOutput,
                afterOutput,
                actionIssued,
                completed
        );
    }
}
