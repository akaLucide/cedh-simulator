package cedh.sim;

import forge.LobbyPlayer;
import forge.ai.ComputerUtil;
import forge.ai.PlayerControllerAi;
import forge.game.GameEndReason;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;

import java.io.IOException;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/** Executes one fully specified mana-payment and player-target spell action. */
public final class TargetedSpellProbeControllerAi extends PlayerControllerAi {
    private final boolean actingSeat;
    private final int seat;
    private final int targetPlayerSeat;
    private final String targetPhase;
    private final String sourceName;
    private final String manaSourceName;
    private final Path beforeOutput;
    private final Path stackOutput;
    private final Path resolvedOutput;
    private final AtomicInteger stage;
    private SimpleSpellActionExpander.ExpandedAction selectedAction;
    private SimpleSpellActionExpander.Expansion expansion =
            SimpleSpellActionExpander.Expansion.unattempted();

    public TargetedSpellProbeControllerAi(
            Player player,
            LobbyPlayer lobbyPlayer,
            boolean actingSeat,
            int seat,
            int targetPlayerSeat,
            String targetPhase,
            String sourceName,
            String manaSourceName,
            Path beforeOutput,
            Path stackOutput,
            Path resolvedOutput,
            AtomicInteger stage
    ) {
        super(player.getGame(), player, lobbyPlayer);
        this.actingSeat = actingSeat;
        this.seat = seat;
        this.targetPlayerSeat = targetPlayerSeat;
        this.targetPhase = targetPhase;
        this.sourceName = sourceName;
        this.manaSourceName = manaSourceName;
        this.beforeOutput = beforeOutput;
        this.stackOutput = stackOutput;
        this.resolvedOutput = resolvedOutput;
        this.stage = stage;
    }

    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        if (!actingSeat) {
            return null;
        }
        if (!getGame().getPhaseHandler().getPhase().name().equals(targetPhase)) {
            return null;
        }

        if (stage.compareAndSet(0, 1)) {
            expansion = SimpleSpellActionExpander.expand(getPlayer());
            // Set-level gate: refuse before any action is selected from a set that is
            // known to be partial. Sits alongside the per-action represented-choice
            // gate below, and reads the same Expansion the capture serializes.
            EnumerationGuard.requireCompleteEnumeration(
                    "Targeted spell action for " + sourceName, expansion);
            selectedAction = expansion.actions().stream()
                    .filter(this::matchesRequestedAction)
                    .findFirst()
                    .orElseThrow(() -> new IllegalStateException(
                            "The general expander did not produce the requested " + sourceName
                                    + " action for target seat " + targetPlayerSeat
                                    + " paid by " + manaSourceName
                                    + "; skipped=" + expansion.skippedCandidates()
                                    + "; truncated=" + expansion.truncated()
                    ));

            // Gated on the same typed list that is serialized into this action's
            // published JSON. It is empty because expansion proved every choice
            // represented; the check exists so a future expander that stops
            // proving that cannot silently execute anyway.
            ActionChoiceAudit.requireRepresented(
                    "Expanded cast action " + selectedAction.json().get("id"),
                    selectedAction.unrepresentedChoices()
            );

            SpellAbility ability = selectedAction.ability();
            ability.resetTargets();
            if (!ability.canTarget(selectedAction.target())
                    || !ability.getTargets().add(selectedAction.target())
                    || !ability.isTargetNumberValid()) {
                throw new IllegalStateException("Expanded action target became illegal before execution");
            }
            write(beforeOutput, "selected");
            return List.of(ability);
        }

        if (stage.compareAndSet(1, 2)) {
            if (getGame().getStack().isEmpty()) {
                throw new IllegalStateException(sourceName + " was not added to the stack");
            }
            write(stackOutput, "on-stack");
            return null;
        }

        if (stage.compareAndSet(2, 3)) {
            if (!getGame().getStack().isEmpty()) {
                throw new IllegalStateException(sourceName + " did not resolve before priority returned");
            }
            write(resolvedOutput, "resolved");
            getGame().setGameOver(GameEndReason.Draw);
        }
        return null;
    }

    @Override
    public boolean playChosenSpellAbility(SpellAbility ability) {
        if (actingSeat && selectedAction != null && ability == selectedAction.ability()) {
            for (SimpleSpellActionExpander.ManaOption mana : selectedAction.payment().options()) {
                if (!ComputerUtil.handlePlayingSpellAbility(getPlayer(), mana.ability(), null)) {
                    throw new IllegalStateException(
                            "Could not activate selected mana ability from " + mana.source().getName()
                    );
                }
            }
        }
        return super.playChosenSpellAbility(ability);
    }

    private boolean matchesRequestedAction(SimpleSpellActionExpander.ExpandedAction action) {
        if (!action.ability().getHostCard().getName().equals(sourceName)
                || !(action.target() instanceof Player target)
                || ObservationWriter.seatOf(getGame(), target) != targetPlayerSeat
                || action.payment().options().size() != 1) {
            return false;
        }
        SimpleSpellActionExpander.ManaOption payment = action.payment().options().get(0);
        return payment.source().getName().equals(manaSourceName);
    }

    private void write(Path output, String status) {
        try {
            Map<String, Object> context = new LinkedHashMap<>(selectedAction.json());
            context.put("status", status);
            // Enumeration metadata belongs only to the state it was computed in. The
            // stack and resolved captures are later states in which no expansion was
            // attempted; republishing the pre-cast expansion there would describe a
            // candidate set that no longer exists.
            ObservationWriter.write(output, getPlayer(), seat, context,
                    "selected".equals(status)
                            ? expansion
                            : SimpleSpellActionExpander.Expansion.unattempted());
        } catch (IOException error) {
            throw new IllegalStateException("Could not write targeted-spell observation", error);
        }
    }
}
