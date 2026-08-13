package cedh.sim;

import forge.ai.LobbyPlayerAi;
import forge.game.Game;
import forge.game.player.Player;
import forge.game.player.PlayerController;

import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;

/** Supplies one scripted targeted-spell controller and three pass-only opponents. */
public final class TargetedSpellProbeLobbyPlayerAi extends LobbyPlayerAi {
    private final boolean actingSeat;
    private final int seat;
    private final int targetPlayerSeat;
    private final String targetPhase;
    private final String sourceName;
    private final String manaSourceName;
    private final Path beforeOutput;
    private final Path stackOutput;
    private final Path resolvedOutput;
    private final AtomicInteger stage;

    public TargetedSpellProbeLobbyPlayerAi(
            String name,
            boolean actingSeat,
            int seat,
            int targetPlayerSeat,
            String targetPhase,
            String sourceName,
            String manaSourceName,
            Path beforeOutput,
            Path stackOutput,
            Path resolvedOutput,
            AtomicInteger stage
    ) {
        super(name, null);
        this.actingSeat = actingSeat;
        this.seat = seat;
        this.targetPlayerSeat = targetPlayerSeat;
        this.targetPhase = targetPhase;
        this.sourceName = sourceName;
        this.manaSourceName = manaSourceName;
        this.beforeOutput = beforeOutput;
        this.stackOutput = stackOutput;
        this.resolvedOutput = resolvedOutput;
        this.stage = stage;
    }

    private PlayerController controller(Player player) {
        return new TargetedSpellProbeControllerAi(
                player,
                this,
                actingSeat,
                seat,
                targetPlayerSeat,
                targetPhase,
                sourceName,
                manaSourceName,
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
