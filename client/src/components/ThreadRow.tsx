import { formatInboxTime } from "@/lib/timeUtils";

interface ThreadRowProps {
  name: string;
  lastMessageText: string | null;
  lastMessageFromSelf: boolean;
  lastMessageAt: string | null;
  unreadCount: number;
  onClick: () => void;
}

export default function ThreadRow({
  name,
  lastMessageText,
  lastMessageFromSelf,
  lastMessageAt,
  unreadCount,
  onClick,
}: ThreadRowProps) {
  const preview = lastMessageText
    ? `${lastMessageFromSelf && lastMessageText !== "Start a conversation" ? "You: " : ""}${lastMessageText}`
    : "";

  return (
    <button
      onClick={onClick}
      className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/40 focus:bg-muted/60 text-left border-b border-border last:border-b-0"
      data-testid="button-thread-row"
    >
      {/* Unread dot (only if unread) */}
      <div className="w-3 flex justify-center shrink-0">
        {unreadCount > 0 && (
          <span 
            className="inline-block h-2 w-2 rounded-full bg-blue-600"
            data-testid="indicator-unread-dot"
          />
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={`truncate ${
              unreadCount > 0 ? "font-semibold" : "font-medium"
            }`}
            data-testid="text-thread-name"
          >
            {name}
          </span>
          {lastMessageAt && (
            <span 
              className="ml-2 shrink-0 text-xs text-muted-foreground"
              data-testid="text-thread-time"
            >
              {formatInboxTime(lastMessageAt)}
            </span>
          )}
        </div>
        <div 
          className="text-sm text-muted-foreground truncate mt-0.5"
          data-testid="text-thread-preview"
        >
          {preview || " "}
        </div>
      </div>
    </button>
  );
}
