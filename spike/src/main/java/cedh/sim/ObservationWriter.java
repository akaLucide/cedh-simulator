package cedh.sim;

import com.google.common.collect.Multiset;
import forge.card.MagicColor;
import forge.game.Game;
import forge.game.GameObject;
import forge.game.card.Card;
import forge.game.card.CounterType;
import forge.game.mana.Mana;
import forge.game.phase.PhaseHandler;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.spellability.SpellAbilityStackInstance;
import forge.game.zone.ZoneType;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Produces the first versioned, player-scoped observation consumed by future
 * local agents and the tabletop UI.
 *
 * <p>This deliberately starts from Forge's visibility rules instead of the
 * authoritative card model. Hidden hands and libraries expose counts only;
 * face-down public-zone objects retain a stable opaque id without revealing a
 * name.</p>
 */
public final class ObservationWriter {
    private static final List<ZoneType> PUBLIC_CARD_ZONES = List.of(
            ZoneType.Battlefield,
            ZoneType.Graveyard,
            ZoneType.Exile,
            ZoneType.Command
    );

    /**
     * How the captured state was reached.
     *
     * <p>Set once per probe process, before any capture is written. A staged
     * capture is one whose starting state the probe arranged deliberately — it is
     * evidence about the adapter, not about a natural game, and must never be
     * presented as same-state comparable with a natural capture.</p>
     */
    private static Map<String, Object> fixture = naturalFixture();

    private ObservationWriter() {
    }

