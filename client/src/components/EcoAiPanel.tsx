import { useState, useRef, useEffect } from "react";
import { Sparkles, Send, Check, X, Briefcase, UserPlus, Calendar, MessageSquare, Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";

const outlineLogo = "/assets/ecologic-outline-cropped.png";

interface ChatMessage {
  id?: number;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
}

interface ProposedAction {
  id: number;
  tool: string;
  friendlyName: string;
  payload: Record<string, any>;
  status: string;
}

const TOOL_ICONS: Record<string, typeof Briefcase> = {
  createJob: Briefcase,
  createClient: UserPlus,
  scheduleAppointment: Calendar,
  sendMessage: MessageSquare,
};

const TOOL_COLORS: Record<string, string> = {
  createJob: "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/30",
  createClient: "text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/30",
  scheduleAppointment: "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/30",
  sendMessage: "text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-900/30",
};

const GREETING = `Hi! I'm your Eco-Intelligence assistant. Here's what I can help with:\n\n• **Create a client** — "Create client John Smith"\n• **Create a job** — "Create a job for Maria at 22 Bay Ave"\n• **Schedule** — "Schedule job #101 for tomorrow at 9am"\n• **Send a message** — "Message saying: on my way"`;

interface EcoAiPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function EcoAiPanel({ open, onOpenChange }: EcoAiPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: GREETING },
  ]);
  const [actions, setActions] = useState<ProposedAction[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [executingAction, setExecutingAction] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, actions]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    setInput("");
    setMessages(prev => [...prev, { role: "user", content: trimmed }]);
    setSending(true);

    try {
      const res = await apiRequest("POST", "/api/eco-ai/chat", {
        conversationId,
        message: trimmed,
      });
      const data = await res.json();
      if (data.conversationId) setConversationId(data.conversationId);
      setMessages(prev => [...prev, { role: "assistant", content: data.assistantMessage }]);
      if (data.proposedActions?.length) {
        setActions(prev => [...prev, ...data.proposedActions]);
      }
    } catch {
      setMessages(prev => [...prev, { role: "system", content: "Something went wrong. Please try again." }]);
    } finally {
      setSending(false);
    }
  };

  const handleConfirm = async (action: ProposedAction) => {
    setExecutingAction(action.id);
    try {
      const res = await apiRequest("POST", "/api/eco-ai/execute", { actionId: action.id });
      const data = await res.json();
      setActions(prev => prev.map(a => a.id === action.id ? { ...a, status: data.success ? "executed" : "failed" } : a));
      setMessages(prev => [...prev, { role: "system", content: data.assistantMessage }]);
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
        queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
        queryClient.invalidateQueries({ queryKey: ["/api/schedule"] });
      }
    } catch {
      setMessages(prev => [...prev, { role: "system", content: "Failed to execute action." }]);
    } finally {
      setExecutingAction(null);
    }
  };

  const handleCancel = async (action: ProposedAction) => {
    try {
      await apiRequest("POST", "/api/eco-ai/cancel", { actionId: action.id });
      setActions(prev => prev.map(a => a.id === action.id ? { ...a, status: "rejected" } : a));
      setMessages(prev => [...prev, { role: "system", content: "Action cancelled." }]);
    } catch {
      // silently fail
    }
  };

  const pendingActions = actions.filter(a => a.status === "proposed");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[420px] flex flex-col p-0">
        <SheetHeader className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <SheetTitle className="flex items-center gap-2">
            <span>Eco-Intelligence</span>
            <Sparkles className="h-4 w-4 text-amber-500" />
          </SheetTitle>
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-teal-600 text-white rounded-br-md"
                  : msg.role === "system"
                  ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-bl-md italic text-xs"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-bl-md"
              }`}>
                {msg.content.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
                  part.startsWith("**") && part.endsWith("**")
                    ? <strong key={j}>{part.slice(2, -2)}</strong>
                    : <span key={j}>{part}</span>
                )}
              </div>
            </div>
          ))}

          {pendingActions.map(action => {
            const Icon = TOOL_ICONS[action.tool] || Briefcase;
            const colorClass = TOOL_COLORS[action.tool] || "text-slate-600 bg-slate-50";
            return (
              <div key={action.id} className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                <div className="px-3.5 py-2.5 flex items-center gap-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colorClass}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{action.friendlyName}</span>
                </div>
                <div className="px-3.5 py-2.5 space-y-1">
                  {Object.entries(action.payload).map(([key, value]) => (
                    <div key={key} className="flex items-baseline gap-2 text-xs">
                      <span className="text-slate-400 dark:text-slate-500 min-w-[80px]">{key}:</span>
                      <span className="text-slate-700 dark:text-slate-300">{String(value)}</span>
                    </div>
                  ))}
                </div>
                <div className="px-3.5 py-2.5 flex gap-2 border-t border-slate-100 dark:border-slate-700">
                  <Button
                    size="sm"
                    onClick={() => handleConfirm(action)}
                    disabled={executingAction === action.id}
                    className="flex-1 bg-teal-600 hover:bg-teal-700 text-white h-8 text-xs"
                  >
                    {executingAction === action.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <Check className="h-3.5 w-3.5 mr-1" />
                    )}
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCancel(action)}
                    disabled={executingAction === action.id}
                    className="flex-1 h-8 text-xs"
                  >
                    <X className="h-3.5 w-3.5 mr-1" />
                    Cancel
                  </Button>
                </div>
              </div>
            );
          })}

          {sending && (
            <div className="flex justify-start">
              <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 px-3 py-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Ask Eco-Intelligence..."
              disabled={sending}
              className="flex-1 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 rounded-full px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-500/50 transition-shadow"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface EcoAiButtonProps {
  onClick: () => void;
  className?: string;
}

export function EcoAiButton({ onClick, className = "" }: EcoAiButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`relative w-9 h-9 flex items-center justify-center rounded-full text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${className}`}
      aria-label="Open Eco-Intelligence"
      title="Eco-Intelligence"
    >
      <img
        src={outlineLogo}
        alt="Eco-AI"
        className="object-contain"
        style={{ width: 24, height: 24, opacity: 0.95, filter: "drop-shadow(0 0 0.5px rgba(0,0,0,0.35))" }}
      />
    </button>
  );
}
