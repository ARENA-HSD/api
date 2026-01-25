// ============================================
// GAMES CONTROLLER - HYBRID HTTP/WEBSOCKET
// ============================================

import { Elysia, t } from 'elysia';
import { db, schema } from '../../db';
import { eq, and, asc } from 'drizzle-orm';
// ElysiaJS WebSocket uses its own wrapper type
import {
  generatePin,
  generateQRUrl,
  generateGameId,
  calculateScore,
  handleNicknameDuplication,
  getClientIP,
  isValidPin,
  getOptionColor,
} from './utils';
import {
  createGameState,
  getGameState,
  updateGameState,
  addPlayer,
  removePlayer,
  getPlayerInfo,
  updatePlayerScore,
  getAllNicknames,
  resetAllAnswerFlags,
  getLeaderboard,
  loadAnswerKey,
  checkAnswer,
  addToBanList,
  isBanned,
  cleanupGame,
  getAllPlayerSockets,
} from './redis.helper';
import type {
  WebSocketEvent,
  JoinRoomEvent,
  KickPlayerEvent,
  StartGameEvent,
  SubmitAnswerEvent,
  NextQuestionEvent,
  QuestionData,
  GameMode,
} from './types';

// ============================================
// WEBSOCKET CONNECTION MAP
// ============================================

// Map: socketId -> { ws, pin, isHost }
// Using 'any' for ws type since ElysiaJS uses its own WebSocket wrapper
const connections = new Map<
  string,
  { ws: any; pin: string; isHost: boolean }
>();

// Map: pin -> hostSocketId
const hostConnections = new Map<string, string>();

// ============================================
// HELPER: BROADCAST TO ALL PLAYERS
// ============================================

function broadcastToGame(pin: string, event: WebSocketEvent) {
  for (const [socketId, conn] of connections.entries()) {
    if (conn.pin === pin) {
      conn.ws.send(JSON.stringify(event));
    }
  }
}

function sendToSocket(socketId: string, event: WebSocketEvent) {
  const conn = connections.get(socketId);
  if (conn) {
    conn.ws.send(JSON.stringify(event));
  }
}

function sendToHost(pin: string, event: WebSocketEvent) {
  const hostSocketId = hostConnections.get(pin);
  if (hostSocketId) {
    sendToSocket(hostSocketId, event);
  }
}

// ============================================
// HTTP ROUTES
// ============================================

