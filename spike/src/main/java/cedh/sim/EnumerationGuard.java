package cedh.sim;

/**
 * The set-level gate: refuses to choose from an enumeration known to be
 * incomplete.
 *
 * <p>This sits alongside {@link ActionChoiceAudit#requireRepresented}, it does not
 * replace it. The two answer different questions:</p>
 *
 * <ul>
 *   <li>{@code requireRepresented} — "does <em>this action</em> still hide a
 *       decision?"</li>
 *   <li>{@code requireCompleteEnumeration} — "was the <em>set</em> this action was
 *       chosen from actually all of them?"</li>
 * </ul>
 *
 * <p>An action can pass the first and fail the second. Picking the best of 512
 * when the real option space was larger is not a decision over the legal options,
 * however complete each individual option is.</p>
 *
 * <p>This makes no claim that expansion itself is observationally pure. It only
 * refuses to <em>act</em> on a set that is known to be partial, and it consumes
 * the same {@code Expansion} instance that the capture serializes, so guard and
 * capture cannot disagree.</p>
 */
public final class EnumerationGuard {
    private EnumerationGuard() {
    }

    public static void requireCompleteEnumeration(
            String context,
            SimpleSpellActionExpander.Expansion expansion
    ) {
        if (!expansion.complete()) {
            throw new IncompleteEnumerationException(context, expansion);
        }
    }
}
