
// GAMES CONTROLLER


import { Elysia, t } from 'elysia';
import * as GamesHelper from '../../core/cache/repositories/game.repository';
import * as GameService from './games.service';
import type {
  CreateGameRequest,
  CreateGameResponse,
  GameSummaryResponse,
} from './games.types';


// ELYSIA APP WITH HTTP + WEBSOCKET


export const gamesRoutes = new Elysia({ prefix: '/games' })

  // HTTP ENDPOINTS


  /**
   * POST /games - Create a new game
   */
  .post(
    '/',
    async ({ body, set }): Promise<CreateGameResponse> => {
      try {
        const { quizId } = body as CreateGameRequest;
        const result = await GameService.createGame(quizId);

        set.status = result.status;
        return {
          success: result.success,
          gameId: result.gameId,
          pin: result.pin,
          mode: result.mode,
        };
      } catch (error) {
        console.error('Create game error:', error);
        set.status = 500;
        return {
          success: false,
          gameId: '',
          pin: '',
          mode: 'PERSONAL',
        };
      }
    },
    {
      body: t.Object({
        quizId: t.String(),
      }),
      response: t.Object({
        success: t.Boolean(),
        gameId: t.String(),
        pin: t.String(),
        mode: t.String(),
      }),
      detail: {
        summary: 'Create a new game session',
        tags: ['Game Operations'],
      },
    }
  )

  /**
   * GET /games/:id - Get game summary
   */
  .get(
    '/:id',
    async ({ params, set }): Promise<GameSummaryResponse> => {
      try {
        const { id: pin } = params;
        const state = await GamesHelper.getGameState(pin);

        if (!state) {
          set.status = 404;
          return {
            success: false,
            status: 'FINISHED',
            totalPlayers: 0,
          };
        }

        const leaderboard = await GamesHelper.getLeaderboard(pin, 100);

        return {
          success: true,
          status: state.status,
          totalPlayers: state.totalPlayers,
          winner: leaderboard[0]?.nickname,
          finalScores: leaderboard,
        };
      } catch (error) {
        console.error('Get game error:', error);
        set.status = 500;
        return {
          success: false,
          status: 'FINISHED',
          totalPlayers: 0,
        };
      }
    },
    {
      response: t.Object({
        success: t.Boolean(),
        status: t.String(),
        totalPlayers: t.Number(),
        winner: t.Optional(t.String()),
        finalScores: t.Optional(t.Any()),
      }),
      detail: {
        summary: 'Get game summary',
        tags: ['Game Operations'],
      },
    }
  )

  /**
   * DELETE /games/:id - End game and cleanup
   */
  .delete(
    '/:id',
    async ({ params, set }) => {
      try {
        const { id: pin } = params;
        await GamesHelper.cleanupGame(pin);
        return { success: true };
      } catch (error) {
        console.error('Delete game error:', error);
        set.status = 500;
        return { success: false };
      }
    },
    {
      response: t.Object({
        success: t.Boolean(),
      }),
      detail: {
        summary: 'Delete game and cleanup',
        tags: ['Game Operations'],
      },
    }
  )


  // WEBSOCKET ENDPOINT


  .ws('/ws', {
    open(ws) {
      console.log('WebSocket connected:', ws.id);
    },

    async message(ws, message: any) {
      try {
        const event = typeof message === 'string' ? JSON.parse(message) : message;
        const type = event.type;
        const data = event.data;

        switch (type) {
          case 'JOIN_ROOM':
            await GameService.handleJoinRoom(ws, data);
            break;
          case 'KICK_PLAYER':
            await GameService.handleKickPlayer(ws, data);
            break;
          case 'START_GAME':
            await GameService.handleStartGame(ws, data);
            break;
          case 'SUBMIT_ANSWER':
            await GameService.handleSubmitAnswer(ws, data);
            break;
          case 'SHOW_LEADERBOARD':
            await GameService.handleShowLeaderboard(ws, data);
            break;
          case 'NEXT_QUESTION':
            await GameService.handleNextQuestion(ws, data);
            break;
          default:
            ws.send(JSON.stringify({
              type: 'ERROR',
              data: { message: 'Unknown event type' },
            }));
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
        ws.send(JSON.stringify({
          type: 'ERROR',
          data: { message: 'Internal server error' },
        }));
      }
    },

    async close(ws) {
      const socketId = ws.id;
      const metadata = ws.data as any;

      console.log('WebSocket disconnected:', socketId);

      // ws.data contains pin if player joined a game
      if (metadata?.pin) {
        const pin = metadata.pin;

        try {
          // Cleanup disconnected player
          const result = await GamesHelper.handlePlayerDisconnect(pin, socketId);

          if (result.success && result.shouldBroadcast && result.state) {
            // Broadcast based on game status
            if (result.state.status === 'LOBBY') {
              // LOBBY: Update player list
              const players = await GamesHelper.getAllPlayerSockets(pin);
              const playerList = [];
              for (const sid of players) {
                const info = await GamesHelper.getPlayerInfo(pin, sid);
                if (info) {
                  playerList.push({ socketId: sid, nickname: info.nickname });
                }
              }

              const recentPlayers = await GamesHelper.getRecentPlayers(pin, 28);

              // Broadcast LOBBY_UPDATE
              ws.publish(`game:${pin}`, JSON.stringify({
                type: 'LOBBY_UPDATE',
                data: {
                  players: playerList,
                  recentPlayers,
                  totalPlayers: result.state.totalPlayers - 1
                }
              }));
            } else if (result.state.status === 'ACTIVE' && result.playerInfo) {
              // ACTIVE: Just log, game continues
              console.log(`Player left active game ${pin}: ${result.playerInfo.nickname}`);
            }
          }
        } catch (error) {
          console.error('WebSocket close error:', error);
        }
      }
    },
  });

