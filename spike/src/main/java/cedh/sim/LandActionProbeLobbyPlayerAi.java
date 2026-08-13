package cedh.sim;

import forge.ai.LobbyPlayerAi;
import forge.game.Game;
import forge.game.player.Player;
import forge.game.player.PlayerController;

import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicBoolean;

/** Supplies the scripted land-action controller to one selected seat. */
public final class LandActionProbeLobbyPlayerAi extends LobbyPlayerAi {
    private final boolean targetSeat;
    private final int seat;
    private final String targetPhase;
    private final String sourceName;
    private final Path beforeOutput;
    private final Path afterOutput;
    private final AtomicBoolean actionIssued;
    private final AtomicBoolean completed;

    public LandActionProbeLobbyPlayerAi(
            String name,
            boolean targetSeat,
            int seat,
            String targetPhase,
            String sourceName,
            Path beforeOutput,
            Path afterOutput,
            AtomicBoolean actionIssued,
            AtomicBoolean completed
    ) {
        super(name, null);
        this.targetSeat = targetSeat;
        this.seat = seat;
        this.targetPhase = targetPhase;
        this.sourceName = sourceName;
        this.beforeOutput = beforeOutput;
        this.afterOutput = afterOutput;
        this.actionIssued = actionIssued;
        this.completed = completed;
    }

    private PlayerController controller(Player player) {
        return new LandActionProbeControllerAi(
                player,
                this,
                targetSeat,
                seat,
                targetPhase,
                sourceName,
                beforeOutput,
                afterOutput,
                actionIssued,
                completed
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
