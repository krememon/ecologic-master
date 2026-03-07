import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, AnimatePresence } from "framer-motion";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import LocationInput from "@/components/LocationInput";
import { ClientSuggestions } from "@/components/ClientSuggestions";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { insertJobSchema, insertClientSchema, insertScheduleItemSchema } from "@shared/schema";
import { formatPhoneInput, getRawPhoneValue } from "@shared/phoneUtils";

// Step 1: Job Details Schema
const step1Schema = insertJobSchema.pick({
  title: true,
  description: true,
  location: true,
  city: true,
  postalCode: true,
  locationLat: true,
  locationLng: true,
  locationPlaceId: true,
  status: true,
  priority: true,
}).refine((data) => data.city || data.postalCode, {
  message: "Either city or ZIP/postal code is required",
  path: ["city"],
});

// Step 2: Client Selection Schema
const step2Schema = z.object({
  clientMode: z.enum(["existing", "new"]),
  clientId: z.number().optional(), // For existing clients
  clientName: z.string().min(1, "Client name is required"),
  newClientEmail: z.string().email().optional().or(z.literal("")),
  newClientPhone: z.string().optional(),
  newClientAddress: z.string().optional(),
  newClientNotes: z.string().optional(),
}).refine((data) => {
  // If existing mode, clientId must be set
  if (data.clientMode === "existing" && !data.clientId) {
    return false;
  }
  return true;
}, {
  message: "Please select a client from the list",
  path: ["clientName"],
});

// Step 3: Schedule Schema
const step3Schema = z.object({
  startDateTime: z.string().min(1, "Start date/time is required"),
  endDateTime: z.string().min(1, "End date/time is required"),
  scheduleLocation: z.string().optional(),
  scheduleNotes: z.string().optional(),
  subcontractorId: z.number().optional().nullable(),
}).refine((data) => {
  if (!data.startDateTime || !data.endDateTime) return true;
  const start = new Date(data.startDateTime);
  const end = new Date(data.endDateTime);
  return end > start;
}, {
  message: "End time must be after start time",
  path: ["endDateTime"],
});

type Step1Data = z.infer<typeof step1Schema>;
type Step2Data = z.infer<typeof step2Schema>;
type Step3Data = z.infer<typeof step3Schema>;

interface JobWizardProps {
  onComplete: (data: {
    job: Step1Data & { clientName: string };
    client: 
      | { mode: "existing"; id: number }
      | { mode: "new"; data: Omit<z.infer<typeof insertClientSchema>, 'companyId'> };
    schedule: {
      startDateTime: string;
      endDateTime: string;
      location?: string;
      notes?: string;
      subcontractorId?: number | null;
    };
  }) => void;
  isLoading: boolean;
}

