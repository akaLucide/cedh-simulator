package cedh.sim;

import forge.deck.Deck;
import forge.deck.io.DeckSerializer;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameType;
import forge.game.Match;
import forge.game.player.RegisteredPlayer;
import forge.gui.GuiBase;
import forge.model.FModel;
import forge.util.MyRandom;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Random;
import java.util.concurrent.atomic.AtomicBoolean;

/** Proves that one adapter-selected action can execute and return priority. */
public final class LandActionProbeMain {
    /** Exit code for the expected typed refusal, distinct from an ordinary crash. */
    static final int REFUSED_EXIT_CODE = 3;

    private LandActionProbeMain() {
    }

    /** Builds the lobby player for one seat, so probes can vary the controller. */
    interface LobbyFactory {
        LandActionProbeLobbyPlayerAi create(
                String name,
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
        );
    }

    public static void main(String[] args) {
        run(Arguments.parse(args), LandActionProbeLobbyPlayerAi::new);
    }

    static void run(Arguments options, LobbyFactory lobbyFactory) {
        System.setProperty("java.util.Arrays.useLegacyMergeSort", "true");
        System.setProperty("sun.java2d.d3d", "false");
        GuiBase.setInterface(new HeadlessGuiBase());
        FModel.initialize(null, null);
        MyRandom.setRandom(new Random(options.seed));

        if (options.stageIntoHand == null) {
            ObservationWriter.setNaturalFixture();
        } else {
            ObservationWriter.setStagedFixture(
                    options.stageIntoHand,
                    "Library",
                    "--stage-into-hand " + options.stageIntoHand
            );
        }

        AtomicBoolean actionIssued = new AtomicBoolean(false);
        AtomicBoolean completed = new AtomicBoolean(false);
        List<RegisteredPlayer> players = new ArrayList<>();
        for (int index = 0; index < options.decks.size(); index++) {
            Path deckPath = options.deckDirectory.resolve(options.decks.get(index));
            Deck deck = DeckSerializer.fromFile(deckPath.toFile());
            if (deck == null) {
                throw new IllegalArgumentException("Could not load deck: " + deckPath);
            }
            int seat = index + 1;
            players.add(RegisteredPlayer.forCommander(deck).setPlayer(lobbyFactory.create(
                    "Seat(" + seat + ")-" + deck.getName(),
                    seat == options.targetSeat,
                    seat,
                    options.targetPhase,
                    options.sourceName,
                    options.stageIntoHand,
                    options.auditOnly,
                    options.beforeOutput,
                    options.afterOutput,
                    actionIssued,
                    completed
            )));
        }

        GameRules rules = new GameRules(GameType.Commander);
        rules.setAppliedVariants(EnumSet.of(GameType.Commander));
        Match match = new Match(rules, players, "Land action probe");
        Game game = match.createGame();
        try {
            match.startGame(game);
        } catch (RuntimeException error) {
            UnrepresentedChoiceException refusal = refusalIn(error);
            if (refusal == null) {
                throw error;
            }
            // The typed refusal is the probe's expected outcome in guard mode; the
            // wrapper script decides whether that counts as a pass.
            reportHookInvocations();
            System.out.println("PROBE_REFUSED_WITH=" + refusal.getClass().getSimpleName());
            refusal.printStackTrace(System.out);
            System.out.flush();
            System.exit(REFUSED_EXIT_CODE);
        }

        reportHookInvocations();
        if (options.auditOnly) {
            if (!Files.isRegularFile(options.beforeOutput)) {
                throw new IllegalStateException("The audit-only probe did not write its capture");
            }
            System.out.println("Land action audit: " + options.beforeOutput.toAbsolutePath());
            return;
        }
        if (!completed.get()
                || !Files.isRegularFile(options.beforeOutput)
                || !Files.isRegularFile(options.afterOutput)) {
            throw new IllegalStateException("The land action did not complete both captures");
        }
        System.out.println("Land action before: " + options.beforeOutput.toAbsolutePath());
        System.out.println("Land action after: " + options.afterOutput.toAbsolutePath());
    }

    private static void reportHookInvocations() {
        System.out.println(
                "PROBE_HOOK_INVOCATIONS=" + LandActionProbeControllerAi.forgeDecisionHookInvocations()
        );
    }

    /** Forge may wrap a controller exception, so unwrap before classifying it. */
    private static UnrepresentedChoiceException refusalIn(Throwable error) {
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

    static final class Arguments {
        private Path deckDirectory;
        private final List<String> decks = new ArrayList<>();
        private Path beforeOutput;
        private Path afterOutput;
        private int targetSeat = 1;
        private long seed = 1;
        private String targetPhase = "MAIN1";
        private String sourceName;
        private String stageIntoHand;
        private boolean auditOnly;

        static Arguments parse(String[] args) {
            Arguments result = new Arguments();
            for (int index = 0; index < args.length; index++) {
                String argument = args[index];
                switch (argument) {
                    case "--deck-directory" -> result.deckDirectory = Path.of(value(args, ++index, argument));
                    case "--deck" -> result.decks.add(value(args, ++index, argument));
                    case "--before" -> result.beforeOutput = Path.of(value(args, ++index, argument));
                    case "--after" -> result.afterOutput = Path.of(value(args, ++index, argument));
                    case "--seat" -> result.targetSeat = Integer.parseInt(value(args, ++index, argument));
                    case "--seed" -> result.seed = Long.parseLong(value(args, ++index, argument));
                    case "--phase" -> result.targetPhase = value(args, ++index, argument).toUpperCase();
                    case "--source" -> result.sourceName = value(args, ++index, argument);
                    case "--stage-into-hand" -> result.stageIntoHand = value(args, ++index, argument);
                    case "--audit-only" -> result.auditOnly = true;
                    default -> throw new IllegalArgumentException("Unknown argument: " + argument);
                }
            }
            if (result.deckDirectory == null
                    || result.beforeOutput == null
                    || result.decks.size() < 2
                    || (!result.auditOnly && (result.afterOutput == null || result.sourceName == null))) {
                throw new IllegalArgumentException(
                        "Usage: --deck-directory <path> --deck <file> [--deck <file> ...] "
                                + "--before <json> [--after <json> --source <card>] "
                                + "[--stage-into-hand <card>] [--audit-only]"
                );
            }
            if (result.targetSeat < 1 || result.targetSeat > result.decks.size()) {
                throw new IllegalArgumentException("--seat must identify one of the supplied decks");
            }
            return result;
        }

        private static String value(String[] args, int index, String option) {
            if (index >= args.length) {
                throw new IllegalArgumentException("Missing value for " + option);
            }
            return args[index];
        }
    }
}
