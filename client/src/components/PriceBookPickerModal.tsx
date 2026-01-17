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
import { Search, Plus, Check, Loader2, Package } from "lucide-react";
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

  // When modal opens, initialize selected items from existing line items by priceBookItemId
  useEffect(() => {
    if (open && catalogItems.length > 0) {
      const matchingIds = new Set<number>();
      for (const existingItem of existingItems) {
        // Use priceBookItemId if available (reliable), otherwise skip
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
      
      // Immediately add the newly created item (not toggle-based)
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

  // Toggle selection of a catalog item
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

  // Apply selections on Done
  const handleDone = () => {
    // Find newly selected items (not in initial set)
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
    
    // Find deselected items (were in initial set but no longer selected)
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
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Line Item</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="item-name">Name *</Label>
              <Input
                id="item-name"
                value={newItem.name}
                onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                placeholder="e.g., Standard Inspection"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="item-description">Description</Label>
              <Textarea
                id="item-description"
                value={newItem.description}
                onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                placeholder="Describe this item..."
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="item-price">Price *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400">$</span>
                  <Input
                    id="item-price"
                    type="text"
                    className="pl-7"
                    value={priceDisplay}
                    onChange={(e) => handlePriceChange(e.target.value)}
                    onBlur={handlePriceBlur}
                    onFocus={handlePriceFocus}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="item-unit">Unit</Label>
                <Select
                  value={newItem.unit}
                  onValueChange={(value) => setNewItem({ ...newItem, unit: value })}
                >
                  <SelectTrigger>
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
              <div className="space-y-2">
                <Label htmlFor="item-taskcode">Task Code</Label>
                <Input
                  id="item-taskcode"
                  value={newItem.taskCode}
                  onChange={(e) => setNewItem({ ...newItem, taskCode: e.target.value })}
                  placeholder="e.g., INSP-001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="item-category">Category</Label>
                <Input
                  id="item-category"
                  value={newItem.category}
                  onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                  placeholder="e.g., Inspections"
                />
              </div>
            </div>

            <div className="flex items-center justify-between py-2">
              <Label htmlFor="item-taxable" className="font-normal">Taxable</Label>
              <Switch
                id="item-taxable"
                checked={newItem.taxable}
                onCheckedChange={(checked) => setNewItem({ ...newItem, taxable: checked })}
              />
            </div>
          </div>

          <DialogFooter className="flex-row gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                resetCreateForm();
                setShowCreateForm(false);
              }}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleCreateItem}
              disabled={createMutation.isPending}
              className="flex-1"
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
      <DialogContent className="w-[95vw] max-w-md max-h-[85vh] flex flex-col" preventAutoFocus>
        <DialogHeader>
          <DialogTitle>Add Line Items</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search price book..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6 min-h-0" style={{ maxHeight: 'calc(85vh - 220px)' }}>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : filteredItems.length === 0 && catalogItems.length === 0 ? (
            <div className="text-center py-12">
              <Package className="mx-auto h-12 w-12 text-slate-300 mb-4" />
              <p className="text-slate-500 mb-4">No items in your price book yet</p>
              <Button onClick={() => setShowCreateForm(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create your first item
              </Button>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-500">No items match "{searchQuery}"</p>
            </div>
          ) : (
            <div className="space-y-1 py-2">
              {filteredItems.map((item) => {
                const isSelected = selectedItemIds.has(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => handleToggleSelection(item)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      isSelected 
                        ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800' 
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
                          {item.name}
                        </div>
                        <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2 mt-0.5">
                          <span>{formatCurrency(item.defaultPriceCents)}</span>
                          <span className="text-slate-300 dark:text-slate-600">•</span>
                          <span>per {UNIT_OPTIONS.find(u => u.value === item.unit)?.label.toLowerCase() || item.unit}</span>
                          {item.category && (
                            <>
                              <span className="text-slate-300 dark:text-slate-600">•</span>
                              <span className="truncate">{item.category}</span>
                            </>
                          )}
                        </div>
                      </div>
                      {isSelected && (
                        <div className="flex-shrink-0 mt-1">
                          <Check className="h-5 w-5 text-teal-600" />
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <div className="pt-2 border-t space-y-3">
          <Button
            variant="outline"
            onClick={() => setShowCreateForm(true)}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create new line item
          </Button>
          
          <Button onClick={handleDone} className="w-full">
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
