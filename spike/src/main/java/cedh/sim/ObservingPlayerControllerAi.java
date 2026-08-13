package cedh.sim;

import forge.LobbyPlayer;
import forge.ai.PlayerControllerAi;
import forge.game.GameEndReason;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/** Captures one observation immediately before the selected seat acts. */
public final class ObservingPlayerControllerAi extends PlayerControllerAi {
    private final Path output;
    private final int seat;
    private final boolean captureThisSeat;
    private final String targetPhase;
    private final AtomicBoolean captured;

    public ObservingPlayerControllerAi(
            Player player,
            LobbyPlayer lobbyPlayer,
            Path output,
            int seat,
            boolean captureThisSeat,
            String targetPhase,
            AtomicBoolean captured
    ) {
        super(player.getGame(), player, lobbyPlayer);
        this.output = output;
        this.seat = seat;
        this.captureThisSeat = captureThisSeat;
        this.targetPhase = targetPhase;
        this.captured = captured;
    }

    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        boolean phaseMatches = targetPhase == null
                || getGame().getPhaseHandler().getPhase().name().equals(targetPhase);
        if (captureThisSeat && phaseMatches && captured.compareAndSet(false, true)) {
            try {
                ObservationWriter.write(output, getPlayer(), seat);
            } catch (IOException error) {
                throw new IllegalStateException("Could not write priority observation", error);
            }
            // This is a bounded adapter probe, not a played game. Stop only
            // after the snapshot has been atomically written.
            getGame().setGameOver(GameEndReason.Draw);
            return null;
        }
        if (captureThisSeat) {
            // Advance the human seat to the requested probe phase without
            // allowing stock AI to make an earlier decision for it.
            return null;
        }
        return super.chooseSpellAbilityToPlay();
    }
}
