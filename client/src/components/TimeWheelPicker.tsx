import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Clock } from 'lucide-react';

interface TimeWheelPickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
}

const HOURS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const MINUTES = ['00', '15', '30', '45'];
const PERIODS = ['AM', 'PM'];

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;

function WheelColumn({ 
  items, 
  value, 
  onChange,
  width = 64
}: { 
  items: string[]; 
  value: string; 
  onChange: (val: string) => void;
  width?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const selectedIndex = items.indexOf(value);
  
  const scrollToIndex = useCallback((index: number, smooth = true) => {
    if (containerRef.current) {
      const scrollTop = index * ITEM_HEIGHT;
      containerRef.current.scrollTo({
        top: scrollTop,
        behavior: smooth ? 'smooth' : 'auto'
      });
    }
  }, []);
  
  useEffect(() => {
    if (!isScrollingRef.current && selectedIndex >= 0) {
      scrollToIndex(selectedIndex, false);
    }
  }, [selectedIndex, scrollToIndex]);
  
  const handleScroll = () => {
    if (!containerRef.current) return;
    
    isScrollingRef.current = true;
    
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    scrollTimeoutRef.current = setTimeout(() => {
      if (containerRef.current) {
        const scrollTop = containerRef.current.scrollTop;
        const index = Math.round(scrollTop / ITEM_HEIGHT);
        const clampedIndex = Math.max(0, Math.min(index, items.length - 1));
        
        scrollToIndex(clampedIndex, true);
        
        if (items[clampedIndex] !== value) {
          onChange(items[clampedIndex]);
        }
      }
      isScrollingRef.current = false;
    }, 80);
  };
  
  const handleItemClick = (index: number) => {
    scrollToIndex(index, true);
    onChange(items[index]);
  };
  
  const paddingItems = Math.floor(VISIBLE_ITEMS / 2);
  
  return (
    <div 
      className="relative flex-shrink-0 flex-grow-0"
      style={{ 
        width: `${width}px`, 
        height: `${ITEM_HEIGHT * VISIBLE_ITEMS}px`,
        overflow: 'hidden',
      }}
    >
      <div 
        ref={containerRef}
        className="h-full scrollbar-hide"
        onScroll={handleScroll}
        style={{ 
          overflowY: 'scroll',
          overflowX: 'hidden',
          touchAction: 'pan-y',
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
          scrollSnapType: 'y mandatory',
        }}
      >
        {Array.from({ length: paddingItems }).map((_, i) => (
          <div key={`pad-top-${i}`} style={{ height: `${ITEM_HEIGHT}px` }} />
        ))}
        
        {items.map((item, index) => {
          const isSelected = item === value;
          return (
            <div
              key={item}
              onClick={() => handleItemClick(index)}
              className="flex items-center justify-center cursor-pointer select-none transition-colors duration-100"
              style={{ 
                height: `${ITEM_HEIGHT}px`,
                scrollSnapAlign: 'center',
                fontSize: isSelected ? '22px' : '18px',
                fontWeight: isSelected ? 700 : 400,
                color: isSelected ? '#1e293b' : '#94a3b8',
              }}
            >
              {item}
            </div>
          );
        })}
        
        {Array.from({ length: paddingItems }).map((_, i) => (
          <div key={`pad-bot-${i}`} style={{ height: `${ITEM_HEIGHT}px` }} />
        ))}
      </div>
    </div>
  );
}

export function TimeWheelPicker({ value, onChange, label, className }: TimeWheelPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hour, setHour] = useState('09');
  const [minute, setMinute] = useState('00');
  const [period, setPeriod] = useState('AM');
  
  const normalizeMinutes = (min: number): string => {
    if (min < 15) return '00';
    if (min < 30) return '15';
    if (min < 45) return '30';
    return '45';
  };
  
  useEffect(() => {
    if (value) {
      const [h, m] = value.split(':');
      let hourNum = parseInt(h, 10);
      const minNum = parseInt(m, 10);
      
      const newPeriod = hourNum >= 12 ? 'PM' : 'AM';
      if (hourNum === 0) hourNum = 12;
      else if (hourNum > 12) hourNum -= 12;
      
      setHour(hourNum.toString().padStart(2, '0'));
      setMinute(normalizeMinutes(minNum));
      setPeriod(newPeriod);
    }
  }, [value]);
  
  useEffect(() => {
    if (isOpen && !value) {
      setHour('09');
      setMinute('00');
      setPeriod('AM');
    }
  }, [isOpen, value]);
  
  const handleSave = () => {
    let hourNum = parseInt(hour, 10);
    if (period === 'AM' && hourNum === 12) hourNum = 0;
    else if (period === 'PM' && hourNum !== 12) hourNum += 12;
    
    const timeStr = `${hourNum.toString().padStart(2, '0')}:${minute}`;
    onChange(timeStr);
    setIsOpen(false);
  };
  
  const formatDisplayTime = () => {
    if (!value) return 'Select time';
    const [h, m] = value.split(':');
    let hourNum = parseInt(h, 10);
    const displayPeriod = hourNum >= 12 ? 'PM' : 'AM';
    if (hourNum === 0) hourNum = 12;
    else if (hourNum > 12) hourNum -= 12;
    return `${hourNum}:${m.padStart(2, '0')} ${displayPeriod}`;
  };
  
  const getCurrentSelection = () => {
    const hourDisplay = parseInt(hour, 10);
    return `${hourDisplay}:${minute} ${period}`;
  };
  
  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`w-full h-10 flex items-center justify-between px-3 border rounded-xl bg-background border-input text-base md:text-sm text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 ${className || ''}`}
      >
        <span className={value ? 'text-foreground' : 'text-muted-foreground'}>
          {formatDisplayTime()}
        </span>
        <Clock className="h-4 w-4 text-muted-foreground" />
      </button>
      
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent hideCloseButton className="w-[95vw] max-w-[300px] p-0 gap-0 overflow-hidden rounded-2xl">
          <div className="flex items-center justify-center px-4 h-12 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {label || 'Select Time'}
            </DialogTitle>
          </div>
          
          <div className="bg-white dark:bg-slate-900 p-4 space-y-3">
            <div 
              className="flex items-center justify-center bg-slate-50 dark:bg-slate-800 rounded-xl py-3 border border-slate-200 dark:border-slate-700"
              style={{ gap: '4px' }}
            >
              <WheelColumn items={HOURS} value={hour} onChange={setHour} width={60} />
              <span className="text-2xl font-bold text-slate-400 flex-shrink-0">:</span>
              <WheelColumn items={MINUTES} value={minute} onChange={setMinute} width={60} />
              <WheelColumn items={PERIODS} value={period} onChange={setPeriod} width={60} />
            </div>
            
            <div className="text-center py-2">
              <span className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {getCurrentSelection()}
              </span>
            </div>
            
            <div className="space-y-2">
              <Button onClick={handleSave} className="w-full h-11 rounded-xl font-medium">
                Done
              </Button>
              <Button variant="outline" onClick={() => setIsOpen(false)} className="w-full h-11 rounded-xl font-medium">
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
