package cedh.sim;

import forge.LobbyPlayer;
import forge.ai.PlayerControllerAi;
import forge.game.GameEndReason;
import forge.game.card.Card;
import forge.game.cost.Cost;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.util.collect.FCollectionView;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** Executes one named land-face action and captures state on both sides. */
public class LandActionProbeControllerAi extends PlayerControllerAi {
    /**
     * Counts how many times Forge reached a decision the adapter did not
     * represent. The pre-execution gate is supposed to make this unreachable, so
     * a nonzero count on the production path is itself a failure.
     */
    private static final AtomicInteger FORGE_DECISION_HOOK_INVOCATIONS = new AtomicInteger();

    private final boolean targetSeat;
    private final int seat;
    private final String targetPhase;
    private final String sourceName;
    private final String stageIntoHand;
    private final boolean auditOnly;
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
            String stageIntoHand,
            boolean auditOnly,
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
        this.stageIntoHand = stageIntoHand;
        this.auditOnly = auditOnly;
        this.beforeOutput = beforeOutput;
        this.afterOutput = afterOutput;
        this.actionIssued = actionIssued;
        this.completed = completed;
    }

    public static int forgeDecisionHookInvocations() {
        return FORGE_DECISION_HOOK_INVOCATIONS.get();
    }

    /**
     * The decision hook of last resort.
     *
     * <p>Forge routes "you may pay N life, otherwise it enters tapped" through
     * this method — proven by instrumented probe against the pinned build, where
     * the call arrives from {@code AbilityUtils.handleUnlessCost}. Stock
     * {@code PlayerControllerAi} would answer it and return, which is precisely
     * the silent decision this milestone exists to eliminate. Throwing here means
     * that if any path ever slips past the pre-execution gate, the run fails
     * loudly instead of producing plausible-looking game data.</p>
     */
    @Override
    public boolean payCostToPreventEffect(
            Cost cost,
            SpellAbility sa,
            boolean alreadyPaid,
            FCollectionView<Player> allPayers
    ) {
        FORGE_DECISION_HOOK_INVOCATIONS.incrementAndGet();
        Card host = sa.getHostCard();
        UnrepresentedChoice.Source source = new UnrepresentedChoice.Source(
                host == null ? "card-unknown" : "card-" + host.getId(),
                host == null ? null : host.getName(),
                host == null || host.getZone() == null ? null : host.getZone().getZoneType().name()
        );
        throw new UnrepresentedChoiceException(
                "Forge reached an unrepresented optional payment",
                List.of(new UnrepresentedChoice(
                        "OPTIONAL_COST_REACHED_FORGE",
                        UnrepresentedChoice.DecisionType.OPTIONAL_COST,
                        source,
                        "Forge asked whether to pay " + cost
                                + ", which the adapter did not represent as a choice.",
                        UnrepresentedChoice.Timing.ON_ENTER,
                        Boolean.TRUE,
                        null,
                        List.of("PAY", "DECLINE")
                ))
        );
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
            stageIfRequested();
            write(beforeOutput);
            if (auditOnly) {
                // The audit is the whole result; executing an incompletely audited
                // action is exactly what must not happen.
                completed.set(true);
                getGame().setGameOver(GameEndReason.Draw);
                return null;
            }
            SpellAbility selected = selectLandAbility();
            refuseIfIncomplete(selected, ActionChoiceAudit.audit(selected));
            return List.of(selected);
        }

        if (completed.compareAndSet(false, true)) {
            write(afterOutput);
            getGame().setGameOver(GameEndReason.Draw);
        }
        return null;
    }

    /**
     * The pre-execution gate: refuses before the ability ever reaches Forge.
     *
     * <p>Overridden only by the test-only fault-injection probe, which exists to
     * prove the hook above still throws when this gate is deliberately removed.
     * No production path can select that subclass.</p>
     */
    protected void refuseIfIncomplete(SpellAbility ability, List<UnrepresentedChoice> choices) {
        if (!choices.isEmpty()) {
            throw new UnrepresentedChoiceException(
                    "Land action for " + ability.getHostCard().getName(),
                    choices
            );
        }
    }

    protected SpellAbility selectLandAbility() {
        for (Card card : getPlayer().getCardsIn(ZoneType.Hand)) {
            if (!card.getName().equals(sourceName)) {
                continue;
            }
            for (SpellAbility ability : card.getAllPossibleAbilities(getPlayer(), true)) {
                if (ability.isLandAbility()) {
                    return ability;
                }
            }
        }
        throw new IllegalStateException("No legal land action found for " + sourceName);
    }

    /**
     * Moves a requested card from library to hand.
     *
     * <p>Needed because the seed-20260812 opening hand contains no land whose
     * entry is choice-free, so the positive control has to be arranged. The card
     * arrives as a CLI argument and the resulting capture records itself as
     * staged.</p>
     */
    private void stageIfRequested() {
        if (stageIntoHand == null) {
            return;
        }
        for (Card card : getPlayer().getCardsIn(ZoneType.Hand)) {
            if (card.getName().equals(stageIntoHand)) {
                return;
            }
        }
        for (Card card : getPlayer().getCardsIn(ZoneType.Library)) {
            if (card.getName().equals(stageIntoHand)) {
                getGame().getAction().moveTo(getPlayer().getZone(ZoneType.Hand), card, null);
                return;
            }
        }
        throw new IllegalStateException("Cannot stage a card that is not in hand or library: " + stageIntoHand);
    }

    protected void write(Path output) {
        try {
            ObservationWriter.write(output, getPlayer(), seat);
        } catch (IOException error) {
            throw new IllegalStateException("Could not write land-action observation", error);
        }
    }
}
