package cedh.sim;

import forge.ai.ComputerUtilMana;
import forge.card.mana.ManaCost;
import forge.card.mana.ManaCostShard;
import forge.game.GameObject;
import forge.game.ability.ApiType;
import forge.game.card.Card;
import forge.game.cost.Cost;
import forge.game.cost.CostTap;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.trigger.Trigger;
import forge.game.zone.ZoneType;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Expands a deliberately bounded class of targeted spells into complete,
 * deterministic actions.
 *
 * <p>Version 1 supports fixed effective W/U/B/R/G/C plus generic costs, one
 * player target, an empty starting mana pool, and distinct battlefield mana
 * sources whose usable mana ability taps that source to produce exactly one
 * mana. Unsupported candidates remain visible through ObservationWriter's
 * ordinary candidate enumeration but are never mislabeled executable.</p>
 */
public final class SimpleSpellActionExpander {
    public static final int EXPANSION_VERSION = 1;
    private static final List<String> MANA_COLORS = List.of("W", "U", "B", "R", "G", "C");
    private static final int MAX_ACTIONS = 512;

    private SimpleSpellActionExpander() {
    }

    public static Expansion expand(Player viewer) {
        List<ExpandedAction> actions = new ArrayList<>();
        Map<String, Integer> skipped = new LinkedHashMap<>();
        List<InspectedAbility> inspected = new ArrayList<>();
        List<ManaSourceExclusion> exclusions = new ArrayList<>();

        if (viewer.getManaPool().totalMana() != 0) {
            skipped.put("floating-mana-not-supported", 1);
            return Expansion.suppressed("floating-mana-not-supported", skipped);
        }

        List<ManaOption> manaOptions = manaOptions(viewer, exclusions);
        List<Card> hand = new ArrayList<>(viewer.getCardsIn(ZoneType.Hand));
        boolean truncated = false;
        int cardIndex = 0;

        outer:
        for (; cardIndex < hand.size(); cardIndex++) {
            Card source = hand.get(cardIndex);
            for (SpellAbility ability : source.getAllPossibleAbilities(viewer, true)) {
                String unsupported = unsupportedReason(ability);
                if (unsupported != null) {
                    skipped.merge(unsupported, 1, Integer::sum);
                    inspected.add(InspectedAbility.skipped(source, ability, unsupported));
                    continue;
                }

                ManaProfile manaProfile = manaProfile(viewer, ability);
                if (manaProfile == null) {
                    skipped.merge("non-fixed-or-complex-mana-cost", 1, Integer::sum);
                    inspected.add(InspectedAbility.skipped(source, ability, "non-fixed-or-complex-mana-cost"));
                    continue;
                }
                List<ManaPlan> plans = manaPlans(manaProfile.requirements(), manaOptions);
                if (plans.isEmpty()) {
                    skipped.merge("no-supported-mana-plan", 1, Integer::sum);
                    inspected.add(InspectedAbility.skipped(source, ability, "no-supported-mana-plan"));
                    continue;
                }

                ability.resetTargets();
                List<Player> targets = ability.getTargetRestrictions().getAllCandidates(ability).stream()
                        .filter(Player.class::isInstance)
                        .map(Player.class::cast)
                        .sorted(Comparator.comparingInt(player ->
                                ObservationWriter.seatOf(viewer.getGame(), player)))
                        .toList();
                if (targets.isEmpty()) {
                    skipped.merge("no-legal-player-target", 1, Integer::sum);
                    inspected.add(InspectedAbility.skipped(source, ability, "no-legal-player-target"));
                    continue;
                }

                // Capacity is exact for this unit: the deduplicated plan enumeration
                // above ran to completion, so targets x plans is what this unit would
                // emit if the action limit never intervened.
                int capacity = targets.size() * plans.size();
                int emittedBefore = actions.size();
                for (Player target : targets) {
                    for (ManaPlan plan : plans) {
                        if (actions.size() >= MAX_ACTIONS) {
                            truncated = true;
                            break;
                        }
                        actions.add(expandedAction(viewer, source, ability, target, plan, manaProfile));
                    }
                    if (truncated) {
                        break;
                    }
                }
                inspected.add(InspectedAbility.expanded(
                        source, ability, targets.size(), plans.size(), capacity,
                        actions.size() - emittedBefore));
                if (truncated) {
                    break outer;
                }
            }
        }

        // Hand cards the break chain never reached are reported as source-card-level
        // evidence. No ability records are fabricated for them: nothing inspected
        // them, so nothing is known about their abilities.
        List<Card> uninspected = truncated && cardIndex + 1 < hand.size()
                ? List.copyOf(hand.subList(cardIndex + 1, hand.size()))
                : List.of();

        actions.sort(Comparator.comparing(action -> (String) action.json().get("id")));
        return new Expansion(actions, skipped, truncated, true, null, !truncated,
                List.copyOf(inspected), uninspected, List.copyOf(exclusions));
    }

