// Message utilities for filtering, grouping, and formatting

export type MessageType = {
  id: string | number;
  senderId: string;
  body: string;
  createdAt: Date;
  isPending?: boolean;
  isFailed?: boolean;
};

const toDayKey = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Check if a message should be rendered (has actual content)
 */
export const isRenderableMessage = (m: MessageType) => {
  const text = (m.body ?? '').trim();
  return text.length > 0;
};

/**
 * Group messages by day for date separators
 */
export const groupByDay = (messages: MessageType[]) => {
  const out: Array<{ day: string; items: MessageType[] }> = [];
  const map = new Map<string, MessageType[]>();
  
  messages.forEach((m) => {
    const d = new Date(m.createdAt);
    const k = toDayKey(d);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(m);
  });
  
  Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .forEach(([day, items]) => {
      items.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
      out.push({ day, items });
    });
    
  return out;
};

/**
 * Format day label as "Today", "Yesterday", or date
 */
export const formatDayLabel = (dayKey: string) => {
  const [y, m, d] = dayKey.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  const today = new Date();
  const diff = Math.floor((+today.setHours(0, 0, 0, 0) - +day) / 86400000);
  
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  
  return day.toLocaleDateString(undefined, { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });
};

/**
 * Format time for message timestamp
 */
export const formatTime = (dt: Date) =>
  dt.toLocaleTimeString(undefined, { 
    hour: 'numeric', 
    minute: '2-digit' 
  });