    private static Map<String, Object> naturalFixture() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("kind", "natural");
        return result;
    }

    /** Declares the capture as reached by ordinary play from the seed. */
    public static void setNaturalFixture() {
        fixture = naturalFixture();
    }

    /** Declares the capture as reached by deliberately staging a card. */
    public static void setStagedFixture(String stagedCard, String sourceZone, String cliArgument) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("kind", "staged");
        result.put("stagedCard", stagedCard);
        result.put("sourceZone", sourceZone);
        result.put("cliArgument", cliArgument);
        fixture = result;
    }

    public static void write(Path output, Player viewer, int viewerSeat) throws IOException {
        write(output, viewer, viewerSeat, null, List.of());
    }

    public static void write(
            Path output,
            Player viewer,
            int viewerSeat,
            Map<String, Object> actionContext
    ) throws IOException {
        write(
                output,
                viewer,
                viewerSeat,
                actionContext,
                actionContext == null ? List.of() : List.of(actionContext)
        );
    }

    public static void write(
            Path output,
            Player viewer,
            int viewerSeat,
            Map<String, Object> actionContext,
            List<Map<String, Object>> expandedActions
    ) throws IOException {
        Map<String, Object> observation = capture(viewer, viewerSeat, actionContext, expandedActions);
        Path parent = output.toAbsolutePath().getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Files.writeString(output, toJson(observation) + System.lineSeparator(), StandardCharsets.UTF_8);
    }

    static Map<String, Object> capture(Player viewer, int viewerSeat) {
        return capture(viewer, viewerSeat, null, List.of());
    }

    static Map<String, Object> capture(
            Player viewer,
            int viewerSeat,
            Map<String, Object> actionContext,
            List<Map<String, Object>> expandedActions
    ) {
        Game game = viewer.getGame();
        PhaseHandler phase = game.getPhaseHandler();
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("schemaVersion", 2);
        root.put("fixture", fixture);
        root.put("viewer", playerReference(viewer, viewerSeat));

        Map<String, Object> gameState = new LinkedHashMap<>();
        gameState.put("turn", phase.getTurn());
        gameState.put("phase", phase.getPhase() == null ? null : phase.getPhase().name());
        gameState.put("activePlayer", playerReference(phase.getPlayerTurn(), seatOf(game, phase.getPlayerTurn())));
        gameState.put("priorityPlayer", playerReference(phase.getPriorityPlayer(), seatOf(game, phase.getPriorityPlayer())));
        gameState.put("stack", stack(game));
        root.put("game", gameState);

        List<Map<String, Object>> players = new ArrayList<>();
        int seat = 1;
        for (Player player : game.getPlayers()) {
            players.add(playerState(player, viewer, seat++));
        }
        root.put("players", players);
        root.put("availableActions", availableActions(viewer, expandedActions));
        if (actionContext != null) {
            root.put("actionContext", actionContext);
        }

        Map<String, Object> informationPolicy = new LinkedHashMap<>();
        informationPolicy.put("opponentHands", "count-only");
        informationPolicy.put("allLibraries", "count-only");
        informationPolicy.put("faceDownCards", "opaque-id-only-unless-viewer-may-look");
        informationPolicy.put("knownCardMemory", "not-yet-implemented");
        root.put("informationPolicy", informationPolicy);
        return root;
    }

    private static Map<String, Object> playerState(Player player, Player viewer, int seat) {
        Map<String, Object> state = new LinkedHashMap<>();
        state.putAll(playerReference(player, seat));
        state.put("life", player.getLife());
        state.put("poison", player.getPoisonCounters());
        state.put("hasLost", player.hasLost());

        Map<String, Object> zones = new LinkedHashMap<>();
        zones.put("hand", privateZone(player, viewer, ZoneType.Hand, player.equals(viewer)));
        zones.put("library", countOnlyZone(player, ZoneType.Library));
        for (ZoneType zone : PUBLIC_CARD_ZONES) {
            zones.put(zone.name().toLowerCase(), visibleZone(player, viewer, zone));
        }
        state.put("zones", zones);

        List<Map<String, Object>> commanders = new ArrayList<>();
        for (Card commander : player.getCommanders()) {
            Map<String, Object> commandState = card(commander, viewer);
            commandState.put("timesCast", player.getCommanderCast(commander));
            commanders.add(commandState);
        }
        state.put("commanders", commanders);
        return state;
    }

    private static Map<String, Object> privateZone(
            Player owner,
            Player viewer,
            ZoneType zone,
            boolean revealIdentities
    ) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("count", owner.getCardsIn(zone).size());
        result.put("visibility", revealIdentities ? "viewer" : "hidden");
        if (revealIdentities) {
            List<Map<String, Object>> cards = new ArrayList<>();
            for (Card card : owner.getCardsIn(zone)) {
                cards.add(card(card, viewer));
            }
            result.put("cards", cards);
        }
        return result;
    }

    private static Map<String, Object> countOnlyZone(Player owner, ZoneType zone) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("count", owner.getCardsIn(zone).size());
        result.put("visibility", "count-only");
        return result;
    }

    private static Map<String, Object> visibleZone(Player owner, Player viewer, ZoneType zone) {
        Map<String, Object> result = new LinkedHashMap<>();
        List<Map<String, Object>> cards = new ArrayList<>();
        for (Card card : owner.getCardsIn(zone)) {
            cards.add(card(card, viewer));
        }
        result.put("count", cards.size());
        result.put("visibility", "card-objects");
        result.put("cards", cards);
        return result;
    }

    static Map<String, Object> card(Card card, Player viewer) {
        boolean objectVisible = card.getView().canBeShownTo(viewer.getView());
        boolean faceVisible = objectVisible && card.getView().canFaceDownBeShownTo(viewer.getView());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", faceVisible ? "card-" + card.getId() : "hidden-" + card.getHiddenId());
        result.put("name", faceVisible ? card.getName() : null);
        result.put("visibility", faceVisible ? "known" : "hidden");
        result.put("faceDown", card.isFaceDown());
        result.put("zone", card.getZone() == null ? null : card.getZone().getZoneType().name());
        result.put("ownerSeat", seatOf(card.getGame(), card.getOwner()));
        result.put("controllerSeat", seatOf(card.getGame(), card.getController()));

        if (faceVisible && card.isInPlay()) {
            result.put("tapped", card.isTapped());
            if (card.hasCounters()) {
                Map<String, Integer> counters = new LinkedHashMap<>();
                List<Multiset.Entry<CounterType>> entries = new ArrayList<>(card.getCounters().entrySet());
                entries.sort(Comparator.comparing(entry -> entry.getElement().getName()));
                for (Multiset.Entry<CounterType> entry : entries) {
                    counters.put(entry.getElement().getName(), entry.getCount());
                }
                result.put("counters", counters);
            }
        }
        return result;
    }

    private static List<Map<String, Object>> stack(Game game) {
        List<Map<String, Object>> stack = new ArrayList<>();
        for (SpellAbilityStackInstance item : game.getStack()) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("id", "stack-" + item.getId());
            result.put("sourceCardId", "card-" + item.getSourceCard().getId());
            result.put("source", item.getSourceCard().getName());
            result.put("controllerSeat", seatOf(game, item.getSpellAbility().getActivatingPlayer()));
            result.put("kind", item.isSpell() ? "spell" : item.isTrigger() ? "trigger" : "ability");
            result.put("description", item.getStackDescription());
            result.put("targets", targets(game, item.getSpellAbility()));
            result.put("payment", payment(game, item.getSpellAbility()));
            stack.add(result);
        }
        return stack;
    }

    private static Map<String, Object> availableActions(
            Player viewer,
            List<Map<String, Object>> completeActions
    ) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("enumerationVersion", 2);
        List<Map<String, Object>> actions = new ArrayList<>();

        // Passing priority asks the player nothing, so it is the one action that
        // is complete without an audit.
        Map<String, Object> pass = new LinkedHashMap<>();
        pass.put("id", "pass-priority");
        pass.put("category", "PASS_PRIORITY");
        pass.put("unrepresentedChoices", List.of());
        pass.put("executable", true);
        actions.add(pass);

        Set<Card> candidateCards = new LinkedHashSet<>();
        candidateCards.addAll(viewer.getCardsIn(ZoneType.Hand));
        candidateCards.addAll(viewer.getCardsIn(ZoneType.Battlefield));
        candidateCards.addAll(viewer.getCardsActivatableInExternalZones(true));

        for (Card source : candidateCards) {
            if (!source.getView().canBeShownTo(viewer.getView())
                    || !source.getView().canFaceDownBeShownTo(viewer.getView())) {
                continue;
            }
            for (SpellAbility ability : source.getAllPossibleAbilities(viewer, true)) {
                Map<String, Object> action = new LinkedHashMap<>();
                action.put("id", "ability-" + ability.getId());
                action.put("category", category(ability));
                action.put("source", card(source, viewer));
                action.put("description", ability.getDescription());
                action.put("cost", ability.getPayCosts() == null ? null : ability.getPayCosts().toString());
                action.put("manaCost", ability.getPayCosts() == null
                        ? null
                        : ability.getPayCosts().getTotalMana().toString());
                action.put("api", ability.getApi() == null ? null : ability.getApi().name());
                action.put("usesTargeting", ability.usesTargeting());
                action.put("timingAndZoneLegal", true);

                // v2: `executable` carries no independent information. It is true
                // exactly when the audit proved every decision represented.
                List<UnrepresentedChoice> choices = ActionChoiceAudit.audit(ability);
                List<Map<String, Object>> choiceJson = new ArrayList<>();
                for (UnrepresentedChoice choice : choices) {
                    choiceJson.add(choice.toJson());
                }
                action.put("unrepresentedChoices", choiceJson);
                action.put("executable", choiceJson.isEmpty());
                action.put("requiresChoiceExpansion", !choiceJson.isEmpty());
                actions.add(action);
            }
        }

        for (Map<String, Object> completeAction : completeActions) {
            if (actionSourceIsStillInHand(viewer, completeAction)) {
                actions.add(completeAction);
            }
        }

        result.put("actions", actions);
        result.put("completeness", "audited-actions-only-executable-derived-from-unrepresented-choices");
        result.put("limitations", List.of(
                "An action is executable only when the audit proved every decision represented.",
                "The adapter supplies complete payment-and-target plans for its supported simple-spell boundary.",
                "Modes, X values, divisions, ordering, and optional costs are not expanded yet.",
                "Unexpanded candidate abilities are not mana-affordability checked.",
                "A land play with a battlefield-entry trigger is not yet auditable and stays non-executable.",
                "Special actions other than land play are not enumerated yet."
        ));
        return result;
    }

    private static boolean actionSourceIsStillInHand(Player viewer, Map<String, Object> action) {
        Object sourceCardId = action.get("sourceCardId");
        if (!(sourceCardId instanceof String expectedId)) {
            return false;
        }
        for (Card card : viewer.getCardsIn(ZoneType.Hand)) {
            if (expectedId.equals("card-" + card.getId())) {
                return true;
            }
        }
        return false;
    }

    private static List<Map<String, Object>> targets(Game game, SpellAbility ability) {
        List<Map<String, Object>> targets = new ArrayList<>();
        for (GameObject target : ability.getTargets()) {
            Map<String, Object> result = new LinkedHashMap<>();
            if (target instanceof Player player) {
                result.put("kind", "PLAYER");
                result.putAll(playerReference(player, seatOf(game, player)));
            } else if (target instanceof Card card) {
                result.put("kind", "CARD");
                result.put("id", "card-" + card.getId());
                result.put("name", card.getName());
                result.put("controllerSeat", seatOf(game, card.getController()));
            } else if (target instanceof SpellAbility spell) {
                result.put("kind", "SPELL");
                result.put("sourceCardId", "card-" + spell.getHostCard().getId());
                result.put("source", spell.getHostCard().getName());
            }
            targets.add(result);
        }
        return targets;
    }

    private static Map<String, Object> payment(Game game, SpellAbility ability) {
        Map<String, Object> result = new LinkedHashMap<>();
        List<Map<String, Object>> manaPaid = new ArrayList<>();
        for (Mana mana : ability.getPayingMana()) {
            Map<String, Object> paid = new LinkedHashMap<>();
            paid.put("color", MagicColor.toShortString(mana.getColor()));
            paid.put("sourceCardId", "card-" + mana.getSourceCard().getId());
            paid.put("source", mana.getSourceCard().getName());
            paid.put("sourceControllerSeat", seatOf(game, mana.getSourceCard().getController()));
            manaPaid.add(paid);
        }
        result.put("manaCount", manaPaid.size());
        result.put("mana", manaPaid);
        result.put("lifePaid", ability.getAmountLifePaid());
        return result;
    }

    private static String category(SpellAbility ability) {
        if (ability.isLandAbility()) {
            return "PLAY_LAND";
        }
        if (ability.isSpell()) {
            return "CAST_SPELL";
        }
        if (ability.isManaAbility()) {
            return "ACTIVATE_MANA_ABILITY";
        }
        return "ACTIVATE_ABILITY";
    }

    static Map<String, Object> playerReference(Player player, int seat) {
        if (player == null) {
            return null;
        }
        Map<String, Object> reference = new LinkedHashMap<>();
        reference.put("seat", seat);
        reference.put("id", player.getId());
        reference.put("name", player.getName());
        return reference;
    }

    static int seatOf(Game game, Player target) {
        if (target == null) {
            return 0;
        }
        int seat = 1;
        for (Player player : game.getPlayers()) {
            if (player.equals(target)) {
                return seat;
            }
            seat++;
        }
        return 0;
    }

    /** Small dependency-free JSON encoder for maps, lists, and scalar values. */
    private static String toJson(Object value) {
        StringBuilder output = new StringBuilder();
        appendJson(output, value, 0);
        return output.toString();
    }

    private static void appendJson(StringBuilder output, Object value, int depth) {
        if (value == null) {
            output.append("null");
        } else if (value instanceof String text) {
            appendQuoted(output, text);
        } else if (value instanceof Number || value instanceof Boolean) {
            output.append(value);
        } else if (value instanceof Map<?, ?> map) {
            output.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!first) {
                    output.append(',');
                }
                newlineAndIndent(output, depth + 1);
                appendQuoted(output, String.valueOf(entry.getKey()));
                output.append(": ");
                appendJson(output, entry.getValue(), depth + 1);
                first = false;
            }
            if (!map.isEmpty()) {
                newlineAndIndent(output, depth);
            }
            output.append('}');
        } else if (value instanceof Iterable<?> values) {
            output.append('[');
            boolean first = true;
            for (Object item : values) {
                if (!first) {
                    output.append(',');
                }
                newlineAndIndent(output, depth + 1);
                appendJson(output, item, depth + 1);
                first = false;
            }
            if (!first) {
                newlineAndIndent(output, depth);
            }
            output.append(']');
        } else {
            throw new IllegalArgumentException("Unsupported JSON value: " + value.getClass().getName());
        }
    }

    private static void newlineAndIndent(StringBuilder output, int depth) {
        output.append('\n').append("  ".repeat(depth));
    }

    private static void appendQuoted(StringBuilder output, String text) {
        output.append('"');
        for (int index = 0; index < text.length(); index++) {
            char character = text.charAt(index);
            switch (character) {
                case '"' -> output.append("\\\"");
                case '\\' -> output.append("\\\\");
                case '\b' -> output.append("\\b");
                case '\f' -> output.append("\\f");
                case '\n' -> output.append("\\n");
                case '\r' -> output.append("\\r");
                case '\t' -> output.append("\\t");
                default -> {
                    if (character < 0x20) {
                        output.append(String.format("\\u%04x", (int) character));
                    } else {
                        output.append(character);
                    }
                }
            }
        }
        output.append('"');
    }
}
