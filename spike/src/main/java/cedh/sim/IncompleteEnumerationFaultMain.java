package cedh.sim;

import java.util.List;
import java.util.Map;

/**
 * TEST-ONLY: proves the set-level guard refuses an incomplete enumeration.
 *
 * <p>P7 established that no approved deck can reach the action limit inside the
 * supported boundary, so no natural truncated fixture exists to test against.
 * Rather than lower the limit, add a bypass, or invent a production flag, this
 * entry point constructs a truncated {@code Expansion} value directly and hands
 * it to the guard.</p>
 *
 * <p>Structural isolation: production code never constructs an {@code Expansion}
 * this way — {@link SimpleSpellActionExpander#expand} is the only production
 * source, and it sets {@code truncated} solely from the real action limit. There
 * is no flag, environment variable, injected provider, configurable cap, or
 * runtime bypass anywhere in the production path; this class is reachable only
 * through its own {@code main}.</p>
 *
 * <p><strong>What this proves:</strong> the guard's refusal mechanics, its typed
 * exception, its exit code, and that it is placed before selection and
 * execution. <strong>What it does not prove:</strong> that real Forge ever
 * reached 512 actions, that a natural truncated prefix exists, that a naturally
 * truncated state was refused, anything about DFS performance at the limit, or
 * reproducibility of a natural truncated fixture.</p>
 */
public final class IncompleteEnumerationFaultMain {
    private IncompleteEnumerationFaultMain() {
    }

    public static void main(String[] args) {
        // A truncated enumeration always knows of at least one action it did not
        // emit, so the fixture carries an inspected unit whose capacity exceeds what
        // it emitted. Card and ability references are null because this entry point
        // runs without a game; only the counts matter to the guard, and nothing here
        // is ever serialized.
        SimpleSpellActionExpander.InspectedAbility partiallyEmitted =
                SimpleSpellActionExpander.InspectedAbility.expanded(null, null, 4, 130, 520, 512);

        SimpleSpellActionExpander.Expansion truncated = new SimpleSpellActionExpander.Expansion(
                List.of(),
                Map.of("synthetic-truncated-fixture", 1),
                true,
                true,
                null,
                false,
                List.of(partiallyEmitted),
                List.of(),
                List.of()
        );

        System.out.println("SYNTHETIC_FIXTURE=truncated"
                + " complete=" + truncated.complete()
                + " truncated=" + truncated.truncated()
                + " candidateScanComplete=" + truncated.candidateScanComplete()
                + " totalCapacity=" + truncated.totalCapacity()
                + " omittedActionCount=" + truncated.omittedActionCount()
                + " omittedActionCountAtLeast=" + truncated.omittedActionCountAtLeast());

        try {
            EnumerationGuard.requireCompleteEnumeration("Synthetic truncated enumeration", truncated);
        } catch (IncompleteEnumerationException refusal) {
            System.out.println("PROBE_REFUSED_WITH=" + refusal.getClass().getSimpleName());
            refusal.printStackTrace(System.out);
            System.out.flush();
            System.exit(IncompleteEnumerationException.EXIT_CODE);
        }

        System.out.println("PROBE_FAILED: the guard accepted an incomplete enumeration");
        System.exit(1);
    }
}