export function JobWizard({ onComplete, isLoading }: JobWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [step1Data, setStep1Data] = useState<Step1Data | null>(null);
  const [step2Data, setStep2Data] = useState<Step2Data | null>(null);

  // Fetch clients for step 2
  const { data: clients = [] } = useQuery<any[]>({
    queryKey: ['/api/clients'],
  });

  // Fetch subcontractors for step 3
  const { data: subcontractors = [] } = useQuery<any[]>({
    queryKey: ['/api/subcontractors'],
  });

  // Step 1 form
  const step1Form = useForm<Step1Data>({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      title: "",
      description: "",
      location: "",
      city: "",
      postalCode: "",
      locationLat: undefined,
      locationLng: undefined,
      locationPlaceId: "",
      status: "pending",
      priority: "medium",
    },
  });

  // Step 2 form
  const step2Form = useForm<Step2Data>({
    resolver: zodResolver(step2Schema),
    defaultValues: {
      clientMode: "existing",
      clientId: undefined,
      clientName: "",
      newClientEmail: "",
      newClientPhone: "",
      newClientAddress: "",
      newClientNotes: "",
    },
  });

  const clientMode = step2Form.watch("clientMode");

  // Step 3 form
  const step3Form = useForm<Step3Data>({
    resolver: zodResolver(step3Schema),
    defaultValues: {
      startDateTime: "",
      endDateTime: "",
      scheduleLocation: "",
      scheduleNotes: "",
      subcontractorId: null,
    },
  });

  const handleStep1Next = (data: Step1Data) => {
    setStep1Data(data);
    setCurrentStep(2);
  };

  const handleStep2Next = (data: Step2Data) => {
    setStep2Data(data);
    setCurrentStep(3);
  };

  const handleStep3Complete = async (data: Step3Data) => {
    if (!step1Data || !step2Data) return;

    const jobData = {
      ...step1Data,
      clientName: step2Data.clientName,
    };

    // Prepare client data in discriminated union format
    const clientData = step2Data.clientMode === "new" 
      ? {
          mode: "new" as const,
          data: {
            name: step2Data.clientName,
            email: step2Data.newClientEmail || undefined,
            phone: step2Data.newClientPhone || undefined,
            address: step2Data.newClientAddress || undefined,
            notes: step2Data.newClientNotes || undefined,
          }
        }
      : {
          mode: "existing" as const,
          id: step2Data.clientId!,
        };

    // Convert local datetime to UTC before sending to backend
    const { datetimeLocalToUTC } = await import('@/utils/timezone');
    
    const scheduleData = {
      startDateTime: datetimeLocalToUTC(data.startDateTime),
      endDateTime: datetimeLocalToUTC(data.endDateTime),
      location: data.scheduleLocation,
      notes: data.scheduleNotes,
      subcontractorId: data.subcontractorId,
    };

    onComplete({
      job: jobData,
      client: clientData,
      schedule: scheduleData,
    });
  };

  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 300 : -300,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction < 0 ? 300 : -300,
      opacity: 0,
    }),
  };

  const [direction, setDirection] = useState(0);

  const goToStep = (step: number) => {
    setDirection(step > currentStep ? 1 : -1);
    setCurrentStep(step);
  };

  const stepLabels = ["Job Details", "Client", "Schedule"];
  
  return (
    <div className="flex flex-col h-full">
      {/* Fixed Header */}
      <div className="px-5 md:px-6 pt-4 pb-2 border-b bg-background">
        <h1 className="text-center text-xl md:text-2xl font-semibold leading-tight">Create New Job</h1>
        <p className="text-center text-xs md:text-sm text-muted-foreground mt-1">
          {currentStep === 1 && "Enter the job information"}
          {currentStep === 2 && "Choose or create a client"}
          {currentStep === 3 && "Set the schedule"}
        </p>
        
        {/* Stepper */}
        <div className="mx-auto mt-2 w-full max-w-[520px] scale-[0.95] md:scale-100">
          <div className="flex items-center justify-center gap-2">
            {[1, 2, 3].map((step) => (
              <div key={step} className="flex items-center">
                <div 
                  className={`flex items-center justify-center w-8 h-8 md:w-10 md:h-10 rounded-full border-2 transition-all font-medium text-sm md:text-base ${
                    currentStep > step 
                      ? "bg-blue-600 border-blue-600 text-white" 
                      : currentStep === step 
                        ? "border-blue-600 text-blue-600 bg-blue-50 dark:bg-blue-950" 
                        : "border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {currentStep > step ? <Check className="w-4 h-4 md:w-5 md:h-5" /> : step}
                </div>
                {step < 3 && (
                  <div className={`w-12 md:w-16 h-0.5 mx-1 transition-colors ${
                    currentStep > step ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-600"
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Body - NO SCROLL, must fit */}
      <div className="px-5 md:px-6 py-4 flex-1 overflow-hidden">
        <div className="relative h-full">
        <AnimatePresence mode="wait" custom={direction}>
          {currentStep === 1 && (
            <motion.div
              key="step1"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="absolute inset-0"
            >
              <Form {...step1Form}>
                <form onSubmit={step1Form.handleSubmit(handleStep1Next)} className="h-full flex flex-col">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 flex-1">
                    {/* Job Title - full width */}
                    <FormField
                      control={step1Form.control}
                      name="title"
                      render={({ field }) => (
                        <FormItem className="md:col-span-2 min-w-0">
                          <FormLabel className="text-xs font-medium mb-1">Job Title *</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="e.g., Kitchen Renovation" className="w-full h-9 text-sm" data-testid="input-wizard-job-title" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Location - full width */}
                    <FormField
                      control={step1Form.control}
                      name="location"
                      render={({ field }) => (
                        <FormItem className="md:col-span-2 min-w-0">
                          <FormLabel className="text-xs font-medium mb-1">Location *</FormLabel>
                          <FormControl>
                            <LocationInput
                              value={field.value}
                              onChange={(value) => {
                                field.onChange(value);
                              }}
                              onAddressSelected={(addr) => {
                                step1Form.setValue("city", addr.city);
                                step1Form.setValue("postalCode", addr.postalCode);
                                step1Form.setValue("locationPlaceId", addr.place_id);
                                step1Form.setValue("location", addr.formatted_address || addr.street);
                              }}
                              placeholder="Start typing an address..."
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* City + ZIP in one row */}
                    <FormField
                      control={step1Form.control}
                      name="city"
                      render={({ field }) => (
                        <FormItem className="min-w-0">
                          <FormLabel className="text-xs font-medium mb-1">City</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="City" className="w-full h-9 text-sm" data-testid="input-wizard-city" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={step1Form.control}
                      name="postalCode"
                      render={({ field }) => (
                        <FormItem className="min-w-0">
                          <FormLabel className="text-xs font-medium mb-1">ZIP / Postal Code</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="ZIP" className="w-full h-9 text-sm" data-testid="input-wizard-postal-code" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Status + Priority in one row */}
                    <FormField
                      control={step1Form.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem className="min-w-0">
                          <FormLabel className="text-xs font-medium mb-1">Status</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="w-full h-9 text-sm" data-testid="select-wizard-status">
                                <SelectValue placeholder="Select status" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="completed">Completed</SelectItem>
                              <SelectItem value="cancelled">Cancelled</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={step1Form.control}
                      name="priority"
                      render={({ field }) => (
                        <FormItem className="min-w-0">
                          <FormLabel className="text-xs font-medium mb-1">Priority</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="w-full h-9 text-sm" data-testid="select-wizard-priority">
                                <SelectValue placeholder="Select priority" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                              <SelectItem value="urgent">Urgent</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </form>
              </Form>
            </motion.div>
          )}

          {currentStep === 2 && (
            <motion.div
              key="step2"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="absolute inset-0"
            >
              <Form {...step2Form}>
                <form onSubmit={step2Form.handleSubmit(handleStep2Next)} className="space-y-4">
                  <FormField
                    control={step2Form.control}
                    name="clientMode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Client Type</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="flex gap-4"
                          >
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="existing" id="existing" data-testid="radio-client-existing" />
                              <Label htmlFor="existing">Existing Client</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="new" id="new" data-testid="radio-client-new" />
                              <Label htmlFor="new">New Client</Label>
                            </div>
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={step2Form.control}
                    name="clientName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Client Name *</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input {...field} placeholder="Enter client name..." className="w-full" data-testid="input-wizard-client-name" />
                            {clientMode === "existing" && (
                              <ClientSuggestions
                                searchTerm={field.value}
                                onSelect={(client) => {
                                  field.onChange(client.name);
                                  step2Form.setValue("clientId", client.id);
                                }}
                              />
                            )}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {clientMode === "new" && (
                    <>
                      <FormField
                        control={step2Form.control}
                        name="newClientEmail"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input {...field} type="email" placeholder="client@example.com" className="w-full" data-testid="input-wizard-client-email" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={step2Form.control}
                        name="newClientPhone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone</FormLabel>
                            <FormControl>
                              <Input 
                                {...field} 
                                value={field.value || ""}
                                onChange={(e) => field.onChange(formatPhoneInput(e.target.value))}
                                placeholder="555-123-4567" 
                                inputMode="numeric"
                                autoComplete="tel"
                                className="w-full" 
                                data-testid="input-wizard-client-phone" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={step2Form.control}
                        name="newClientAddress"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Address</FormLabel>
                            <FormControl>
                              <Textarea {...field} placeholder="Client address..." className="w-full" data-testid="input-wizard-client-address" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={step2Form.control}
                        name="newClientNotes"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Notes</FormLabel>
                            <FormControl>
                              <Textarea {...field} placeholder="Additional notes..." className="w-full" data-testid="input-wizard-client-notes" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  )}
                </form>
              </Form>
            </motion.div>
          )}

          {currentStep === 3 && (
            <motion.div
              key="step3"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="absolute inset-0"
            >
              <Form {...step3Form}>
                <form onSubmit={step3Form.handleSubmit(handleStep3Complete)} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                    <FormField
                      control={step3Form.control}
                      name="startDateTime"
                      render={({ field }) => (
                        <FormItem className="min-w-0">
                          <FormLabel>Start Date & Time *</FormLabel>
                          <FormControl>
                            <Input {...field} type="datetime-local" className="w-full" data-testid="input-wizard-start-datetime" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={step3Form.control}
                      name="endDateTime"
                      render={({ field }) => (
                        <FormItem className="min-w-0">
                          <FormLabel>End Date & Time *</FormLabel>
                          <FormControl>
                            <Input {...field} type="datetime-local" className="w-full" data-testid="input-wizard-end-datetime" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={step3Form.control}
                    name="scheduleLocation"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Schedule Location</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Optional location details..." className="w-full" data-testid="input-wizard-schedule-location" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={step3Form.control}
                    name="subcontractorId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assign Subcontractor (Optional)</FormLabel>
                        <Select 
                          onValueChange={(value) => field.onChange(value === "none" ? null : parseInt(value))} 
                          defaultValue={field.value?.toString() || "none"}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-wizard-subcontractor">
                              <SelectValue placeholder="Select subcontractor" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="none">No subcontractor</SelectItem>
                            {subcontractors.map((sub: any) => (
                              <SelectItem key={sub.id} value={sub.id.toString()}>
                                {sub.companyName || sub.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={step3Form.control}
                    name="scheduleNotes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes</FormLabel>
                        <FormControl>
                          <Textarea {...field} placeholder="Additional schedule notes..." className="w-full" data-testid="input-wizard-schedule-notes" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </form>
              </Form>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </div>

      {/* Fixed Footer */}
      <div className="px-5 md:px-6 py-3 border-t bg-background">
        <div className="flex flex-col md:flex-row gap-2 justify-end">
          {currentStep > 1 && (
            <Button 
              type="button" 
              variant="outline" 
              size="sm" 
              onClick={() => goToStep(currentStep - 1)}
              data-testid={`button-wizard-step${currentStep}-back`}
            >
              <ChevronLeft className="mr-2 h-3 w-3" /> Back
            </Button>
          )}
          {currentStep < 3 ? (
            <Button 
              type="submit" 
              size="sm"
              onClick={() => {
                if (currentStep === 1) step1Form.handleSubmit(handleStep1Next)();
                if (currentStep === 2) step2Form.handleSubmit(handleStep2Next)();
              }}
              data-testid={`button-wizard-step${currentStep}-next`}
            >
              Next <ChevronRight className="ml-2 h-3 w-3" />
            </Button>
          ) : (
            <Button 
              type="submit" 
              size="sm" 
              disabled={isLoading}
              onClick={() => step3Form.handleSubmit(handleStep3Complete)()}
              data-testid="button-wizard-complete"
            >
              {isLoading ? "Creating..." : "Complete"} <Check className="ml-2 h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
