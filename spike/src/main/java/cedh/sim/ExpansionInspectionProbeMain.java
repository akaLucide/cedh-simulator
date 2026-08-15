package cedh.sim;

import forge.LobbyPlayer;
import forge.ai.ComputerUtil;
import forge.ai.ComputerUtilMana;
import forge.ai.LobbyPlayerAi;
import forge.ai.PlayerControllerAi;
import forge.deck.Deck;
import forge.deck.io.DeckSerializer;
import forge.game.Game;
import forge.game.GameEndReason;
import forge.game.GameRules;
import forge.game.GameType;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.player.PlayerController;
import forge.game.player.RegisteredPlayer;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.gui.GuiBase;
import forge.model.FModel;
import forge.util.MyRandom;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Random;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Inspects one enumeration and publishes the resulting v3 capture. Never casts.
 *
 * <p>This exists because the boundaries added in this milestone are refusals: the
 * interesting outcome is an action that is <em>not</em> emitted. A probe that had
 * to execute something could not observe them at all.</p>
 *
 * <p>The staged state is built from CLI arguments, so no card name appears in
 * adapter logic.</p>
 */
public final class ExpansionInspectionProbeMain {
    private ExpansionInspectionProbeMain() {
    }

    public static void main(String[] args) {
        Arguments options = Arguments.parse(args);
        System.setProperty("java.util.Arrays.useLegacyMergeSort", "true");
        System.setProperty("sun.java2d.d3d", "false");
        GuiBase.setInterface(new HeadlessGuiBase());
        FModel.initialize(null, null);
        MyRandom.setRandom(new Random(options.seed));

        if (options.stagedHand.isEmpty() && options.stagedBattlefield.isEmpty()
                && options.produceMana == null) {
            ObservationWriter.setNaturalFixture();
        } else {
            List<String> staged = new ArrayList<>(options.stagedHand);
            staged.addAll(options.stagedBattlefield);
            if (options.produceMana != null) {
                staged.add(options.produceMana);
            }
            ObservationWriter.setStagedFixture(String.join(", ", staged), ZoneType.Library.name(),
                    options.stagingArgument);
        }

        AtomicBoolean done = new AtomicBoolean(false);
        List<RegisteredPlayer> players = new ArrayList<>();
        for (int index = 0; index < options.decks.size(); index++) {
            Deck deck = DeckSerializer.fromFile(options.deckDirectory.resolve(options.decks.get(index)).toFile());
            if (deck == null) {
                throw new IllegalArgumentException("Could not load deck: " + options.decks.get(index));
            }
            int seat = index + 1;
            players.add(RegisteredPlayer.forCommander(deck)
                    .setPlayer(new Lobby("Seat(" + seat + ")-" + deck.getName(),
                            seat == options.seat, options, done)));
        }

        GameRules rules = new GameRules(GameType.Commander);
        rules.setAppliedVariants(EnumSet.of(GameType.Commander));
        Match match = new Match(rules, players, "Expansion inspection probe");
        match.startGame(match.createGame());

        if (!Files.isRegularFile(options.output)) {
            throw new IllegalStateException("The inspection probe did not write its capture");
        }
        System.out.println("Expansion inspection: " + options.output.toAbsolutePath());
    }

    private static final class Lobby extends LobbyPlayerAi {
        private final boolean acting;
        private final Arguments options;
        private final AtomicBoolean done;

        Lobby(String name, boolean acting, Arguments options, AtomicBoolean done) {
            super(name, null);
            this.acting = acting;
            this.options = options;
            this.done = done;
        }

        private PlayerController controller(Player player) {
            return new Controller(player, this, acting, options, done);
        }

        @Override
        public Player createIngamePlayer(Game game, int id) {
            Player player = new Player(getName(), game, id);
            player.setFirstController(controller(player));
            return player;
        }

        @Override
        public PlayerController createMindSlaveController(Player master, Player slave) {
            return controller(slave);
        }
    }

    private static final class Controller extends PlayerControllerAi {
        private final boolean acting;
        private final Arguments options;
        private final AtomicBoolean done;

        Controller(Player player, LobbyPlayer lobby, boolean acting, Arguments options, AtomicBoolean done) {
            super(player.getGame(), player, lobby);
            this.acting = acting;
            this.options = options;
            this.done = done;
        }

