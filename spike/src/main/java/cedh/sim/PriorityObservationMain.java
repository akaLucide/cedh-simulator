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

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Random;
import java.util.concurrent.atomic.AtomicBoolean;

/** Runs only far enough to capture one real Commander priority window. */
public final class PriorityObservationMain {
    private PriorityObservationMain() {
    }

    public static void main(String[] args) {
        Arguments options = Arguments.parse(args);
        System.setProperty("java.util.Arrays.useLegacyMergeSort", "true");
        System.setProperty("sun.java2d.d3d", "false");
        GuiBase.setInterface(new HeadlessGuiBase());
        FModel.initialize(null, null);
        ObservationWriter.setNaturalFixture();
        MyRandom.setRandom(new Random(options.seed));

        AtomicBoolean captured = new AtomicBoolean(false);
        List<RegisteredPlayer> players = new ArrayList<>();
        for (int index = 0; index < options.decks.size(); index++) {
            Path deckPath = options.deckDirectory.resolve(options.decks.get(index));
            Deck deck = DeckSerializer.fromFile(deckPath.toFile());
            if (deck == null) {
                throw new IllegalArgumentException("Could not load deck: " + deckPath);
            }
            int seat = index + 1;
            ObservingLobbyPlayerAi lobbyPlayer = new ObservingLobbyPlayerAi(
                    "Seat(" + seat + ")-" + deck.getName(),
                    options.output,
                    seat,
                    options.targetSeat,
                    options.targetPhase,
                    captured
            );
            players.add(RegisteredPlayer.forCommander(deck).setPlayer(lobbyPlayer));
        }

        GameRules rules = new GameRules(GameType.Commander);
        rules.setAppliedVariants(EnumSet.of(GameType.Commander));
        Match match = new Match(rules, players, "Priority observation");
        Game game = match.createGame();
        match.startGame(game);

        if (!captured.get() || !Files.isRegularFile(options.output)) {
            throw new IllegalStateException("The requested priority window was not captured");
        }
        System.out.println("Priority observation: " + options.output.toAbsolutePath());
    }

    private static final class Arguments {
        private final Path deckDirectory;
        private final List<String> decks;
        private final Path output;
        private final int targetSeat;
        private final long seed;
        private final String targetPhase;

        private Arguments(
                Path deckDirectory,
                List<String> decks,
                Path output,
                int targetSeat,
                long seed,
                String targetPhase
        ) {
            this.deckDirectory = deckDirectory;
            this.decks = decks;
            this.output = output;
            this.targetSeat = targetSeat;
            this.seed = seed;
            this.targetPhase = targetPhase;
        }

        private static Arguments parse(String[] args) {
            Path deckDirectory = null;
            List<String> decks = new ArrayList<>();
            Path output = null;
            int targetSeat = 1;
            long seed = 1;
            String targetPhase = null;

            for (int index = 0; index < args.length; index++) {
                String argument = args[index];
                switch (argument) {
                    case "--deck-directory" -> deckDirectory = Path.of(requireValue(args, ++index, argument));
                    case "--deck" -> decks.add(requireValue(args, ++index, argument));
                    case "--output" -> output = Path.of(requireValue(args, ++index, argument));
                    case "--seat" -> targetSeat = Integer.parseInt(requireValue(args, ++index, argument));
                    case "--seed" -> seed = Long.parseLong(requireValue(args, ++index, argument));
                    case "--phase" -> targetPhase = requireValue(args, ++index, argument).toUpperCase();
                    default -> throw new IllegalArgumentException("Unknown argument: " + argument);
                }
            }
            if (deckDirectory == null || output == null || decks.size() < 2) {
                throw new IllegalArgumentException(
                        "Usage: --deck-directory <path> --deck <file> [--deck <file> ...] "
                                + "--output <json> [--seat 1] [--seed 1] [--phase MAIN1]"
                );
            }
            if (targetSeat < 1 || targetSeat > decks.size()) {
                throw new IllegalArgumentException("--seat must identify one of the supplied decks");
            }
            return new Arguments(
                    deckDirectory,
                    List.copyOf(decks),
                    output,
                    targetSeat,
                    seed,
                    targetPhase
            );
        }

        private static String requireValue(String[] args, int index, String option) {
            if (index >= args.length) {
                throw new IllegalArgumentException("Missing value for " + option);
            }
            return args[index];
        }
    }
}