    /**
     * Refuses a cast that can copy itself and choose new targets for the copies.
     *
     * <p>Such a spell may present exactly one represented target and still create
     * further target decisions when it resolves, so publishing it with an empty
     * {@code unrepresentedChoices} list would assert a completeness the adapter
     * cannot deliver.</p>
     *
     * <p>Detection is name-free and reads Forge's own rules data: the capability is
     * an {@link ApiType#CopySpellAbility} step carrying {@code MayChooseTarget$ True}
     * in a trigger's overriding-ability chain. Forge expands the Storm keyword into
     * exactly that shape, and 195 card scripts in the pinned build carry the same
     * parameter, so matching the capability covers the whole mechanic family rather
     * than one keyword.</p>
     */
    private static boolean copiesItselfWithNewTargets(SpellAbility ability) {
        Card host = ability.getHostCard();
        if (host == null) {
            return false;
        }
        for (Trigger trigger : host.getTriggers()) {
            for (SpellAbility step = trigger.getOverridingAbility();
                    step != null; step = step.getSubAbility()) {
                if (step.getApi() == ApiType.CopySpellAbility
                        && "True".equalsIgnoreCase(step.getParam("MayChooseTarget"))) {
                    return true;
                }
            }
        }
        return false;
    }

    private static String unsupportedReason(SpellAbility ability) {
        if (!ability.isSpell() || !ability.usesTargeting()) {
            return "not-a-targeted-spell";
        }
        if (copiesItselfWithNewTargets(ability)) {
            return "spell-copy-targets-not-represented";
        }
        if (ability.getMinTargets() != 1 || ability.getMaxTargets() != 1) {
            return "not-exactly-one-target";
        }
        for (SpellAbility sub = ability.getSubAbility(); sub != null; sub = sub.getSubAbility()) {
            if (sub.usesTargeting()) {
                return "multiple-targeting-steps";
            }
        }
        Cost cost = ability.getPayCosts();
        if (cost == null || !cost.isOnlyManaCost()) {
            return "non-mana-casting-cost";
        }
        return null;
    }

    private static ManaProfile manaProfile(Player viewer, SpellAbility ability) {
        ManaCost printedCost = ability.getPayCosts().getTotalMana();
        if (printedCost == null || printedCost.isNoCost()) {
            return null;
        }
        ManaCostBeingPaid adjusted = ComputerUtilMana.calculateManaCost(
                ability.getPayCosts(),
                ability,
                viewer,
                true,
                0,
                false
        );
        if (adjusted.getXcounter() > 0) {
            return null;
        }
        List<String> requirements = new ArrayList<>();
        for (ManaCostShard shard : adjusted.getUnpaidShards()) {
            String color = switch (shard) {
                case WHITE -> "W";
                case BLUE -> "U";
                case BLACK -> "B";
                case RED -> "R";
                case GREEN -> "G";
                case COLORLESS -> "C";
                case GENERIC -> "*";
                default -> null;
            };
            if (color == null) {
                return null;
            }
            requirements.add(color);
        }
        return new ManaProfile(requirements, printedCost.toString(), adjusted.toString());
    }

