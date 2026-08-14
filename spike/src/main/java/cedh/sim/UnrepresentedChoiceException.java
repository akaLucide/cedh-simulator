package cedh.sim;

import java.util.List;

/**
 * Thrown when an action would reach Forge while a strategically relevant choice
 * is still unrepresented.
 *
 * <p>This is the adapter's fail-loud boundary. It exists so that an unmodelled
 * decision surfaces as a crash rather than as stock Forge AI quietly answering
 * it and producing plausible-looking game data. Two call sites raise it:</p>
 *
 * <ol>
 *   <li>the pre-execution gate, before the action is handed to Forge; and</li>
 *   <li>the decision hook of last resort, if any path still reaches the
 *       engine's question.</li>
 * </ol>
 */
public final class UnrepresentedChoiceException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    /**
     * Process exit code for a refusal, distinct from an ordinary crash.
     *
     * <p>A probe that refuses has behaved correctly while still failing, so the
     * wrapper scripts need to tell "refused as designed" apart from "broke".</p>
     */
    public static final int EXIT_CODE = 3;

    private final transient List<UnrepresentedChoice> choices;

    public UnrepresentedChoiceException(String context, List<UnrepresentedChoice> choices) {
        super(describe(context, choices));
        this.choices = List.copyOf(choices);
    }

    public List<UnrepresentedChoice> choices() {
        return choices;
    }

    /**
     * Finds a refusal inside a throwable chain.
     *
     * <p>Forge wraps controller exceptions on some paths, so probe mains must
     * unwrap before deciding whether a failure was the designed refusal or a real
     * fault. Guards against a self-referential cause chain.</p>
     */
    public static UnrepresentedChoiceException findIn(Throwable error) {
        for (Throwable current = error; current != null; current = current.getCause()) {
            if (current instanceof UnrepresentedChoiceException refusal) {
                return refusal;
            }
            if (current.getCause() == current) {
                break;
            }
        }
        return null;
    }

    private static String describe(String context, List<UnrepresentedChoice> choices) {
        StringBuilder message = new StringBuilder(context)
                .append(" is not executable: ")
                .append(choices.size())
                .append(" unrepresented choice(s)");
        for (UnrepresentedChoice choice : choices) {
            message.append("\n  - ")
                    .append(choice.code())
                    .append(" [").append(choice.decisionType()).append("] ")
                    .append(choice.source().name())
                    .append(": ").append(choice.description());
        }
        return message.toString();
    }
}
