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
import java.util.concurrent.atomic.AtomicInteger;

/** Casts one named choice-free spell and captures before, stack, and resolved states. */
public final class SpellActionProbeControllerAi extends PlayerControllerAi {
    private final boolean targetSeat;
    private final int seat;
    private final String targetPhase;
    private final String sourceName;
    private final Path beforeOutput;
    private final Path stackOutput;
    private final Path resolvedOutput;
    private final AtomicInteger stage;

    public SpellActionProbeControllerAi(
            Player player,
            LobbyPlayer lobbyPlayer,
            boolean targetSeat,
            int seat,
            String targetPhase,
            String sourceName,
            Path beforeOutput,
            Path stackOutput,
            Path resolvedOutput,
            AtomicInteger stage
    ) {
        super(player.getGame(), player, lobbyPlayer);
        this.targetSeat = targetSeat;
        this.seat = seat;
        this.targetPhase = targetPhase;
        this.sourceName = sourceName;
        this.beforeOutput = beforeOutput;
        this.stackOutput = stackOutput;
        this.resolvedOutput = resolvedOutput;
        this.stage = stage;
    }

    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        if (!targetSeat) {
            return null;
        }
        if (!getGame().getPhaseHandler().getPhase().name().equals(targetPhase)) {
            return null;
        }

        if (stage.compareAndSet(0, 1)) {
            write(beforeOutput);
            for (Card card : getPlayer().getCardsIn(ZoneType.Hand)) {
                if (!card.getName().equals(sourceName)) {
                    continue;
                }
                for (SpellAbility ability : card.getAllPossibleAbilities(getPlayer(), true)) {
                    if (ability.isSpell() && !ability.usesTargeting()) {
                        // Being target-free and zero-cost is a structural property,
                        // not a proof that every decision is represented. This probe
                        // used to treat the two as the same thing and cast anyway,
                        // while the capture it had just written published the same
                        // action as non-executable. The gate below is the same audit
                        // ObservationWriter runs, so the two can no longer disagree.
                        ActionChoiceAudit.requireRepresented(
                                "Spell action for " + card.getName(),
                                ActionChoiceAudit.audit(ability)
                        );
                        return List.of(ability);
                    }
                }
            }
            throw new IllegalStateException("No target-free spell candidate found for " + sourceName);
        }

        if (stage.compareAndSet(1, 2)) {
            if (getGame().getStack().isEmpty()) {
                throw new IllegalStateException(sourceName + " was not added to the stack");
            }
            write(stackOutput);
            return null;
        }

        if (stage.compareAndSet(2, 3)) {
            if (!getGame().getStack().isEmpty()) {
                throw new IllegalStateException(sourceName + " did not resolve before priority returned");
            }
            write(resolvedOutput);
            getGame().setGameOver(GameEndReason.Draw);
        }
        return null;
    }

    private void write(Path output) {
        try {
            ObservationWriter.write(output, getPlayer(), seat);
        } catch (IOException error) {
            throw new IllegalStateException("Could not write spell-action observation", error);
        }
    }
}
