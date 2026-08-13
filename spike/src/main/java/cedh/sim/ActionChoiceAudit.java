package cedh.sim;

import forge.game.Game;
import forge.game.ability.AbilityUtils;
import forge.game.card.Card;
import forge.game.card.CardState;
import forge.game.cost.Cost;
import forge.game.cost.CostPart;
import forge.game.cost.CostPayLife;
import forge.game.replacement.ReplacementEffect;
import forge.game.replacement.ReplacementType;
import forge.game.spellability.SpellAbility;
import forge.game.trigger.Trigger;
import forge.game.zone.ZoneType;

import java.util.ArrayList;
import java.util.List;

/**
 * Derives the strategically relevant decisions an action still hides.
 *
 * <p>The audit is <strong>positive</strong>: it starts from "this action is not
 * proven" and returns an empty list only when every decision surface it knows
 * how to inspect came back clean. Anything it cannot classify becomes an
 * {@code UNSUPPORTED_ACTION_EXPANSION} entry, which keeps the action
 * non-executable. That direction matters — an empty list is an assertion of
 * completeness, so guessing in the optimistic direction would silently hand a
 * real decision to stock Forge AI.</p>
 *
 * <p>Everything here reads Forge's own rules data. There are no card names, no
 * blocklists, and no per-card exemptions: the same code classifies a basic land
 * and a modal double-faced land, and it discovered that
 * {@code Soporific Springs} carries the same optional life payment as
 * {@code Shatterskull, the Hammer Pass} without either name appearing.</p>
 */
public final class ActionChoiceAudit {
    private ActionChoiceAudit() {
    }

    /**
     * The pre-execution gate: refuses any action still hiding a decision.
     *
     * <p>Every probe controller that hands an ability to Forge calls this, so the
     * rule that {@code executable} means "nothing left unrepresented" has exactly
     * one definition. Callers supply the choices for the action they are about to
     * execute — the same list the observation publishes for it — and this decides
     * whether Forge may see it.</p>
     *
     * <p>Refusing here rather than inside Forge matters: once the engine has the
     * ability, the stock AI will answer whatever it is asked, and the run produces
     * plausible-looking data recording a decision nobody made.</p>
     */
    public static void requireRepresented(String context, List<UnrepresentedChoice> choices) {
        if (!choices.isEmpty()) {
            throw new UnrepresentedChoiceException(context, choices);
        }
    }

    /**
     * Audits one enumerated action.
     *
     * <p>Only land plays have a proven audit path in this milestone. Every other
     * category is reported as unsupported rather than assumed complete.</p>
     */
    public static List<UnrepresentedChoice> audit(SpellAbility ability) {
        if (ability == null) {
            return List.of();
        }
        if (!ability.isLandAbility()) {
            return List.of(UnrepresentedChoice.unsupportedExpansion(
                    source(ability.getHostCard()),
                    "The adapter has not expanded costs, modes, targets, or values for this action."
            ));
        }
        return auditLandPlay(ability);
    }

    /**
     * Audits a land play against the face that will actually enter.
     *
     * <p>{@code SpellAbility.getCardState()} is what makes this name-free: for a
     * modal double-faced card it reports the land face rather than the front
     * face, so the replacement effects inspected are the ones that will really
     * run.</p>
     */
    public static List<UnrepresentedChoice> auditLandPlay(SpellAbility ability) {
        Card host = ability.getHostCard();
        CardState enteringFace = ability.getCardState();
        if (enteringFace == null) {
            return List.of(UnrepresentedChoice.unsupportedExpansion(
                    source(host),
                    "Forge did not expose which face of this card would enter the battlefield."
            ));
        }

        List<UnrepresentedChoice> choices = new ArrayList<>();
        for (ReplacementEffect effect : enteringFace.getReplacementEffects()) {
            choices.addAll(auditEntryReplacement(host, enteringFace, effect));
        }
        choices.addAll(auditEntryTriggers(host, enteringFace));
        choices.addAll(auditForeignEntryReplacements(host));
        return List.copyOf(choices);
    }

    /**
     * Classifies one replacement effect that could apply as the card enters.
     *
     * <p>A replacement whose {@code ReplaceWith} ability carries an
     * {@code UnlessCost} is the "you may pay N life, otherwise it enters tapped"
     * shape. Forge routes that payment through
     * {@code PlayerController.payCostToPreventEffect}, so leaving it
     * unrepresented is exactly what lets the stock AI answer it silently.</p>
     */
    private static List<UnrepresentedChoice> auditEntryReplacement(
            Card host,
            CardState enteringFace,
            ReplacementEffect effect
    ) {
        if (effect.getMode() != ReplacementType.Moved) {
            return List.of();
        }
        String destination = effect.getParam("Destination");
        if (destination == null) {
            return List.of(UnrepresentedChoice.unsupportedExpansion(
                    source(host),
                    "A replacement effect on the entering face names no destination, "
                            + "so it cannot be proven irrelevant to entering the battlefield."
            ));
        }
        if (!destination.contains(ZoneType.Battlefield.name())) {
            return List.of();
        }

        SpellAbility replacement = effect.getOverridingAbility();
        if (replacement == null) {
            return List.of(UnrepresentedChoice.unsupportedExpansion(
                    source(host),
                    "A battlefield-entry replacement effect exposes no inspectable ability."
            ));
        }

        List<UnrepresentedChoice> choices = new ArrayList<>();
        for (SpellAbility step = replacement; step != null; step = step.getSubAbility()) {
            String unlessCost = step.getParam("UnlessCost");
            if (unlessCost == null || unlessCost.isBlank()) {
                continue;
            }
            choices.add(optionalCost(host, enteringFace, step, unlessCost.trim()));
        }
        if (choices.isEmpty() && (effect.hasParam("Optional") || effect.hasParam("OptionalDecider"))) {
            choices.add(UnrepresentedChoice.unsupportedExpansion(
                    source(host),
                    "A battlefield-entry replacement effect is optional in a form the adapter "
                            + "cannot yet enumerate."
            ));
        }
        return choices;
    }

