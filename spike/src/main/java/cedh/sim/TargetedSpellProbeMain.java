package cedh.sim;

import forge.deck.Deck;
import forge.deck.io.DeckSerializer;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameType;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.zone.ZoneType;
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

/** Proves an explicit mana payment, player target, pass cycle, and resolution. */
public final class TargetedSpellProbeMain {
    private TargetedSpellProbeMain() {
    }

    public static void main(String[] args) {
        Arguments options = Arguments.parse(args);
        System.setProperty("java.util.Arrays.useLegacyMergeSort", "true");
        System.setProperty("sun.java2d.d3d", "false");
        GuiBase.setInterface(new HeadlessGuiBase());
        FModel.initialize(null, null);
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
            TargetedSpellProbeLobbyPlayerAi lobby = new TargetedSpellProbeLobbyPlayerAi(
                    "Seat(" + seat + ")-" + deck.getName(),
                    seat == options.actingSeat,
                    seat,
                    options.targetPlayerSeat,
                    options.targetPhase,
                    options.sourceName,
                    options.manaSourceName,
                    options.beforeOutput,
                    options.stackOutput,
                    options.resolvedOutput,
                    stage
            );
            players.add(RegisteredPlayer.forCommander(deck).setPlayer(lobby));
        }

        GameRules rules = new GameRules(GameType.Commander);
        rules.setAppliedVariants(EnumSet.of(GameType.Commander));
        Match match = new Match(rules, players, "Targeted spell action probe");
        Game game = match.createGame();
        match.startGame(game, () -> installManaFixture(game, options));

        if (stage.get() != 3
                || !Files.isRegularFile(options.beforeOutput)
                || !Files.isRegularFile(options.stackOutput)
                || !Files.isRegularFile(options.resolvedOutput)) {
            throw new IllegalStateException("The targeted spell action did not complete all three captures");
        }
        System.out.println("Targeted spell before: " + options.beforeOutput.toAbsolutePath());
        System.out.println("Targeted spell stack: " + options.stackOutput.toAbsolutePath());
        System.out.println("Targeted spell resolved: " + options.resolvedOutput.toAbsolutePath());
    }

    private static void installManaFixture(Game game, Arguments options) {
        Player actor = game.getPlayers().get(options.actingSeat - 1);
        boolean sourceInHand = actor.getCardsIn(ZoneType.Hand).stream()
                .anyMatch(card -> card.getName().equals(options.sourceName));
        if (!sourceInHand) {
            throw new IllegalStateException(
                    options.sourceName + " is not in the deterministic opening hand for seed " + options.seed
            );
        }

        List<String> fixtureSources = new ArrayList<>();
        fixtureSources.add(options.manaSourceName);
        fixtureSources.addAll(options.additionalManaSources);
        ObservationWriter.setStagedFixture(
                String.join(", ", fixtureSources),
                ZoneType.Library.name(),
                "--mana-source " + String.join(" --additional-mana-source ", fixtureSources)
        );
        for (String sourceName : fixtureSources) {
            Card manaSource = actor.getCardsIn(ZoneType.Library).stream()
                    .filter(card -> card.getName().equals(sourceName))
                    .findFirst()
                    .orElseThrow(() -> new IllegalStateException(
                            sourceName + " is not in the acting player's library"
                    ));
            Card moved = game.getAction().moveTo(actor.getZone(ZoneType.Battlefield), manaSource, null);
            moved.setTapped(false);
        }
    }

    private static final class Arguments {
        private Path deckDirectory;
        private final List<String> decks = new ArrayList<>();
        private Path beforeOutput;
        private Path stackOutput;
        private Path resolvedOutput;
        private int actingSeat = 1;
        private int targetPlayerSeat = 2;
        private long seed = 1;
        private String targetPhase = "MAIN1";
        private String sourceName;
        private String manaSourceName;
        private final List<String> additionalManaSources = new ArrayList<>();

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
                    case "--seat" -> result.actingSeat = Integer.parseInt(value(args, ++index, argument));
                    case "--target-player-seat" -> result.targetPlayerSeat = Integer.parseInt(value(args, ++index, argument));
                    case "--seed" -> result.seed = Long.parseLong(value(args, ++index, argument));
                    case "--phase" -> result.targetPhase = value(args, ++index, argument).toUpperCase();
                    case "--source" -> result.sourceName = value(args, ++index, argument);
                    case "--mana-source" -> result.manaSourceName = value(args, ++index, argument);
                    case "--additional-mana-source" -> result.additionalManaSources.add(
                            value(args, ++index, argument)
                    );
                    default -> throw new IllegalArgumentException("Unknown argument: " + argument);
                }
            }
            if (result.deckDirectory == null
                    || result.beforeOutput == null
                    || result.stackOutput == null
                    || result.resolvedOutput == null
                    || result.sourceName == null
                    || result.manaSourceName == null
                    || result.decks.size() < 2) {
                throw new IllegalArgumentException(
                        "Usage: --deck-directory <path> --deck <file> [--deck <file> ...] "
                                + "--before <json> --stack <json> --resolved <json> "
                                + "--source <card> --mana-source <card> [--additional-mana-source <card>] "
                                + "[--target-player-seat <seat>]"
                );
            }
            if (result.actingSeat < 1 || result.actingSeat > result.decks.size()) {
                throw new IllegalArgumentException("--seat must identify one of the supplied decks");
            }
            if (result.targetPlayerSeat < 1 || result.targetPlayerSeat > result.decks.size()
                    || result.targetPlayerSeat == result.actingSeat) {
                throw new IllegalArgumentException("--target-player-seat must identify a different supplied deck");
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
