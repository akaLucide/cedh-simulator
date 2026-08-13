package cedh.sim;

import forge.LobbyPlayer;
import forge.ai.PlayerControllerAi;
import forge.game.GameEndReason;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/** Executes one named land-face action and captures state on both sides. */
public final class LandActionProbeControllerAi extends PlayerControllerAi {
    private final boolean targetSeat;
    private final int seat;
    private final String targetPhase;
    private final String sourceName;
    private final Path beforeOutput;
    private final Path afterOutput;
    private final AtomicBoolean actionIssued;
    private final AtomicBoolean completed;

    public LandActionProbeControllerAi(
            Player player,
            LobbyPlayer lobbyPlayer,
            boolean targetSeat,
            int seat,
            String targetPhase,
            String sourceName,
            Path beforeOutput,
            Path afterOutput,
            AtomicBoolean actionIssued,
            AtomicBoolean completed
    ) {
        super(player.getGame(), player, lobbyPlayer);
        this.targetSeat = targetSeat;
        this.seat = seat;
        this.targetPhase = targetPhase;
        this.sourceName = sourceName;
        this.beforeOutput = beforeOutput;
        this.afterOutput = afterOutput;
        this.actionIssued = actionIssued;
        this.completed = completed;
    }

    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        if (!targetSeat) {
            return super.chooseSpellAbilityToPlay();
        }
        if (!getGame().getPhaseHandler().getPhase().name().equals(targetPhase)) {
            return null;
        }

        if (actionIssued.compareAndSet(false, true)) {
            write(beforeOutput);
            for (Card card : getPlayer().getCardsIn(ZoneType.Hand)) {
                if (!card.getName().equals(sourceName)) {
                    continue;
                }
                for (SpellAbility ability : card.getAllPossibleAbilities(getPlayer(), true)) {
                    if (ability.isLandAbility()) {
                        return List.of(ability);
                    }
                }
            }
            throw new IllegalStateException("No legal land action found for " + sourceName);
        }

        if (completed.compareAndSet(false, true)) {
            write(afterOutput);
            getGame().setGameOver(GameEndReason.Draw);
        }
        return null;
    }

    private void write(Path output) {
        try {
            ObservationWriter.write(output, getPlayer(), seat);
        } catch (IOException error) {
            throw new IllegalStateException("Could not write land-action observation", error);
        }
    }
}
