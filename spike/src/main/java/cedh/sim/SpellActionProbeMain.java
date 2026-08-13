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
import java.util.concurrent.atomic.AtomicInteger;

/** Proves a cast, multiplayer pass cycle, resolution, and priority return. */
public final class SpellActionProbeMain {
    private SpellActionProbeMain() {
    }

    public static void main(String[] args) {
        Arguments options = Arguments.parse(args);
        System.setProperty("java.util.Arrays.useLegacyMergeSort", "true");
        System.setProperty("sun.java2d.d3d", "false");
        GuiBase.setInterface(new HeadlessGuiBase());
        FModel.initialize(null, null);
        ObservationWriter.setNaturalFixture();
        MyRandom.setRandom(new Random(options.seed));

        AtomicInteger stage = new AtomicInteger(0);
        List<RegisteredPlayer> players = new ArrayList<>();
        for (int index = 0; index < options.decks.size(); index++) {
            Path deckPath = options.deckDirectory.resolve(options.decks.get(index));
            Deck deck = DeckSerializer.fromFile(deckPath.toFile());
            if (deck == null) {
                throw new IllegalArgumentException("Could not load deck: " + deckPath);
            }
            int seat = index + 1;
            SpellActionProbeLobbyPlayerAi lobby = new SpellActionProbeLobbyPlayerAi(
                    "Seat(" + seat + ")-" + deck.getName(),
                    seat == options.targetSeat,
                    seat,
                    options.targetPhase,
                    options.sourceName,
                    options.beforeOutput,
                    options.stackOutput,
                    options.resolvedOutput,
                    stage
            );
            players.add(RegisteredPlayer.forCommander(deck).setPlayer(lobby));
        }

        GameRules rules = new GameRules(GameType.Commander);
        rules.setAppliedVariants(EnumSet.of(GameType.Commander));
        Match match = new Match(rules, players, "Spell action probe");
        Game game = match.createGame();
        match.startGame(game);

        if (stage.get() != 3
                || !Files.isRegularFile(options.beforeOutput)
                || !Files.isRegularFile(options.stackOutput)
                || !Files.isRegularFile(options.resolvedOutput)) {
            throw new IllegalStateException("The spell action did not complete all three captures");
        }
        System.out.println("Spell action before: " + options.beforeOutput.toAbsolutePath());
        System.out.println("Spell action stack: " + options.stackOutput.toAbsolutePath());
        System.out.println("Spell action resolved: " + options.resolvedOutput.toAbsolutePath());
    }

    private static final class Arguments {
        private Path deckDirectory;
        private final List<String> decks = new ArrayList<>();
        private Path beforeOutput;
        private Path stackOutput;
        private Path resolvedOutput;
        private int targetSeat = 1;
        private long seed = 1;
        private String targetPhase = "MAIN1";
        private String sourceName;

        private static Arguments parse(String[] args) {
            Arguments result = new Arguments();
            for (int index = 0; index < args.length; index++) {
                String argument = args[index];
                switch (argument) {
                    case "--deck-directory" -> result.deckDirectory = Path.of(value(args, ++index, argument));
                    case "--deck" -> result.decks.add(value(args, ++index, argument));
                    case "--before" -> result.beforeOutput = Path.of(value(args, ++index, argument));
                    case "--stack" -> result.stackOutput = Path.of(value(args, ++index, argument));
                    case "--resolved" -> result.resolvedOutput = Path.of(value(args, ++index, argument));
                    case "--seat" -> result.targetSeat = Integer.parseInt(value(args, ++index, argument));
                    case "--seed" -> result.seed = Long.parseLong(value(args, ++index, argument));
                    case "--phase" -> result.targetPhase = value(args, ++index, argument).toUpperCase();
                    case "--source" -> result.sourceName = value(args, ++index, argument);
                    default -> throw new IllegalArgumentException("Unknown argument: " + argument);
                }
            }
            if (result.deckDirectory == null
                    || result.beforeOutput == null
                    || result.stackOutput == null
                    || result.resolvedOutput == null
                    || result.sourceName == null
                    || result.decks.size() < 2) {
                throw new IllegalArgumentException(
                        "Usage: --deck-directory <path> --deck <file> [--deck <file> ...] "
                                + "--before <json> --stack <json> --resolved <json> --source <card>"
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
