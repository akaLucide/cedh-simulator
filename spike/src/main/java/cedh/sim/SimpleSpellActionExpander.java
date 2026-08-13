package cedh.sim;

import forge.ai.ComputerUtilMana;
import forge.card.mana.ManaCost;
import forge.card.mana.ManaCostShard;
import forge.game.GameObject;
import forge.game.card.Card;
import forge.game.cost.Cost;
import forge.game.cost.CostTap;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

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
        boolean truncated = false;

        if (viewer.getManaPool().totalMana() != 0) {
            skipped.put("floating-mana-not-supported", 1);
            return new Expansion(actions, skipped, false);
        }

        List<ManaOption> manaOptions = manaOptions(viewer);
        for (Card source : viewer.getCardsIn(ZoneType.Hand)) {
            for (SpellAbility ability : source.getAllPossibleAbilities(viewer, true)) {
                String unsupported = unsupportedReason(ability);
                if (unsupported != null) {
                    skipped.merge(unsupported, 1, Integer::sum);
                    continue;
                }

                ManaProfile manaProfile = manaProfile(viewer, ability);
                if (manaProfile == null) {
                    skipped.merge("non-fixed-or-complex-mana-cost", 1, Integer::sum);
                    continue;
                }
                List<ManaPlan> plans = manaPlans(manaProfile.requirements(), manaOptions);
                if (plans.isEmpty()) {
                    skipped.merge("no-supported-mana-plan", 1, Integer::sum);
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
                    continue;
                }

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
                if (truncated) {
                    break;
                }
            }
            if (truncated) {
                break;
            }
        }

        actions.sort(Comparator.comparing(action -> (String) action.json().get("id")));
        return new Expansion(actions, skipped, truncated);
    }

    private static String unsupportedReason(SpellAbility ability) {
        if (!ability.isSpell() || !ability.usesTargeting()) {
            return "not-a-targeted-spell";
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

    private static List<ManaOption> manaOptions(Player viewer) {
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
                for (String color : MANA_COLORS) {
                    if (ability.canProduce(color)) {
                        result.add(new ManaOption(source, ability, color));
                    }
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

    public record Expansion(
            List<ExpandedAction> actions,
            Map<String, Integer> skippedCandidates,
            boolean truncated
    ) {
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
