package cedh.sim;

import forge.ai.LobbyPlayerAi;
import forge.game.Game;
import forge.game.player.Player;
import forge.game.player.PlayerController;

import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicBoolean;

/** Supplies the scripted land-action controller to one selected seat. */
public class LandActionProbeLobbyPlayerAi extends LobbyPlayerAi {
    protected final boolean targetSeat;
    protected final int seat;
    protected final String targetPhase;
    protected final String sourceName;
    protected final String stageIntoHand;
    protected final boolean auditOnly;
    protected final Path beforeOutput;
    protected final Path afterOutput;
    protected final AtomicBoolean actionIssued;
    protected final AtomicBoolean completed;

    public LandActionProbeLobbyPlayerAi(
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
    ) {
        super(name, null);
        this.targetSeat = targetSeat;
        this.seat = seat;
        this.targetPhase = targetPhase;
        this.sourceName = sourceName;
        this.stageIntoHand = stageIntoHand;
        this.auditOnly = auditOnly;
        this.beforeOutput = beforeOutput;
        this.afterOutput = afterOutput;
        this.actionIssued = actionIssued;
        this.completed = completed;
    }

    protected PlayerController controller(Player player) {
        return new LandActionProbeControllerAi(
                player,
                this,
                targetSeat,
                seat,
                targetPhase,
                sourceName,
                stageIntoHand,
                auditOnly,
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