    private static List<ManaOption> manaOptions(Player viewer, List<ManaSourceExclusion> exclusions) {
        List<ManaOption> result = new ArrayList<>();
        for (Card source : ComputerUtilMana.getAvailableManaSources(viewer, true)) {
            if (!source.isInZone(ZoneType.Battlefield)) {
                continue;
            }
            for (SpellAbility ability : ComputerUtilMana.getAIPlayableMana(source)) {
                ability.setActivatingPlayer(viewer);
                Cost cost = ability.getPayCosts();
                if (!ability.canPlay()
                        || !ability.checkRestrictions(viewer)
                        || cost == null
                        || !cost.hasOnlySpecificCostType(CostTap.class)
                        || ability.amountOfManaGenerated(true) != 1) {
                    continue;
                }
                // Filtering is per mana ability, not per card. A dual land exposes a
                // separate single-colour ability per colour and stays admitted; only an
                // ability that can itself produce several colours is excluded, because
                // Forge would resolve that colour through PlayerController.chooseColor
                // at activation - a decision this expander does not represent.
                TreeSet<String> producible = new TreeSet<>();
                for (String color : MANA_COLORS) {
                    if (ability.canProduce(color)) {
                        producible.add(color);
                    }
                }
                if (producible.size() == 1) {
                    result.add(new ManaOption(source, ability, producible.first()));
                } else if (producible.size() > 1) {
                    exclusions.add(new ManaSourceExclusion(
                            source, ability, List.copyOf(producible), viewer));
                }
            }
        }
        result.sort(Comparator
                .comparingInt((ManaOption option) -> option.source().getId())
                .thenComparingInt(option -> option.ability().getId())
                .thenComparing(ManaOption::color));
        return result;
    }

    private static List<ManaPlan> manaPlans(List<String> requirements, List<ManaOption> options) {
        List<ManaPlan> result = new ArrayList<>();
        collectManaPlans(requirements, options, 0, new LinkedHashSet<>(), new ArrayList<>(), result);

        Map<String, ManaPlan> unique = new LinkedHashMap<>();
        for (ManaPlan plan : result) {
            unique.putIfAbsent(plan.signature(), plan);
        }
        return new ArrayList<>(unique.values());
    }

    private static void collectManaPlans(
            List<String> requirements,
            List<ManaOption> options,
            int requirementIndex,
            Set<Integer> usedSourceIds,
            List<ManaOption> selected,
            List<ManaPlan> result
    ) {
        if (requirementIndex == requirements.size()) {
            List<ManaOption> normalized = selected.stream()
                    .sorted(Comparator
                            .comparingInt((ManaOption option) -> option.source().getId())
                            .thenComparingInt(option -> option.ability().getId())
                            .thenComparing(ManaOption::color))
                    .toList();
            result.add(new ManaPlan(normalized));
            return;
        }

        String requirement = requirements.get(requirementIndex);
        for (ManaOption option : options) {
            int sourceId = option.source().getId();
            if (usedSourceIds.contains(sourceId)
                    || (!requirement.equals("*") && !requirement.equals(option.color()))) {
                continue;
            }
            usedSourceIds.add(sourceId);
            selected.add(option);
            collectManaPlans(requirements, options, requirementIndex + 1, usedSourceIds, selected, result);
            selected.remove(selected.size() - 1);
            usedSourceIds.remove(sourceId);
        }
    }

