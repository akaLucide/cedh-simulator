package cedh.sim;

import forge.ai.LobbyPlayerAi;
import forge.game.Game;
import forge.game.player.Player;
import forge.game.player.PlayerController;

import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicBoolean;

/** Creates stock AI controllers with a priority-observation hook. */
public final class ObservingLobbyPlayerAi extends LobbyPlayerAi {
    private final Path output;
    private final int seat;
    private final int targetSeat;
    private final String targetPhase;
    private final AtomicBoolean captured;

    public ObservingLobbyPlayerAi(
            String name,
            Path output,
            int seat,
            int targetSeat,
            String targetPhase,
            AtomicBoolean captured
    ) {
        super(name, null);
        this.output = output;
        this.seat = seat;
        this.targetSeat = targetSeat;
        this.targetPhase = targetPhase;
        this.captured = captured;
    }

    private PlayerController controller(Player player) {
        return new ObservingPlayerControllerAi(
                player,
                this,
                output,
                seat,
                seat == targetSeat,
                targetPhase,
                captured
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
