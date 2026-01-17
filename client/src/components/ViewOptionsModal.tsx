import { useState, useMemo, useEffect } from "react";
import { X, Search, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";

export type ExtendedViewMode = 'day' | 'list' | 'week' | 'map';

interface TeamMember {
  id: string;
  name: string;
  profileImageUrl: string | null;
}

interface ViewOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentView: ExtendedViewMode;
  selectedMembers: string[];
  showUnscheduledOnMap: boolean;
  showWeekendsOnWeek: boolean;
  teamMembers: TeamMember[];
  onApply: (options: {
    view: ExtendedViewMode;
    selectedMembers: string[];
    showUnscheduledOnMap: boolean;
    showWeekendsOnWeek: boolean;
  }) => void;
  isTechnician: boolean;
  currentUserId?: string;
}

export function ViewOptionsModal({
  isOpen,
  onClose,
  currentView,
  selectedMembers,
  showUnscheduledOnMap,
  showWeekendsOnWeek,
  teamMembers,
  onApply,
  isTechnician,
  currentUserId
}: ViewOptionsModalProps) {
  const [localView, setLocalView] = useState<ExtendedViewMode>(currentView);
  const [localSelectedMembers, setLocalSelectedMembers] = useState<string[]>(selectedMembers);
  const [localShowUnscheduled, setLocalShowUnscheduled] = useState(showUnscheduledOnMap);
  const [localShowWeekends, setLocalShowWeekends] = useState(showWeekendsOnWeek);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (isOpen) {
      setLocalView(currentView);
      setLocalSelectedMembers(selectedMembers);
      setLocalShowUnscheduled(showUnscheduledOnMap);
      setLocalShowWeekends(showWeekendsOnWeek);
      setSearchQuery("");
    }
  }, [isOpen, currentView, selectedMembers, showUnscheduledOnMap, showWeekendsOnWeek]);

  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return teamMembers;
    const query = searchQuery.toLowerCase();
    return teamMembers.filter(m => m.name.toLowerCase().includes(query));
  }, [teamMembers, searchQuery]);

  const displayMembers = useMemo(() => {
    if (isTechnician && currentUserId) {
      return filteredMembers.filter(m => m.id === currentUserId);
    }
    return filteredMembers;
  }, [filteredMembers, isTechnician, currentUserId]);

  const toggleMember = (memberId: string) => {
    setLocalSelectedMembers(prev => 
      prev.includes(memberId)
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    );
  };

  const deselectAll = () => {
    setLocalSelectedMembers([]);
  };

  const handleApply = () => {
    onApply({
      view: localView,
      selectedMembers: localSelectedMembers,
      showUnscheduledOnMap: localShowUnscheduled,
      showWeekendsOnWeek: localShowWeekends
    });
    onClose();
  };

  if (!isOpen) return null;

  const viewOptions: { key: ExtendedViewMode; label: string }[] = [
    { key: 'day', label: 'Day' },
    { key: 'list', label: 'List' },
    { key: 'week', label: 'Week' },
    { key: 'map', label: 'Map' }
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center sm:items-center">
      <div className="bg-white dark:bg-slate-900 w-full max-w-md max-h-[90vh] rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-200 dark:border-slate-700">
          <button
            onClick={onClose}
            className="p-2 -ml-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
          >
            <X className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          </button>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">View Options</h2>
          <div className="w-9" />
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-4">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
              View
            </p>
            <div className="flex rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
              {viewOptions.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setLocalView(key)}
                  className={`flex-1 py-2 px-2 rounded-md text-sm font-medium transition-all ${
                    localView === key
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="px-4 py-4 space-y-4 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-700 dark:text-slate-300">
                Show unscheduled appointments on map view
              </span>
              <Switch
                checked={localShowUnscheduled}
                onCheckedChange={setLocalShowUnscheduled}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-700 dark:text-slate-300">
                Show weekends on week view
              </span>
              <Switch
                checked={localShowWeekends}
                onCheckedChange={setLocalShowWeekends}
              />
            </div>
          </div>

          <div className="px-4 py-4 border-t border-slate-100 dark:border-slate-800">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
              Team Members
            </p>
            
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search team members..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 bg-slate-100 dark:bg-slate-800 border-0 rounded-lg text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-slate-600 dark:text-slate-400">
                {localSelectedMembers.length} selected
              </span>
              {localSelectedMembers.length > 0 && (
                <button
                  onClick={deselectAll}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                >
                  Deselect all
                </button>
              )}
            </div>

            <div className="space-y-1 max-h-60 overflow-y-auto">
              {displayMembers.map((member) => {
                const isSelected = localSelectedMembers.includes(member.id);
                return (
                  <button
                    key={member.id}
                    onClick={() => toggleMember(member.id)}
                    className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {member.profileImageUrl ? (
                        <img
                          src={member.profileImageUrl}
                          alt={member.name}
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-medium">
                          {member.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {member.name}
                      </span>
                    </div>
                    <div className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-all ${
                      isSelected 
                        ? 'bg-blue-600 border-blue-600' 
                        : 'border-slate-300 dark:border-slate-600'
                    }`}>
                      {isSelected && <Check className="h-3 w-3 text-white" />}
                    </div>
                  </button>
                );
              })}
              
              {displayMembers.length === 0 && (
                <div className="py-8 text-center text-sm text-slate-400">
                  No team members found
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 py-4 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={handleApply}
            className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
