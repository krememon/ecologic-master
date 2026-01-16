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

const ITEM_HEIGHT = 40;
const VISIBLE_ITEMS = 3;

function WheelColumn({ 
  items, 
  value, 
  onChange,
  width = 60
}: { 
  items: string[]; 
  value: string; 
  onChange: (val: string) => void;
  width?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
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
    }, 100);
  };
  
  const handleItemClick = (index: number) => {
    scrollToIndex(index, true);
    onChange(items[index]);
  };
  
  return (
    <div 
      className="relative overflow-hidden flex-shrink-0"
      style={{ 
        width: `${width}px`, 
        height: `${ITEM_HEIGHT * VISIBLE_ITEMS}px`,
      }}
    >
      <div 
        className="absolute inset-x-0 pointer-events-none z-20"
        style={{ 
          top: `${ITEM_HEIGHT}px`, 
          height: `${ITEM_HEIGHT}px`,
        }}
      >
        <div className="h-full mx-1 bg-blue-100 dark:bg-blue-900/40 rounded-lg border-y-2 border-blue-200 dark:border-blue-700" />
      </div>
      
      <div 
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          background: 'linear-gradient(to bottom, rgba(255,255,255,0.9) 0%, transparent 30%, transparent 70%, rgba(255,255,255,0.9) 100%)',
        }}
      />
      <div 
        className="absolute inset-0 pointer-events-none z-10 hidden dark:block"
        style={{
          background: 'linear-gradient(to bottom, rgba(15,23,42,0.9) 0%, transparent 30%, transparent 70%, rgba(15,23,42,0.9) 100%)',
        }}
      />
      
      <div 
        ref={containerRef}
        className="h-full overflow-y-auto overflow-x-hidden scrollbar-hide"
        onScroll={handleScroll}
        style={{ 
          touchAction: 'pan-y',
          overscrollBehavior: 'contain',
          scrollSnapType: 'y mandatory',
        }}
      >
        <div style={{ height: `${ITEM_HEIGHT}px` }} />
        
        {items.map((item, index) => (
          <div
            key={item}
            onClick={() => handleItemClick(index)}
            className={`flex items-center justify-center cursor-pointer select-none transition-all duration-150 ${
              item === value 
                ? 'text-blue-600 dark:text-blue-400 font-bold text-xl' 
                : 'text-slate-400 dark:text-slate-500 text-lg'
            }`}
            style={{ 
              height: `${ITEM_HEIGHT}px`,
              scrollSnapAlign: 'center',
            }}
          >
            {item}
          </div>
        ))}
        
        <div style={{ height: `${ITEM_HEIGHT}px` }} />
      </div>
    </div>
  );
}

export function TimeWheelPicker({ value, onChange, label, className }: TimeWheelPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hour, setHour] = useState('09');
  const [minute, setMinute] = useState('00');
  const [period, setPeriod] = useState('AM');
  
  useEffect(() => {
    if (value) {
      const [h, m] = value.split(':');
      let hourNum = parseInt(h, 10);
      const minNum = parseInt(m, 10);
      
      const newPeriod = hourNum >= 12 ? 'PM' : 'AM';
      if (hourNum === 0) hourNum = 12;
      else if (hourNum > 12) hourNum -= 12;
      
      const normalizedMin = Math.floor(minNum / 15) * 15;
      
      setHour(hourNum.toString().padStart(2, '0'));
      setMinute(normalizedMin.toString().padStart(2, '0'));
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
        className={`w-full flex items-center justify-between px-3 py-2 border rounded-md bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-left ${className || ''}`}
      >
        <span className={value ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400'}>
          {formatDisplayTime()}
        </span>
        <Clock className="h-4 w-4 text-slate-400" />
      </button>
      
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[280px] p-4">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-center">{label || 'Select Time'}</DialogTitle>
          </DialogHeader>
          
          <div className="flex items-center justify-center gap-0 py-2 bg-slate-50 dark:bg-slate-900 rounded-lg mx-auto">
            <WheelColumn items={HOURS} value={hour} onChange={setHour} width={56} />
            <span className="text-2xl font-bold text-slate-600 dark:text-slate-400 flex-shrink-0 w-4 text-center">:</span>
            <WheelColumn items={MINUTES} value={minute} onChange={setMinute} width={56} />
            <WheelColumn items={PERIODS} value={period} onChange={setPeriod} width={56} />
          </div>
          
          <div className="text-center py-2">
            <span className="text-lg font-semibold text-blue-600 dark:text-blue-400">
              {getCurrentSelection()}
            </span>
          </div>
          
          <DialogFooter className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setIsOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleSave} className="flex-1">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