    private static ExpandedAction expandedAction(
            Player viewer,
            Card source,
            SpellAbility ability,
            Player target,
            ManaPlan plan,
            ManaProfile manaProfile
    ) {
        int targetSeat = ObservationWriter.seatOf(viewer.getGame(), target);
        String targetKey = "player-" + target.getId();
        String actionId = "cast-card-" + source.getId()
                + "-ability-" + ability.getId()
                + "-target-" + targetKey
                + "-pay-" + plan.signature();

        Map<String, Object> action = new LinkedHashMap<>();
        action.put("id", actionId);
        action.put("category", "CAST_SPELL");
        action.put("expansionVersion", EXPANSION_VERSION);
        action.put("sourceCardId", "card-" + source.getId());
        action.put("source", ObservationWriter.card(source, viewer));
        action.put("abilityId", "ability-" + ability.getId());
        action.put("description", ability.getDescription());
        action.put("printedManaCost", manaProfile.printedCost());
        action.put("manaCost", manaProfile.effectiveCost());
        action.put("usesTargeting", true);
        action.put("timingAndZoneLegal", true);
        // This action reached the end of expansion with an exact target and an
        // exact payment, so the empty list is an assertion, not a default. The
        // same list object is both serialized here and gated on before execution,
        // so the published capture and the executor can never disagree.
        List<UnrepresentedChoice> unrepresentedChoices = List.of();
        action.put("unrepresentedChoices", unrepresentedChoices.stream()
                .map(UnrepresentedChoice::toJson)
                .toList());
        action.put("executable", unrepresentedChoices.isEmpty());
        action.put("requiresChoiceExpansion", !unrepresentedChoices.isEmpty());

        Map<String, Object> targetChoice = new LinkedHashMap<>();
        targetChoice.put("kind", "PLAYER");
        targetChoice.putAll(ObservationWriter.playerReference(target, targetSeat));

        Map<String, Object> payment = new LinkedHashMap<>();
        payment.put("kind", "MANA");
        payment.put("manaCount", plan.options().size());
        payment.put("mana", plan.options().stream().map(option -> manaChoice(viewer, option)).toList());

        Map<String, Object> choices = new LinkedHashMap<>();
        choices.put("targets", List.of(targetChoice));
        choices.put("payment", payment);
        action.put("choices", choices);
        return new ExpandedAction(action, ability, target, plan, unrepresentedChoices);
    }