    /** Builds the structured entry for an optional cost Forge will ask about. */
    private static UnrepresentedChoice optionalCost(
            Card host,
            CardState enteringFace,
            SpellAbility step,
            String unlessCost
    ) {
        UnrepresentedChoice.Amount amount = null;
        String rendered = unlessCost;
        try {
            Cost cost = AbilityUtils.calculateUnlessCost(step, unlessCost, false);
            rendered = cost.toString();
            for (CostPart part : cost.getCostParts()) {
                Integer value = part.convertAmount();
                if (part instanceof CostPayLife && value != null) {
                    amount = new UnrepresentedChoice.Amount("LIFE", value);
                }
            }
        } catch (RuntimeException error) {
            // An amount the adapter cannot resolve must not silently become "no
            // amount"; the entry still blocks execution either way.
            rendered = unlessCost + " (amount not resolvable: " + error.getClass().getSimpleName() + ")";
        }

        if (amount == null) {
            return UnrepresentedChoice.unsupportedExpansion(
                    source(host),
                    "A battlefield-entry replacement can be prevented by paying " + rendered
                            + ", in a form the adapter cannot yet enumerate."
            );
        }

        return new UnrepresentedChoice(
                "OPTIONAL_LIFE_PAYMENT",
                UnrepresentedChoice.DecisionType.OPTIONAL_COST,
                source(host),
                "As " + enteringFace.getName() + " enters, its controller may pay "
                        + amount.value() + " " + amount.unit().toLowerCase()
                        + " to prevent the entry replacement. Declining is legal.",
                UnrepresentedChoice.Timing.ON_ENTER,
                Boolean.TRUE,
                amount,
                List.of("PAY", "DECLINE")
        );
    }

    /**
     * Treats any battlefield-entry trigger as an unaudited decision surface.
     *
     * <p>A trigger that fires on entering may itself ask a question — surveil is
     * the obvious case — and this milestone has no machinery to prove otherwise.
     * Conservative by design: it costs a false "not executable", never a silent
     * decision.</p>
     */
    private static List<UnrepresentedChoice> auditEntryTriggers(Card host, CardState enteringFace) {
        for (Trigger trigger : enteringFace.getTriggers()) {
            String destination = trigger.getParam("Destination");
            if (destination == null || destination.contains(ZoneType.Battlefield.name())) {
                return List.of(UnrepresentedChoice.unsupportedExpansion(
                        source(host),
                        "The entering face has a battlefield-entry trigger whose own decisions "
                                + "the adapter has not audited."
                ));
            }
        }
        return List.of();
    }

    /**
     * Refuses to prove a land play clean while another object could replace the
     * entry.
     *
     * <p>{@code ReplacementHandler.getReplacementList} would answer this
     * precisely, but it needs the event parameter map Forge builds <em>during</em>
     * the move; constructing an approximation before the move risks under-reporting,
     * which is the one direction this audit must never fail in. Scanning for
     * candidate foreign effects is coarser and strictly safer.</p>
     */
    private static List<UnrepresentedChoice> auditForeignEntryReplacements(Card host) {
        Game game = host.getGame();
        if (game == null) {
            return List.of();
        }
        for (Card other : game.getCardsIn(List.of(ZoneType.Battlefield, ZoneType.Command))) {
            if (other.equals(host)) {
                continue;
            }
            for (ReplacementEffect effect : other.getReplacementEffects()) {
                if (effect.getMode() != ReplacementType.Moved) {
                    continue;
                }
                String destination = effect.getParam("Destination");
                if (destination == null || !destination.contains(ZoneType.Battlefield.name())) {
                    continue;
                }
                String valid = effect.getParam("ValidCard");
                if (valid != null && valid.contains("Card.Self")) {
                    continue;
                }
                return List.of(UnrepresentedChoice.unsupportedExpansion(
                        source(host),
                        "Another permanent carries a battlefield-entry replacement effect that "
                                + "the adapter cannot prove inapplicable to this land."
                ));
            }
        }
        return List.of();
    }

    private static UnrepresentedChoice.Source source(Card card) {
        if (card == null) {
            return new UnrepresentedChoice.Source("card-unknown", null, null);
        }
        return new UnrepresentedChoice.Source(
                "card-" + card.getId(),
                card.getName(),
                card.getZone() == null ? null : card.getZone().getZoneType().name()
        );
    }
}
