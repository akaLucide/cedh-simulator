package cedh.sim;

import forge.ai.LobbyPlayerAi;
import forge.game.Game;
import forge.game.player.Player;
import forge.game.player.PlayerController;

import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;

/** Supplies a scripted spell controller and pass-only opponents. */
public final class SpellActionProbeLobbyPlayerAi extends LobbyPlayerAi {
    private final boolean targetSeat;
    private final int seat;
    private final String targetPhase;
    private final String sourceName;
    private final Path beforeOutput;
    private final Path stackOutput;
    private final Path resolvedOutput;
    private final AtomicInteger stage;

    public SpellActionProbeLobbyPlayerAi(
            String name,
            boolean targetSeat,
            int seat,
            String targetPhase,
            String sourceName,
            Path beforeOutput,
            Path stackOutput,
            Path resolvedOutput,
            AtomicInteger stage
    ) {
        super(name, null);
        this.targetSeat = targetSeat;
        this.seat = seat;
        this.targetPhase = targetPhase;
        this.sourceName = sourceName;
        this.beforeOutput = beforeOutput;
        this.stackOutput = stackOutput;
        this.resolvedOutput = resolvedOutput;
        this.stage = stage;
    }

    private PlayerController controller(Player player) {
        return new SpellActionProbeControllerAi(
                player,
                this,
                targetSeat,
                seat,
                targetPhase,
                sourceName,
                beforeOutput,
                stackOutput,
                resolvedOutput,
                stage
        );
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