        @Override
        public List<SpellAbility> chooseSpellAbilityToPlay() {
            if (!acting || !getGame().getPhaseHandler().getPhase().name().equals(options.phase)) {
                return null;
            }
            if (!done.compareAndSet(false, true)) {
                return null;
            }
            Player me = getPlayer();
            Game game = getGame();

            for (String name : options.stagedHand) {
                stage(game, me, name, ZoneType.Hand);
            }
            for (String name : options.stagedBattlefield) {
                Card moved = stage(game, me, name, ZoneType.Battlefield);
                moved.setTapped(false);
            }
            if (options.produceMana != null) {
                Card source = stage(game, me, options.produceMana, ZoneType.Battlefield);
                source.setTapped(false);
                activateSingleColourMana(me, source);
            }

            SimpleSpellActionExpander.Expansion expansion = SimpleSpellActionExpander.expand(me);
            try {
                ObservationWriter.write(options.output, me, options.seat, null, expansion);
            } catch (IOException error) {
                throw new IllegalStateException("Could not write inspection capture", error);
            }
            System.out.println("PROBE_EXPANSION attempted=" + expansion.attempted()
                    + " suppressedReason=" + expansion.suppressedReason()
                    + " complete=" + expansion.complete()
                    + " truncated=" + expansion.truncated()
                    + " emitted=" + expansion.emittedActionCount()
                    + " totalCapacity=" + expansion.totalCapacity()
                    + " manaSourceExclusions=" + expansion.manaSourceExclusions().size()
                    + " skipped=" + expansion.skippedCandidates());
            game.setGameOver(GameEndReason.Draw);
            return null;
        }

        /** Fills the mana pool from a source whose ability has one producible colour. */
        private void activateSingleColourMana(Player me, Card source) {
            for (SpellAbility ability : ComputerUtilMana.getAIPlayableMana(source)) {
                ability.setActivatingPlayer(me);
                if (ComputerUtil.handlePlayingSpellAbility(me, ability, null)) {
                    return;
                }
            }
            throw new IllegalStateException("Could not produce mana from " + source.getName());
        }

        private Card stage(Game game, Player me, String name, ZoneType destination) {
            for (Card card : me.getCardsIn(ZoneType.Library)) {
                if (card.getName().equals(name)) {
                    return game.getAction().moveTo(me.getZone(destination), card, null);
                }
            }
            for (Card card : me.getCardsIn(ZoneType.Hand)) {
                if (card.getName().equals(name)) {
                    return destination == ZoneType.Hand
                            ? card
                            : game.getAction().moveTo(me.getZone(destination), card, null);
                }
            }
            throw new IllegalStateException("Cannot stage a card that is not in library or hand: " + name);
        }
    }

    private static final class Arguments {
        private Path deckDirectory;
        private final List<String> decks = new ArrayList<>();
        private final List<String> stagedHand = new ArrayList<>();
        private final List<String> stagedBattlefield = new ArrayList<>();
        private String produceMana;
        private String stagingArgument = "";
        private Path output;
        private int seat = 1;
        private long seed = 1;
        private String phase = "MAIN1";

        static Arguments parse(String[] args) {
            Arguments result = new Arguments();
            StringBuilder staging = new StringBuilder();
            for (int index = 0; index < args.length; index++) {
                String argument = args[index];
                switch (argument) {
                    case "--deck-directory" -> result.deckDirectory = Path.of(value(args, ++index, argument));
                    case "--deck" -> result.decks.add(value(args, ++index, argument));
                    case "--output" -> result.output = Path.of(value(args, ++index, argument));
                    case "--seat" -> result.seat = Integer.parseInt(value(args, ++index, argument));
                    case "--seed" -> result.seed = Long.parseLong(value(args, ++index, argument));
                    case "--phase" -> result.phase = value(args, ++index, argument).toUpperCase();
                    case "--stage-hand" -> {
                        String name = value(args, ++index, argument);
                        result.stagedHand.add(name);
                        staging.append(" --stage-hand ").append(name);
                    }
                    case "--stage-battlefield" -> {
                        String name = value(args, ++index, argument);
                        result.stagedBattlefield.add(name);
                        staging.append(" --stage-battlefield ").append(name);
                    }
                    case "--produce-mana" -> {
                        String name = value(args, ++index, argument);
                        result.produceMana = name;
                        staging.append(" --produce-mana ").append(name);
                    }
                    default -> throw new IllegalArgumentException("Unknown argument: " + argument);
                }
            }
            result.stagingArgument = staging.toString().trim();
            if (result.deckDirectory == null || result.output == null || result.decks.size() < 2) {
                throw new IllegalArgumentException(
                        "Usage: --deck-directory <path> --deck <file> [--deck <file> ...] --output <json> "
                                + "[--stage-hand <card>] [--stage-battlefield <card>] [--produce-mana <card>]");
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
