
// GAME TYPES & INTERFACES


export type GameStatus = 'LOBBY' | 'ACTIVE' | 'FINISHED';
export type GameMode = 'PERSONAL' | 'STAGE';


// REDIS DATA STRUCTURES


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
    lastPoints?: number;
}

export interface LeaderboardEntry {
    nickname: string;
    score: number;
}


// HTTP REQUEST/RESPONSE TYPES


export interface CreateGameRequest {
    quizId: string;
}

// PDF SPEC: QR URL removed 
export interface CreateGameResponse {
    success: boolean;
    gameId: string;
    pin: string;
    mode: GameMode;
}

export interface GameSummaryResponse {
    success: boolean;
    status: GameStatus;
    totalPlayers: number;
    winner?: string;
    finalScores?: LeaderboardEntry[];
}


// WEBSOCKET EVENT TYPES


export type WebSocketEventType =
    | 'JOIN_ROOM'
    | 'JOIN_SUCCESS'
    | 'LOBBY_UPDATE'
    | 'KICK_PLAYER'
    | 'PLAYER_JOINED'
    | 'PLAYER_KICKED'
    | 'FORCE_DISCONNECT'
    | 'START_GAME'
    | 'GAME_STARTING'
    | 'QUESTION_START'
    | 'SUBMIT_ANSWER'
    | 'QUESTION_END'
    | 'SHOW_LEADERBOARD'
    | 'LEADERBOARD_RESULT'
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
        nickname: string;
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
        answerIndex: number;
    };
}

// PDF SPEC: NEW - Manual leaderboard trigger
export interface ShowLeaderboardEvent {
    type: 'SHOW_LEADERBOARD';
    data: {
        gameId: string;
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

// PDF SPEC: recentPlayers (last 28 only)
export interface LobbyUpdateEvent {
    type: 'LOBBY_UPDATE';
    data: {
        count: number;
        recentPlayers: string[]; // Last 28 players
        players?: Array<{ socketId: string; nickname: string }>;
        totalPlayers?: number;
    };
}

export interface PlayerJoinedEvent {
    type: 'PLAYER_JOINED';
    data: {
        nickname: string;
        playerCount: number;
    };
}

export interface PlayerKickedEvent {
    type: 'PLAYER_KICKED';
    data: {
        nickname: string;
    };
}

export interface ForceDisconnectEvent {
    type: 'FORCE_DISCONNECT';
    data: {
        reason: string;
    };
}

// PDF SPEC: Added serverTime
export interface GameStartingEvent {
    type: 'GAME_STARTING';
    data: {
        countDown: number;
        serverTime: number;
    };
}

// PDF SPEC: Added serverTime, mode-based filtering
export interface QuestionStartEvent {
    type: 'QUESTION_START';
    data: {
        qIndex: number;
        time: number;
        serverTime: number;
        text?: string;         // Included in PERSONAL mode
        mediaUrl?: string;     // Included in PERSONAL mode
        options?: Array<{ text: string; color: string }>; // Filtered by mode
    };
}

// PDF SPEC: DIFFERENTIATED - To Host
export interface QuestionEndHostEvent {
    type: 'QUESTION_END';
    data: {
        correctOptionIndex: number;
        stats: Record<string, number>; // { "0": 15, "1": 5, "2": 40, "3": 0 }
    };
}

// PDF SPEC: DIFFERENTIATED - To Player
export interface QuestionEndPlayerEvent {
    type: 'QUESTION_END';
    data: {
        correct: boolean;
        scoreEarned: number;
        streak: number;
        correctOptionIndex: number;
    };
}

// PDF SPEC: DIFFERENTIATED - To Host
export interface LeaderboardResultHostEvent {
    type: 'LEADERBOARD_RESULT';
    data: {
        top5: Array<{ nick: string; score: number }>;
        highStreaks: Array<{ nick: string; streak: number }>;
    };
}

// PDF SPEC: DIFFERENTIATED - To Player
export interface LeaderboardResultPlayerEvent {
    type: 'LEADERBOARD_RESULT';
    data: {
        top5: Array<{ nick: string; score: number }>;
        myRank: number;
        myTotalScore: number;
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
    | ShowLeaderboardEvent
    | NextQuestionEvent
    | JoinSuccessEvent
    | LobbyUpdateEvent
    | PlayerJoinedEvent
    | PlayerKickedEvent
    | ForceDisconnectEvent
    | GameStartingEvent
    | QuestionStartEvent
    | QuestionEndHostEvent
    | QuestionEndPlayerEvent
    | LeaderboardResultHostEvent
    | LeaderboardResultPlayerEvent
    | GameOverEvent
    | ErrorEvent;


// QUESTION DATA (from DB)


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


// HELPER TYPES FOR TRACKING


export interface PlayerAnswerRecord {
    socketId: string;
    nickname: string;
    optionIndex: number;
    wasCorrect: boolean;
    scoreEarned: number;
    totalScore: number;
    streak: number;
    answeredAt: number;
}
