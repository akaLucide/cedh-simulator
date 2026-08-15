package cedh.sim;

/**
 * Thrown when an action would be selected from an enumeration known to be
 * incomplete.
 *
 * <p>Distinct from {@link UnrepresentedChoiceException}, which is about a single
 * action hiding a decision. This one is about the <em>set</em>: every emitted
 * action may be individually complete while the set as a whole silently omits
 * others, because the action limit stopped enumeration or the candidate scan
 * never finished. Choosing from such a set looks like a decision over the legal
 * options and is not one.</p>
 *
 * <p>It carries its own exit code so a wrapper can tell "refused because the
 * enumeration was incomplete" apart from "refused because an action hid a
 * choice", and from an ordinary crash.</p>
 */
public final class IncompleteEnumerationException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    /** Process exit code for this refusal. Distinct from the choice refusal's 3. */
    public static final int EXIT_CODE = 4;

    private final transient SimpleSpellActionExpander.Expansion expansion;

    public IncompleteEnumerationException(String context, SimpleSpellActionExpander.Expansion expansion) {
        super(describe(context, expansion));
        this.expansion = expansion;
    }

    public SimpleSpellActionExpander.Expansion expansion() {
        return expansion;
    }

    /** Finds this refusal inside a throwable chain; Forge wraps on some paths. */
    public static IncompleteEnumerationException findIn(Throwable error) {
        for (Throwable current = error; current != null; current = current.getCause()) {
            if (current instanceof IncompleteEnumerationException refusal) {
                return refusal;
            }
            if (current.getCause() == current) {
                break;
            }
        }
        return null;
    }

    private static String describe(String context, SimpleSpellActionExpander.Expansion expansion) {
        return context + " cannot select from an incomplete enumeration:"
                + "\n  attempted                     = " + expansion.attempted()
                + "\n  suppressedReason              = " + expansion.suppressedReason()
                + "\n  truncated                     = " + expansion.truncated()
                + "\n  candidateScanComplete         = " + expansion.candidateScanComplete()
                + "\n  candidateUnitsMayBeUninspected= " + expansion.candidateUnitsMayBeUninspected()
                + "\n  actionLimit                   = " + expansion.actionLimit()
                + "\n  emittedActionCount            = " + expansion.emittedActionCount()
                + "\n  totalCapacity                 = " + expansion.totalCapacity()
                + "\n  omittedActionCount            = " + expansion.omittedActionCount()
                + "\n  omittedActionCountAtLeast     = " + expansion.omittedActionCountAtLeast();
    }
}
