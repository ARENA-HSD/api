// ============================================
// GAME TYPES & INTERFACES
// ============================================

export type GameStatus = 'LOBBY' | 'ACTIVE' | 'FINISHED';
export type GameMode = 'PERSONAL' | 'STAGE';

// ============================================
// REDIS DATA STRUCTURES
// ============================================

export interface GameState {
    status: GameStatus;
    currentQuestionIndex: number;
    mode: GameMode;
    hostSocketId: string;
    totalAnswers: number;
    quizId: string;
    totalPlayers: number;
    totalQuestions: number;
}

export interface PlayerInfo {
    nickname: string;
    score: number;
    streak: number;
    ip: string;
    hasAnswered: boolean;
}

export interface LeaderboardEntry {
    nickname: string;
    score: number;
}

// ============================================
// HTTP REQUEST/RESPONSE TYPES
// ============================================

export interface CreateGameRequest {
    quizId: string;
}

export interface CreateGameResponse {
    success: boolean;
    gameId: string;
    pin: string;
    qrUrl: string;
    mode: GameMode;
}

export interface GameSummaryResponse {
    success: boolean;
    status: GameStatus;
    totalPlayers: number;
    winner?: string;
    finalScores?: LeaderboardEntry[];
}

// ============================================
// WEBSOCKET EVENT TYPES
// ============================================

export type WebSocketEventType =
    | 'JOIN_ROOM'
    | 'JOIN_SUCCESS'
    | 'LOBBY_UPDATE'
    | 'KICK_PLAYER'
    | 'FORCE_DISCONNECT'
    | 'START_GAME'
    | 'QUESTION_START'
    | 'SUBMIT_ANSWER'
    | 'ANSWER_RESULT'
    | 'SHOW_SCOREBOARD'
    | 'NEXT_QUESTION'
    | 'GAME_OVER'
    | 'ERROR';

// Client -> Server Events
export interface JoinRoomEvent {
    type: 'JOIN_ROOM';
    data: {
        pin: string;
        nickname: string;
    };
}

export interface KickPlayerEvent {
    type: 'KICK_PLAYER';
    data: {
        socketId: string;
        ban: boolean;
    };
}

export interface StartGameEvent {
    type: 'START_GAME';
    data: {
        gameId: string;
    };
}

export interface SubmitAnswerEvent {
    type: 'SUBMIT_ANSWER';
    data: {
        questionId: string;
        answerIndex: number;
    };
}

export interface NextQuestionEvent {
    type: 'NEXT_QUESTION';
    data: {
        gameId: string;
    };
}

// Server -> Client Events
export interface JoinSuccessEvent {
    type: 'JOIN_SUCCESS';
    data: {
        status: 'WAITING';
        myNick: string;
    };
}

export interface LobbyUpdateEvent {
    type: 'LOBBY_UPDATE';
    data: {
        count: number;
    };
}

export interface ForceDisconnectEvent {
    type: 'FORCE_DISCONNECT';
    data: {
        reason: string;
    };
}

export interface QuestionStartEvent {
    type: 'QUESTION_START';
    data: {
        questionIndex: number;
        text: string;
        mediaUrl?: string;
        options: Array<{ text: string; color: string }>;
        timeLimit: number;
    };
}

export interface AnswerResultEvent {
    type: 'ANSWER_RESULT';
    data: {
        correct: boolean;
        earnedPoints: number;
        currentScore: number;
        streak: number;
    };
}

export interface ShowScoreboardEvent {
    type: 'SHOW_SCOREBOARD';
    data: {
        topPlayers: LeaderboardEntry[];
    };
}

export interface GameOverEvent {
    type: 'GAME_OVER';
    data: {
        winner: string;
        finalScores: LeaderboardEntry[];
    };
}

export interface ErrorEvent {
    type: 'ERROR';
    data: {
        message: string;
    };
}

// Union type for all events
export type WebSocketEvent =
    | JoinRoomEvent
    | KickPlayerEvent
    | StartGameEvent
    | SubmitAnswerEvent
    | NextQuestionEvent
    | JoinSuccessEvent
    | LobbyUpdateEvent
    | ForceDisconnectEvent
    | QuestionStartEvent
    | AnswerResultEvent
    | ShowScoreboardEvent
    | GameOverEvent
    | ErrorEvent;

// ============================================
// QUESTION DATA (from DB)
// ============================================

export interface QuestionData {
    id: string;
    text: string;
    mediaUrl?: string;
    timeLimit: number;
    points: number;
    correctIndex: number;
    orderIndex: number;
    options: Array<{ text: string; color: string }>;
}

export interface QuizData {
    id: string;
    title: string;
    defaultMode: GameMode;
    questions: QuestionData[];
}
