import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Camera, Upload, MapPin, Cloud, Calendar, User, Trash2 } from "lucide-react";
import { format } from "date-fns";

interface JobPhoto {
  id: number;
  jobId: number;
  uploadedBy: string;
  title: string | null;
  description: string | null;
  photoUrl: string;
  location: string | null;
  phase: string | null;
  weather: string | null;
  isPublic: boolean;
  createdAt: string;
}

interface JobPhotoFeedProps {
  jobId: number;
  canUpload?: boolean;
}

const phases = [
  "Site Preparation",
  "Foundation",
  "Framing",
  "Roofing",
  "Electrical",
  "Plumbing",
  "Insulation",
  "Drywall",
  "Flooring",
  "Paint",
  "Final Inspection",
  "Completion"
];

const weatherOptions = [
  "Sunny", "Cloudy", "Rainy", "Snowy", "Windy", "Overcast"
];

export default function JobPhotoFeed({ jobId, canUpload = true }: JobPhotoFeedProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: "",
    description: "",
    phase: "",
    weather: "",
    location: "",
  });

  // Fetch job photos
  const { data: photos = [], isLoading } = useQuery({
    queryKey: [`/api/jobs/${jobId}/photos`],
    enabled: !!jobId,
  });

  // Upload photo mutation
  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch(`/api/jobs/${jobId}/photos`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Upload failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${jobId}/photos`] });
      setIsUploadDialogOpen(false);
      setUploadForm({
        title: "",
        description: "",
        phase: "",
        weather: "",
        location: "",
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      toast({
        title: "Success",
        description: "Photo uploaded successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete photo mutation
  const deleteMutation = useMutation({
    mutationFn: async (photoId: number) => {
      const res = await apiRequest("DELETE", `/api/jobs/photos/${photoId}`);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${jobId}/photos`] });
      toast({
        title: "Success",
        description: "Photo deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleUpload = () => {
    const fileInput = fileInputRef.current;
    if (!fileInput?.files?.[0]) {
      toast({
        title: "No File Selected",
        description: "Please select a photo to upload",
        variant: "destructive",
      });
      return;
    }

    const formData = new FormData();
    formData.append('photo', fileInput.files[0]);
    formData.append('title', uploadForm.title);
    formData.append('description', uploadForm.description);
    formData.append('phase', uploadForm.phase);
    formData.append('weather', uploadForm.weather);
    formData.append('location', uploadForm.location);

    uploadMutation.mutate(formData);
  };

  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Job Site Photos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-pulse text-slate-500">Loading photos...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Job Site Photos ({photos.length})
          </CardTitle>
          {canUpload && (
            <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Photo
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Upload Job Site Photo</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="photo">Photo</Label>
                    <Input
                      id="photo"
                      type="file"
                      accept="image/*"
                      ref={fileInputRef}
                      className="mt-1"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      value={uploadForm.title}
                      onChange={(e) => setUploadForm({...uploadForm, title: e.target.value})}
                      placeholder="Progress update, milestone, etc."
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={uploadForm.description}
                      onChange={(e) => setUploadForm({...uploadForm, description: e.target.value})}
                      placeholder="Describe the progress, issues, or notes..."
                      className="mt-1"
                      rows={3}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="phase">Phase</Label>
                      <Select value={uploadForm.phase} onValueChange={(value) => setUploadForm({...uploadForm, phase: value})}>
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="Select phase" />
                        </SelectTrigger>
                        <SelectContent>
                          {phases.map((phase) => (
                            <SelectItem key={phase} value={phase}>
                              {phase}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="weather">Weather</Label>
                      <Select value={uploadForm.weather} onValueChange={(value) => setUploadForm({...uploadForm, weather: value})}>
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="Weather" />
                        </SelectTrigger>
                        <SelectContent>
                          {weatherOptions.map((weather) => (
                            <SelectItem key={weather} value={weather}>
                              {weather}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="location">Location</Label>
                    <Input
                      id="location"
                      value={uploadForm.location}
                      onChange={(e) => setUploadForm({...uploadForm, location: e.target.value})}
                      placeholder="Building section, room, area..."
                      className="mt-1"
                    />
                  </div>

                  <Button 
                    onClick={handleUpload} 
                    disabled={uploadMutation.isPending}
                    className="w-full"
                  >
                    {uploadMutation.isPending ? "Uploading..." : "Upload Photo"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {photos.length === 0 ? (
          <div className="text-center py-8">
            <Camera className="h-12 w-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-500">No photos uploaded yet</p>
            {canUpload && (
              <p className="text-sm text-slate-400 mt-2">
                Start documenting progress by uploading the first photo
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {photos.map((photo: JobPhoto) => (
              <Card key={photo.id} className="overflow-hidden">
                <div className="relative">
                  <img
                    src={photo.photoUrl}
                    alt={photo.title || "Job site photo"}
                    className="w-full h-64 object-cover"
                  />
                  {canUpload && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="absolute top-2 right-2"
                      onClick={() => deleteMutation.mutate(photo.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="p-4">
                  {photo.title && (
                    <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">
                      {photo.title}
                    </h4>
                  )}
                  {photo.description && (
                    <p className="text-slate-600 dark:text-slate-300 mb-3">
                      {photo.description}
                    </p>
                  )}
                  
                  <div className="flex flex-wrap gap-2 mb-3">
                    {photo.phase && (
                      <Badge variant="secondary" className="text-xs">
                        {photo.phase}
                      </Badge>
                    )}
                    {photo.weather && (
                      <Badge variant="outline" className="text-xs">
                        <Cloud className="h-3 w-3 mr-1" />
                        {photo.weather}
                      </Badge>
                    )}
                    {photo.location && (
                      <Badge variant="outline" className="text-xs">
                        <MapPin className="h-3 w-3 mr-1" />
                        {photo.location}
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(photo.createdAt), 'MMM d, yyyy h:mm a')}
                    </div>
                    <div className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      Uploaded by team
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}