import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Plus, Check, Loader2, Package, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ServiceCatalogItem } from "@shared/schema";

interface LineItem {
  name: string;
  description: string;
  taskCode: string;
  quantity: string;
  unitPriceCents: number;
  priceDisplay: string;
  unit: string;
  taxable: boolean;
  taxId: number | null;
  taxRatePercentSnapshot: string | null;
  taxNameSnapshot: string | null;
  saveToPriceBook: boolean;
  priceBookItemId?: number | null;
}

interface PriceBookPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddItem: (item: LineItem) => void;
  onRemoveItemByPriceBookId?: (priceBookItemId: number) => void;
  existingItems: LineItem[];
}

const UNIT_OPTIONS = [
  { value: "each", label: "Each" },
  { value: "hour", label: "Hour" },
  { value: "ft", label: "Foot" },
  { value: "sq_ft", label: "Sq Ft" },
  { value: "job", label: "Job" },
  { value: "day", label: "Day" },
];

export function PriceBookPickerModal({ 
  open, 
  onOpenChange, 
  onAddItem,
  onRemoveItemByPriceBookId,
  existingItems 
}: PriceBookPickerModalProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(new Set());
  const [initialSelectedIds, setInitialSelectedIds] = useState<Set<number>>(new Set());
  const [priceDisplay, setPriceDisplay] = useState("");
  const [newItem, setNewItem] = useState({
    name: "",
    description: "",
    taskCode: "",
    defaultPriceCents: 0,
    unit: "each",
    category: "",
    taxable: false,
  });

  const { data: catalogItems = [], isLoading } = useQuery<ServiceCatalogItem[]>({
    queryKey: ['/api/service-catalog'],
    enabled: open,
  });

  useEffect(() => {
    if (open && catalogItems.length > 0) {
      const matchingIds = new Set<number>();
      for (const existingItem of existingItems) {
        if (existingItem.priceBookItemId) {
          matchingIds.add(existingItem.priceBookItemId);
        }
      }
      setSelectedItemIds(matchingIds);
      setInitialSelectedIds(matchingIds);
    }
  }, [open, catalogItems, existingItems]);

  const createMutation = useMutation({
    mutationFn: async (data: typeof newItem) => {
      const res = await apiRequest('POST', '/api/service-catalog', data);
      return res.json();
    },
    onSuccess: (createdItem: ServiceCatalogItem) => {
      queryClient.invalidateQueries({ queryKey: ['/api/service-catalog'] });
      
      const lineItem: LineItem = {
        name: createdItem.name,
        description: createdItem.description || "",
        taskCode: createdItem.taskCode || "",
        quantity: "1",
        unitPriceCents: createdItem.defaultPriceCents,
        priceDisplay: (createdItem.defaultPriceCents / 100).toFixed(2),
        unit: createdItem.unit,
        taxable: createdItem.taxable,
        taxId: null,
        taxRatePercentSnapshot: null,
        taxNameSnapshot: null,
        saveToPriceBook: false,
        priceBookItemId: createdItem.id,
      };
      onAddItem(lineItem);
      setSelectedItemIds(prev => new Set(prev).add(createdItem.id));
      setInitialSelectedIds(prev => new Set(prev).add(createdItem.id));
      
      resetCreateForm();
      setShowCreateForm(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create item", variant: "destructive" });
    },
  });

  const resetCreateForm = () => {
    setNewItem({
      name: "",
      description: "",
      taskCode: "",
      defaultPriceCents: 0,
      unit: "each",
      category: "",
      taxable: false,
    });
    setPriceDisplay("");
  };

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setShowCreateForm(false);
      setSelectedItemIds(new Set());
      setInitialSelectedIds(new Set());
      resetCreateForm();
    }
  }, [open]);

  const handleToggleSelection = (item: ServiceCatalogItem) => {
    setSelectedItemIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(item.id)) {
        newSet.delete(item.id);
      } else {
        newSet.add(item.id);
      }
      return newSet;
    });
  };

  const handleDone = () => {
    for (const itemId of selectedItemIds) {
      if (!initialSelectedIds.has(itemId)) {
        const catalogItem = catalogItems.find(c => c.id === itemId);
        if (catalogItem) {
          const lineItem: LineItem = {
            name: catalogItem.name,
            description: catalogItem.description || "",
            taskCode: catalogItem.taskCode || "",
            quantity: "1",
            unitPriceCents: catalogItem.defaultPriceCents,
            priceDisplay: (catalogItem.defaultPriceCents / 100).toFixed(2),
            unit: catalogItem.unit,
            taxable: catalogItem.taxable,
            taxId: null,
            taxRatePercentSnapshot: null,
            taxNameSnapshot: null,
            saveToPriceBook: false,
            priceBookItemId: catalogItem.id,
          };
          onAddItem(lineItem);
        }
      }
    }
    
    if (onRemoveItemByPriceBookId) {
      for (const itemId of initialSelectedIds) {
        if (!selectedItemIds.has(itemId)) {
          onRemoveItemByPriceBookId(itemId);
        }
      }
    }
    
    onOpenChange(false);
  };

  const handleCreateItem = () => {
    if (!newItem.name.trim()) {
      toast({ title: "Error", description: "Name is required", variant: "destructive" });
      return;
    }
    createMutation.mutate(newItem);
  };

  const handlePriceChange = (value: string) => {
    const cleanValue = value.replace(/[^0-9.]/g, '');
    const parts = cleanValue.split('.');
    const sanitized = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : cleanValue;
    setPriceDisplay(sanitized);
    const dollars = parseFloat(sanitized) || 0;
    setNewItem({ ...newItem, defaultPriceCents: Math.round(dollars * 100) });
  };

  const handlePriceBlur = () => {
    const dollars = newItem.defaultPriceCents / 100;
    setPriceDisplay(dollars.toFixed(2));
  };

  const handlePriceFocus = () => {
    const dollars = newItem.defaultPriceCents / 100;
    setPriceDisplay(dollars === 0 ? "" : String(dollars));
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  const filteredItems = catalogItems.filter(item =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (item.category && item.category.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (showCreateForm) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden" hideCloseButton>
          <div className="flex items-center justify-center h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <DialogHeader className="p-0">
              <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">Create New Line Item</DialogTitle>
            </DialogHeader>
          </div>

          <div className="space-y-3 px-4 py-3">
            <div className="space-y-1">
              <Label htmlFor="item-name">Name *</Label>
              <Input
                id="item-name"
                value={newItem.name}
                onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                placeholder="Name"
                className="h-9"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="item-description">Description</Label>
              <Textarea
                id="item-description"
                value={newItem.description}
                onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                placeholder="Description"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="item-price">Price *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400">$</span>
                  <Input
                    id="item-price"
                    type="text"
                    className="pl-7 h-9"
                    value={priceDisplay}
                    onChange={(e) => handlePriceChange(e.target.value)}
                    onBlur={handlePriceBlur}
                    onFocus={handlePriceFocus}
                    placeholder="Price"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="item-unit">Unit</Label>
                <Select
                  value={newItem.unit}
                  onValueChange={(value) => setNewItem({ ...newItem, unit: value })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="item-taskcode">Task Code</Label>
                <Input
                  id="item-taskcode"
                  value={newItem.taskCode}
                  onChange={(e) => setNewItem({ ...newItem, taskCode: e.target.value })}
                  placeholder="Task Code"
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="item-category">Category</Label>
                <Input
                  id="item-category"
                  value={newItem.category}
                  onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                  placeholder="Category"
                  className="h-9"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="flex-row gap-2 px-4 py-3 border-t border-slate-100 dark:border-slate-800">
            <Button 
              variant="outline" 
              onClick={() => {
                resetCreateForm();
                setShowCreateForm(false);
              }}
              className="flex-1 h-10 rounded-xl"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleCreateItem}
              disabled={createMutation.isPending}
              className="flex-1 h-10 rounded-xl"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Save & Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-md p-0 gap-0 max-h-[85vh] flex flex-col rounded-2xl overflow-hidden" hideCloseButton preventAutoFocus>
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="min-w-[44px]" />
          <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Add Line Items
          </DialogTitle>
          <button 
            onClick={() => onOpenChange(false)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-4 py-3 bg-white dark:bg-slate-900">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search price book..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-10 bg-slate-100 dark:bg-slate-800 border-0 rounded-xl text-sm placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-0"
            />
          </div>
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800" />

        <ScrollArea className="flex-1 min-h-0">
          <div className="bg-white dark:bg-slate-900">
            <button
              className="w-full flex items-center gap-3 px-4 min-h-[56px] text-left hover:bg-blue-50 dark:hover:bg-blue-950/30 active:bg-blue-100 dark:active:bg-blue-950/50 transition-colors"
              onClick={() => setShowCreateForm(true)}
            >
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm">
                <Plus className="h-5 w-5 text-white" />
              </div>
              <span className="font-semibold text-blue-600 dark:text-blue-400">Create New Line Item</span>
            </button>

            {(filteredItems.length > 0 || isLoading) && (
              <div className="h-px bg-slate-100 dark:bg-slate-800 mx-4" />
            )}

            {isLoading ? (
              <div className="py-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                      <div className="h-3 w-24 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredItems.length === 0 && catalogItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4">
                <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                  <Package className="h-7 w-7 text-slate-400" />
                </div>
                <p className="font-medium text-slate-600 dark:text-slate-400 text-center">
                  No items in your price book yet
                </p>
                <p className="text-sm text-slate-400 mt-1">Create your first item above</p>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4">
                <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                  <Search className="h-7 w-7 text-slate-400" />
                </div>
                <p className="font-medium text-slate-600 dark:text-slate-400 text-center">
                  No items match "{searchQuery}"
                </p>
                <p className="text-sm text-slate-400 mt-1">Try a different search term</p>
              </div>
            ) : (
              <div className="py-1">
                {filteredItems.map((item, index) => {
                  const isSelected = selectedItemIds.has(item.id);
                  return (
                    <div key={item.id}>
                      <button
                        onClick={() => handleToggleSelection(item)}
                        className={`w-full flex items-center justify-between px-4 min-h-[56px] text-left transition-colors ${
                          isSelected 
                            ? 'bg-teal-50 dark:bg-teal-900/20' 
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {item.name}
                          </p>
                          <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
                            {formatCurrency(item.defaultPriceCents)} per {UNIT_OPTIONS.find(u => u.value === item.unit)?.label.toLowerCase() || item.unit}
                            {item.category && ` · ${item.category}`}
                          </p>
                        </div>
                        {isSelected && (
                          <Check className="h-5 w-5 text-teal-500 flex-shrink-0 ml-3" />
                        )}
                      </button>
                      {index < filteredItems.length - 1 && (
                        <div className="h-px bg-slate-100 dark:bg-slate-800 mx-4" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
          <Button onClick={handleDone} className="w-full h-12 rounded-xl font-semibold">
            Done {selectedItemIds.size > 0 && `(${selectedItemIds.size})`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
