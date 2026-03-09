/**
 * Telegram Webhook Loglama Helper
 * Tek bir Forum grubunda konulara (topics) göre log gönderir.
 * INFO dahil tüm seviyeler Telegram'a gönderilir.
 */

type LogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
type LogSource = 'code' | 'system';

const TOPIC_IDS: Record<LogLevel, string | undefined> = {
    INFO: Bun.env.TELEGRAM_INFO_TOPIC_ID,
    WARNING: Bun.env.TELEGRAM_WARNING_TOPIC_ID,
    ERROR: Bun.env.TELEGRAM_ERROR_TOPIC_ID,
    CRITICAL: Bun.env.TELEGRAM_CRITICAL_TOPIC_ID,
};

export const logEvent = ({
    event,
    level,
    source,
    data,
}: {
    event: string;
    level: LogLevel;
    source: LogSource;
    data?: Record<string, unknown>;
}) => {
    const token = Bun.env.TELEGRAM_BOT_TOKEN;
    const chatId = Bun.env.TELEGRAM_CHAT_ID;
    const topicId = TOPIC_IDS[level];

    // Token, chatId veya topicId yoksa sessizce çık
    if (!token || !chatId || !topicId) return;

    const icon = level === 'CRITICAL' ? '🔺' : level === 'ERROR' ? '❌' : level === 'WARNING' ? '⚠️' : 'ℹ️';
    const text = [
        `${icon} *${level}* | \`${event}\``,
        `🔘 *Kaynak:* ${source}`,
        `🕐 ${new Date().toISOString()}`,
        data ? `\`\`\`\n${JSON.stringify(data, null, 2)}\n\`\`\`` : '',
    ].join('\n');

    // Fire-and-forget: Ana iş akışını bloklamaz
    fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            message_thread_id: Number(topicId),
            text,
            parse_mode: 'Markdown',
        }),
    }).catch(() => console.error('Telegram log failed'));
};