    private static Map<String, Object> manaChoice(Player viewer, ManaOption option) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("color", option.color());
        result.put("sourceCardId", "card-" + option.source().getId());
        result.put("source", option.source().getName());
        result.put("sourceControllerSeat", ObservationWriter.seatOf(
                viewer.getGame(),
                option.source().getController()
        ));
        result.put("manaAbilityId", "ability-" + option.ability().getId());
        return result;
    }

    /**
     * Everything known about one enumeration attempt.
     *
     * <p>This record is the single source of truth for enumeration honesty.
     * {@link #complete()} is the <strong>one</strong> definition of completeness in
     * the codebase: the serializer and the pre-execution guard both consume the same
     * instance, so a capture can never claim a completeness the guard disagrees
     * with.</p>
     */
    public record Expansion(
            List<ExpandedAction> actions,
            Map<String, Integer> skippedCandidates,
            boolean truncated,
            boolean attempted,
            String suppressedReason,
            boolean candidateScanComplete,
            List<InspectedAbility> inspectedAbilities,
            List<Card> uninspectedSourceCards,
            List<ManaSourceExclusion> manaSourceExclusions
    ) {
        /** An observation path that never ran the expander at all. */
        public static Expansion unattempted() {
            return new Expansion(List.of(), Map.of(), false, false, null, false,
                    List.of(), List.of(), List.of());
        }

        /** Attempted, but refused to enumerate for a declared reason. */
        public static Expansion suppressed(String reason, Map<String, Integer> skipped) {
            return new Expansion(List.of(), Map.copyOf(skipped), false, true, reason, false,
                    List.of(), List.of(), List.of());
        }

        /**
         * THE definition of completeness. Complete means: the expander ran, was not
         * suppressed, never hit the action limit, and inspected every candidate unit.
         */
        public boolean complete() {
            return attempted && suppressedReason == null && !truncated && candidateScanComplete;
        }

        public boolean candidateUnitsMayBeUninspected() {
            return !candidateScanComplete;
        }

        public int emittedActionCount() {
            return actions.size();
        }

        public int actionLimit() {
            return MAX_ACTIONS;
        }

        /**
         * Exact total the supported boundary could emit, or null when unknowable.
         *
         * <p>Null whenever the candidate scan did not complete: units the break chain
         * never reached could contribute any amount, so any number here would be a
         * guess presented as a fact.</p>
         */
        public Integer totalCapacity() {
            if (!candidateScanComplete) {
                return null;
            }
            int total = 0;
            for (InspectedAbility entry : inspectedAbilities) {
                if (entry.capacity() != null) {
                    total += entry.capacity();
                }
            }
            return total;
        }

        /** Exact omission count, or null when the total capacity is unknown. */
        public Integer omittedActionCount() {
            Integer capacity = totalCapacity();
            return capacity == null ? null : capacity - emittedActionCount();
        }

        /**
         * Proven lower bound on omissions, always available.
         *
         * <p>Summed only over units actually inspected, so it stays true even when
         * the scan stopped early.</p>
         */
        public int omittedActionCountAtLeast() {
            int atLeast = 0;
            for (InspectedAbility entry : inspectedAbilities) {
                if (entry.capacity() != null && entry.emitted() != null) {
                    atLeast += entry.capacity() - entry.emitted();
                }
            }
            return atLeast;
        }
    }

    /** One inspected (sourceCard, ability) unit. Never fabricated. */
    public record InspectedAbility(
            Card source,
            SpellAbility ability,
            String outcome,
            String reason,
            Integer targetCount,
            Integer planCount,
            Integer capacity,
            Integer emitted
    ) {
        static InspectedAbility skipped(Card source, SpellAbility ability, String reason) {
            return new InspectedAbility(source, ability, "SKIPPED", reason, null, null, null, null);
        }

        public static InspectedAbility expanded(Card source, SpellAbility ability,
                int targetCount, int planCount, int capacity, int emitted) {
            return new InspectedAbility(source, ability, "EXPANDED", null,
                    targetCount, planCount, capacity, emitted);
        }

        public Integer omitted() {
            return capacity == null || emitted == null ? null : capacity - emitted;
        }
    }

    /**
     * One mana ability excluded because its colour is a decision, not a fact.
     *
     * <p>Excluded paths contribute to neither capacity nor omission arithmetic:
     * they are outside the declared supported boundary rather than missing from
     * within it.</p>
     */
    public record ManaSourceExclusion(
            Card source,
            SpellAbility ability,
            List<String> producibleColors,
            Player viewer
    ) {
        public Map<String, Object> toJson() {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("unit", "MANA_ABILITY");
            result.put("outcome", "EXCLUDED");
            result.put("sourceCardId", "card-" + source.getId());
            result.put("manaAbilityId", "ability-" + ability.getId());
            result.put("source", ObservationWriter.card(source, viewer));
            result.put("reason", "mana-source-with-selectable-colour");
            result.put("producibleColors", producibleColors);
            return result;
        }
    }

    /**
     * One fully specified action.
     *
     * <p>{@code unrepresentedChoices} is the typed source of truth: {@code json}
     * serializes this very list, and the executor gates on it before handing the
     * ability to Forge. Keeping one value rather than recomputing it means the
     * published capture and the execution decision cannot drift apart.</p>
     */
    public record ExpandedAction(
            Map<String, Object> json,
            SpellAbility ability,
            GameObject target,
            ManaPlan payment,
            List<UnrepresentedChoice> unrepresentedChoices
    ) {
    }

    public record ManaPlan(List<ManaOption> options) {
        String signature() {
            if (options.isEmpty()) {
                return "none";
            }
            List<String> parts = new ArrayList<>();
            for (ManaOption option : options) {
                parts.add("card" + option.source().getId()
                        + "a" + option.ability().getId()
                        + option.color().toLowerCase());
            }
            return String.join("-", parts);
        }
    }

    public record ManaOption(Card source, SpellAbility ability, String color) {
    }

    private record ManaProfile(
            List<String> requirements,
            String printedCost,
            String effectiveCost
    ) {
    }
}
