package cedh.sim;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * One strategically relevant decision the adapter has not represented.
 *
 * <p>An action carrying any of these must not be executable, because handing it
 * to Forge would let the engine or stock AI answer the decision on behalf of the
 * human or agent without recording it.</p>
 *
 * <p><strong>{@code code} names a choice type, not a unique instance.</strong>
 * Two choices of the same kind on one action would share a code, so a recorded
 * answer cannot be keyed by it. Per-instance choice identity is deferred to the
 * M2 canonical identity design; until then, expansion is only sound for actions
 * carrying exactly one entry.</p>
 */
public record UnrepresentedChoice(
        String code,
        DecisionType decisionType,
        Source source,
        String description,
        Timing timing,
        Boolean optional,
        Amount amount,
        List<String> outcomes
) {
    /** Selects the strategy a later expander would use to enumerate the choice. */
    public enum DecisionType {
        OPTIONAL_COST,
        MODE,
        TARGET,
        PAYMENT,
        ORDERING,
        VALUE,
        UNKNOWN
    }

    /** When Forge asks the question, which decides where an expander must intervene. */
    public enum Timing {
        ON_CAST,
        ON_ENTER,
        ON_RESOLVE,
        UNKNOWN
    }

    /**
     * The object whose rules text creates the choice.
     *
     * <p>{@code forgeCardId} is <strong>debug-only</strong>. Forge object ids are
     * not stable across runs — the committed v1 captures differ in ability ids for
     * the same seed and game state — so nothing may key on it. Stable identity is
     * M2.</p>
     */
    public record Source(String forgeCardId, String name, String zone) {
    }

    /** A quantity attached to the choice, such as the life in "you may pay 3 life". */
    public record Amount(String unit, int value) {
    }

    /** The catch-all used when the adapter cannot positively audit an action. */
    public static UnrepresentedChoice unsupportedExpansion(Source source, String description) {
        return new UnrepresentedChoice(
                "UNSUPPORTED_ACTION_EXPANSION",
                DecisionType.UNKNOWN,
                source,
                description,
                Timing.UNKNOWN,
                null,
                null,
                null
        );
    }

    public UnrepresentedChoice {
        if (code == null || code.isEmpty()) {
            throw new IllegalArgumentException("code is required");
        }
        if (decisionType == null) {
            throw new IllegalArgumentException("decisionType is required");
        }
        if (source == null || source.forgeCardId() == null) {
            throw new IllegalArgumentException("source.forgeCardId is required");
        }
        if (description == null || description.isEmpty()) {
            throw new IllegalArgumentException("description is required");
        }
        outcomes = outcomes == null ? null : List.copyOf(outcomes);
    }

    /** Serializes to the shape required by schemas/observation-v2.schema.json. */
    public Map<String, Object> toJson() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("code", code);
        result.put("decisionType", decisionType.name());

        Map<String, Object> sourceJson = new LinkedHashMap<>();
        sourceJson.put("forgeCardId", source.forgeCardId());
        sourceJson.put("name", source.name());
        sourceJson.put("zone", source.zone());
        result.put("source", sourceJson);

        result.put("description", description);
        if (timing != null) {
            result.put("timing", timing.name());
        }
        if (optional != null) {
            result.put("optional", optional);
        }
        if (amount != null) {
            Map<String, Object> amountJson = new LinkedHashMap<>();
            amountJson.put("unit", amount.unit());
            amountJson.put("value", amount.value());
            result.put("amount", amountJson);
        }
        if (outcomes != null) {
            result.put("outcomes", outcomes);
        }
        return result;
    }
}
