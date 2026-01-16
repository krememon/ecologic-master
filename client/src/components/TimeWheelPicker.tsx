import { useState, useEffect, useRef } from 'react';
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

function WheelColumn({ 
  items, 
  value, 
  onChange 
}: { 
  items: string[]; 
  value: string; 
  onChange: (val: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemHeight = 44;
  
  const selectedIndex = items.indexOf(value);
  
  useEffect(() => {
    if (containerRef.current && selectedIndex >= 0) {
      containerRef.current.scrollTop = selectedIndex * itemHeight;
    }
  }, [selectedIndex]);
  
  const handleScroll = () => {
    if (containerRef.current) {
      const scrollTop = containerRef.current.scrollTop;
      const index = Math.round(scrollTop / itemHeight);
      const clampedIndex = Math.max(0, Math.min(index, items.length - 1));
      if (items[clampedIndex] !== value) {
        onChange(items[clampedIndex]);
      }
    }
  };
  
  return (
    <div className="relative h-[132px] w-16 overflow-hidden">
      <div className="absolute inset-x-0 top-[44px] h-[44px] bg-blue-100 dark:bg-blue-900/30 rounded-lg pointer-events-none z-10" />
      <div 
        ref={containerRef}
        className="h-full overflow-y-auto scrollbar-hide snap-y snap-mandatory"
        onScroll={handleScroll}
        style={{ scrollBehavior: 'smooth' }}
      >
        <div className="h-[44px]" />
        {items.map((item, index) => (
          <div
            key={item}
            className={`h-[44px] flex items-center justify-center text-xl font-medium snap-center cursor-pointer transition-all ${
              item === value 
                ? 'text-blue-600 dark:text-blue-400 scale-110' 
                : 'text-slate-400 dark:text-slate-500'
            }`}
            onClick={() => {
              onChange(item);
              if (containerRef.current) {
                containerRef.current.scrollTo({ top: index * itemHeight, behavior: 'smooth' });
              }
            }}
          >
            {item}
          </div>
        ))}
        <div className="h-[44px]" />
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
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>{label || 'Select Time'}</DialogTitle>
          </DialogHeader>
          
          <div className="flex items-center justify-center gap-2 py-4">
            <WheelColumn items={HOURS} value={hour} onChange={setHour} />
            <span className="text-2xl font-bold text-slate-400">:</span>
            <WheelColumn items={MINUTES} value={minute} onChange={setMinute} />
            <WheelColumn items={PERIODS} value={period} onChange={setPeriod} />
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