export const gamesRoutes = new Elysia({ prefix: '/games' })
  // ========================================
  // POST /games - Create Game
  // ========================================
  .post(
    '/',
    async ({ body, set }) => {
      try {
        const { quizId } = body;

        // 1. Fetch quiz and questions from Postgres
        const quiz = await db.query.quizzes.findFirst({
          where: eq(schema.quizzes.id, quizId),
          with: {
            // Assuming you have relations set up in schema
          },
        });

        if (!quiz) {
          set.status = 404;
          return {
            success: false,
            message: 'Quiz not found',
          };
        }

        // Fetch questions separately (ordered by orderIndex)
        const questions = await db.query.questions.findMany({
          where: eq(schema.questions.quizId, quizId),
        });

        if (!questions || questions.length === 0) {
          set.status = 400;
          return {
            success: false,
            message: 'Quiz has no questions',
          };
        }

        // Sort by orderIndex
        questions.sort((a, b) => a.orderIndex - b.orderIndex);

        // 2. Generate unique PIN
        let pin = generatePin();
        let existingGame = await getGameState(pin);

        // Ensure PIN is unique (retry if collision)
        while (existingGame !== null) {
          pin = generatePin();
          existingGame = await getGameState(pin);
        }

        // 3. Create game state in Redis
        const gameId = generateGameId();
        await createGameState(
          pin,
          quizId,
          quiz.defaultMode,
          'pending', // hostSocketId will be set when host connects via WS
          questions.length
        );

        // 4. Load answer key to Redis
        const questionData: QuestionData[] = questions.map((q) => ({
          id: q.id,
          text: q.text,
          mediaUrl: q.mediaUrl || undefined,
          timeLimit: q.timeLimit,
          points: q.points || 1000,
          correctIndex: q.correctIndex,
          orderIndex: q.orderIndex,
          options: q.options as any,
        }));

        await loadAnswerKey(pin, questionData);

        // 5. Generate QR URL
        const qrUrl = generateQRUrl(pin);

        return {
          success: true,
          gameId,
          pin,
          qrUrl,
          mode: quiz.defaultMode,
        };
      } catch (error) {
        console.error('Error creating game:', error);
        set.status = 500;
        return {
          success: false,
          message: 'Internal server error',
        };
      }
    },
    {
      body: t.Object({
        quizId: t.String(),
      }),
      response: t.Object({
        success: t.Boolean(),
        gameId: t.Optional(t.String()),
        pin: t.Optional(t.String()),
        qrUrl: t.Optional(t.String()),
        mode: t.Optional(t.String()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: 'Create a new game session',
        tags: ['Game Operations'],
      },
    }
  )

  // ========================================
  // GET /games/:pin - Get Game Summary
  // ========================================
  .get(
    '/:pin',
    async ({ params, set }) => {
      try {
        const { pin } = params;

        if (!isValidPin(pin)) {
          set.status = 400;
          return {
            success: false,
            message: 'Invalid PIN format',
          };
        }

        const gameState = await getGameState(pin);

        if (!gameState) {
          set.status = 404;
          return {
            success: false,
            message: 'Game not found',
          };
        }

        const leaderboard = await getLeaderboard(pin, 10);

        return {
          success: true,
          status: gameState.status,
          totalPlayers: gameState.totalPlayers,
          winner: leaderboard[0]?.nickname,
          finalScores: leaderboard,
        };
      } catch (error) {
        console.error('Error fetching game:', error);
        set.status = 500;
        return {
          success: false,
          message: 'Internal server error',
        };
      }
    },
    {
      response: t.Object({
        success: t.Boolean(),
        status: t.Optional(t.String()),
        totalPlayers: t.Optional(t.Number()),
        winner: t.Optional(t.String()),
        finalScores: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: 'Get game summary and final scores',
        tags: ['Game Operations'],
      },
    }
  )

  // ========================================
  // DELETE /games/:pin - Delete Game
  // ========================================
  .delete(
    '/:pin',
    async ({ params, set }) => {
      try {
        const { pin } = params;

        if (!isValidPin(pin)) {
          set.status = 400;
          return {
            success: false,
            message: 'Invalid PIN format',
          };
        }

        const gameState = await getGameState(pin);

        if (!gameState) {
          set.status = 404;
          return {
            success: false,
            message: 'Game not found',
          };
        }

        // Clean up all Redis keys
        await cleanupGame(pin);

        // Remove from connection maps
        hostConnections.delete(pin);
        for (const [socketId, conn] of connections.entries()) {
          if (conn.pin === pin) {
            connections.delete(socketId);
          }
        }

        return {
          success: true,
        };
      } catch (error) {
        console.error('Error deleting game:', error);
        set.status = 500;
        return {
          success: false,
          message: 'Internal server error',
        };
      }
    },
    {
      response: t.Object({
        success: t.Boolean(),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: 'Delete game and cleanup Redis',
        tags: ['Game Operations'],
      },
    }
  )

  // ========================================
  // WEBSOCKET /games/ws
  // ========================================
  .ws('/ws', {
    open(ws) {
      console.log('WebSocket connection opened');
    },

    async message(ws, message) {
      try {
        const event = JSON.parse(message as string) as WebSocketEvent;
        const socketId = (ws as any).id || String(Math.random());

        // Store socket ID in ws object for future reference
        (ws as any).socketId = socketId;

        // Route event to appropriate handler
        switch (event.type) {
          case 'JOIN_ROOM':
            await handleJoinRoom(ws, socketId, event as JoinRoomEvent);
            break;

          case 'KICK_PLAYER':
            await handleKickPlayer(ws, socketId, event as KickPlayerEvent);
            break;

          case 'START_GAME':
            await handleStartGame(ws, socketId, event as StartGameEvent);
            break;

          case 'SUBMIT_ANSWER':
            await handleSubmitAnswer(ws, socketId, event as SubmitAnswerEvent);
            break;

          case 'NEXT_QUESTION':
            await handleNextQuestion(ws, socketId, event as NextQuestionEvent);
            break;

          default:
            sendToSocket(socketId, {
              type: 'ERROR',
              data: { message: 'Unknown event type' },
            });
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
        ws.send(
          JSON.stringify({
            type: 'ERROR',
            data: { message: 'Invalid message format' },
          })
        );
      }
    },

    close(ws) {
      const socketId = (ws as any).socketId;
      if (socketId) {
        const conn = connections.get(socketId);
        if (conn) {
          // Remove player from game
          removePlayer(conn.pin, socketId).catch(console.error);
          connections.delete(socketId);

          // If host disconnected, notify players
          if (conn.isHost) {
            hostConnections.delete(conn.pin);
            broadcastToGame(conn.pin, {
              type: 'ERROR',
              data: { message: 'Host disconnected' },
            });
          }
        }
      }
    },
  });

// ============================================
// WEBSOCKET EVENT HANDLERS
// ============================================

async function handleJoinRoom(
  ws: any,
  socketId: string,
  event: JoinRoomEvent
) {
  try {
    const { pin, nickname } = event.data;

    // Validate PIN
    if (!isValidPin(pin)) {
      sendToSocket(socketId, {
        type: 'ERROR',
        data: { message: 'Invalid PIN format' },
      });
      return;
    }

    // Check if game exists
    const gameState = await getGameState(pin);
    if (!gameState) {
      sendToSocket(socketId, {
        type: 'ERROR',
        data: { message: 'Game not found' },
      });
      return;
    }

    // Check if game is in LOBBY status
    if (gameState.status !== 'LOBBY') {
      sendToSocket(socketId, {
        type: 'ERROR',
        data: { message: 'Game already started' },
      });
      return;
    }

    // Get client IP (basic implementation, you may need to improve this)
    const ip = 'unknown'; // getClientIP from ws headers if available

    // Check if IP is banned
    const banned = await isBanned(pin, ip);
    if (banned) {
      sendToSocket(socketId, {
        type: 'FORCE_DISCONNECT',
        data: { reason: 'You have been banned from this game' },
      });
      ws.close();
      return;
    }

    // Handle nickname duplication
    const existingNicknames = await getAllNicknames(pin);
    const uniqueNickname = handleNicknameDuplication(nickname, existingNicknames);

    // Add player to game
    await addPlayer(pin, socketId, uniqueNickname, ip);

    // Store connection
    connections.set(socketId, { ws, pin, isHost: false });

    // Send success to player
    sendToSocket(socketId, {
      type: 'JOIN_SUCCESS',
      data: {
        status: 'WAITING',
        myNick: uniqueNickname,
      },
    });

    // Send lobby update to host ONLY
    const updatedState = await getGameState(pin);
    if (updatedState) {
      sendToHost(pin, {
        type: 'LOBBY_UPDATE',
        data: {
          count: updatedState.totalPlayers,
        },
      });
    }
  } catch (error) {
    console.error('Error handling JOIN_ROOM:', error);
    sendToSocket(socketId, {
      type: 'ERROR',
      data: { message: 'Failed to join room' },
    });
  }
}

async function handleKickPlayer(
  ws: any,
  socketId: string,
  event: KickPlayerEvent
) {
  try {
    const { socketId: targetSocketId, ban } = event.data;

    // Get host's game
    const conn = connections.get(socketId);
    if (!conn || !conn.isHost) {
      sendToSocket(socketId, {
        type: 'ERROR',
        data: { message: 'Only host can kick players' },
      });
      return;
    }

    const pin = conn.pin;

    // Get target player info
    const playerInfo = await getPlayerInfo(pin, targetSocketId);
    if (!playerInfo) {
      sendToSocket(socketId, {
        type: 'ERROR',
        data: { message: 'Player not found' },
      });
      return;
    }

    // Ban IP if requested
    if (ban) {
      await addToBanList(pin, playerInfo.ip);
    }

    // Send disconnect message to player
    sendToSocket(targetSocketId, {
      type: 'FORCE_DISCONNECT',
      data: { reason: 'Atıldınız' },
    });

    // Remove player from game
    await removePlayer(pin, targetSocketId);

    // Close their connection
    const targetConn = connections.get(targetSocketId);
    if (targetConn) {
      targetConn.ws.close();
      connections.delete(targetSocketId);
    }

    // Update lobby count for host
    const gameState = await getGameState(pin);
    if (gameState) {
      sendToHost(pin, {
        type: 'LOBBY_UPDATE',
        data: { count: gameState.totalPlayers },
      });
    }
  } catch (error) {
    console.error('Error handling KICK_PLAYER:', error);
    sendToSocket(socketId, {
      type: 'ERROR',
      data: { message: 'Failed to kick player' },
    });
  }
}

async function handleStartGame(
  ws: any,
  socketId: string,
  event: StartGameEvent
) {
  try {
    const conn = connections.get(socketId);
    if (!conn) {
      sendToSocket(socketId, {
        type: 'ERROR',
        data: { message: 'Connection not found' },
      });
      return;
    }

    const pin = conn.pin;

    // Mark this socket as host
    conn.isHost = true;
    hostConnections.set(pin, socketId);

    // Update game state to ACTIVE
    await updateGameState(pin, {
      status: 'ACTIVE',
      hostSocketId: socketId,
    });

    // Fetch first question
    await sendNextQuestion(pin, 0);
  } catch (error) {
    console.error('Error handling START_GAME:', error);
    sendToSocket(socketId, {
      type: 'ERROR',
      data: { message: 'Failed to start game' },
    });
  }
}

async function sendNextQuestion(pin: string, questionIndex: number) {
  const gameState = await getGameState(pin);
  if (!gameState) return;

  // Fetch quiz questions from DB
  const questions = await db.query.questions.findMany({
    where: eq(schema.questions.quizId, gameState.quizId),
  });

  questions.sort((a, b) => a.orderIndex - b.orderIndex);

  if (questionIndex >= questions.length) {
    // No more questions - game over
    await handleGameOver(pin);
    return;
  }

  const question = questions[questionIndex];

  // Reset answer flags for new question
  await resetAllAnswerFlags(pin);

  // Update current question index
  await updateGameState(pin, {
    currentQuestionIndex: questionIndex,
  });

  // Prepare options based on game mode
  let options = (question.options as any[]).map((opt: any, idx: number) => ({
    text: gameState.mode === 'STAGE' ? '' : opt.text || opt,
    color: getOptionColor(idx),
  }));

  // Broadcast QUESTION_START
  broadcastToGame(pin, {
    type: 'QUESTION_START',
    data: {
      questionIndex,
      text: question.text,
      mediaUrl: question.mediaUrl || undefined,
      options,
      timeLimit: question.timeLimit,
    },
  });
}

async function handleSubmitAnswer(
  ws: any,
  socketId: string,
  event: SubmitAnswerEvent
) {
  try {
    const { questionId, answerIndex } = event.data;

    const conn = connections.get(socketId);
    if (!conn) {
      sendToSocket(socketId, {
        type: 'ERROR',
        data: { message: 'Connection not found' },
      });
      return;
    }

    const pin = conn.pin;

    // Get player info
    const playerInfo = await getPlayerInfo(pin, socketId);
    if (!playerInfo) {
      sendToSocket(socketId, {
        type: 'ERROR',
        data: { message: 'Player not found' },
      });
      return;
    }

    // Check if already answered
    if (playerInfo.hasAnswered) {
      sendToSocket(socketId, {
        type: 'ERROR',
        data: { message: 'Already answered this question' },
      });
      return;
    }

    // Check answer from Redis (zero-latency)
    const isCorrect = await checkAnswer(pin, questionId, answerIndex);

    // Get question details for scoring
    const question = await db.query.questions.findFirst({
      where: eq(schema.questions.id, questionId),
    });

    if (!question) {
      sendToSocket(socketId, {
        type: 'ERROR',
        data: { message: 'Question not found' },
      });
      return;
    }

    // Calculate score (assuming immediate answer for now, you can add timer logic)
    const timeRemaining = question.timeLimit / 2; // Placeholder
    const earnedPoints = calculateScore(
      isCorrect,
      question.points || 1000,
      question.timeLimit,
      timeRemaining,
      playerInfo.streak
    );

    // Update player score
    const { newScore, newStreak } = await updatePlayerScore(
      pin,
      socketId,
      earnedPoints,
      isCorrect
    );

    // Send result to player
    sendToSocket(socketId, {
      type: 'ANSWER_RESULT',
      data: {
        correct: isCorrect,
        earnedPoints,
        currentScore: newScore,
        streak: newStreak,
      },
    });

    // Increment total answers
    const gameState = await getGameState(pin);
    if (gameState) {
      const newTotalAnswers = gameState.totalAnswers + 1;
      await updateGameState(pin, {
        totalAnswers: newTotalAnswers,
      });

      // Auto-trigger scoreboard if everyone answered
      if (newTotalAnswers >= gameState.totalPlayers) {
        await showScoreboard(pin);
      }
    }
  } catch (error) {
    console.error('Error handling SUBMIT_ANSWER:', error);
    sendToSocket(socketId, {
      type: 'ERROR',
      data: { message: 'Failed to submit answer' },
    });
  }
}

async function showScoreboard(pin: string) {
  const leaderboard = await getLeaderboard(pin, 5);

  broadcastToGame(pin, {
    type: 'SHOW_SCOREBOARD',
    data: {
      topPlayers: leaderboard,
    },
  });
}

async function handleNextQuestion(
  ws: any,
  socketId: string,
  event: NextQuestionEvent
) {
  try {
    const conn = connections.get(socketId);
    if (!conn || !conn.isHost) {
      sendToSocket(socketId, {
        type: 'ERROR',
        data: { message: 'Only host can advance questions' },
      });
      return;
    }

    const pin = conn.pin;
    const gameState = await getGameState(pin);

    if (!gameState) {
      sendToSocket(socketId, {
        type: 'ERROR',
        data: { message: 'Game not found' },
      });
      return;
    }

    const nextIndex = gameState.currentQuestionIndex + 1;

    if (nextIndex >= gameState.totalQuestions) {
      await handleGameOver(pin);
    } else {
      await sendNextQuestion(pin, nextIndex);
    }
  } catch (error) {
    console.error('Error handling NEXT_QUESTION:', error);
    sendToSocket(socketId, {
      type: 'ERROR',
      data: { message: 'Failed to advance question' },
    });
  }
}

async function handleGameOver(pin: string) {
  // Update game status
  await updateGameState(pin, {
    status: 'FINISHED',
  });

  // Get final leaderboard
  const finalScores = await getLeaderboard(pin, 10);

  // Broadcast GAME_OVER
  broadcastToGame(pin, {
    type: 'GAME_OVER',
    data: {
      winner: finalScores[0]?.nickname || 'N/A',
      finalScores,
    },
  });
}
