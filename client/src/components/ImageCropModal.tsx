import { useState, useCallback, useEffect } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ImageCropModalProps {
  open: boolean;
  onClose: () => void;
  file: File | null;
  mode: "logo" | "banner" | "avatar";
  onCropped: (file: File) => Promise<void>;
}

const CROP_CONFIG = {
  logo: {
    aspect: 1,
    outputSize: 512,
    cropShape: "round" as const,
    showGrid: false,
  },
  avatar: {
    aspect: 1,
    outputSize: 512,
    cropShape: "round" as const,
    showGrid: false,
  },
  banner: {
    aspect: 4 / 1,
    outputWidth: 1200,
    outputHeight: 300,
    cropShape: "rect" as const,
    showGrid: true,
  },
};

async function createCroppedImage(
  imageSrc: string,
  pixelCrop: Area,
  outputWidth: number,
  outputHeight: number,
  circular: boolean
): Promise<Blob> {
  const image = new Image();
  image.src = imageSrc;
  await new Promise((resolve) => {
    image.onload = resolve;
  });

  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Could not get canvas context");
  }

  if (circular) {
    ctx.beginPath();
    ctx.arc(outputWidth / 2, outputHeight / 2, outputWidth / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
  }

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outputWidth,
    outputHeight
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Canvas toBlob failed"));
        }
      },
      "image/png",
      1
    );
  });
}

export default function ImageCropModal({
  open,
  onClose,
  file,
  mode,
  onCropped,
}: ImageCropModalProps) {
  const { toast } = useToast();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  const config = CROP_CONFIG[mode];
  const isRound = mode === "logo" || mode === "avatar";

  const onCropComplete = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  useEffect(() => {
    if (file && open) {
      const reader = new FileReader();
      reader.onload = () => {
        setImageSrc(reader.result as string);
      };
      reader.onerror = () => {
        toast({ title: "Error", description: "Could not read image file", variant: "destructive" });
      };
      reader.readAsDataURL(file);
    }
  }, [file, open, toast]);

  useEffect(() => {
    if (!open) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
      setImageSrc(null);
    }
  }, [open]);

  const handleSave = async () => {
    if (!imageSrc || !croppedAreaPixels) return;

    setIsProcessing(true);
    try {
      const outputWidth = isRound
        ? (CROP_CONFIG[mode] as typeof CROP_CONFIG.logo).outputSize
        : CROP_CONFIG.banner.outputWidth;
      const outputHeight = isRound
        ? (CROP_CONFIG[mode] as typeof CROP_CONFIG.logo).outputSize
        : CROP_CONFIG.banner.outputHeight;
      
      const croppedBlob = await createCroppedImage(
        imageSrc,
        croppedAreaPixels,
        outputWidth,
        outputHeight,
        isRound
      );

      const fileName = mode === "avatar" ? "avatar-cropped.png" : mode === "logo" ? "logo-cropped.png" : "banner-cropped.png";
      const croppedFile = new File([croppedBlob], fileName, { type: "image/png" });

      await onCropped(croppedFile);
      onClose();
    } catch (error) {
      console.error("Crop failed:", error);
      toast({ title: "Error", description: "Could not crop image", variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>
            {mode === "avatar" ? "Edit Profile Photo" : mode === "logo" ? "Edit Logo" : "Edit Banner"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div
            className="relative bg-black/90 rounded-lg overflow-hidden"
            style={{ height: "300px" }}
          >
            {imageSrc && (
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={config.aspect}
                cropShape={config.cropShape}
                showGrid={config.showGrid}
                onCropChange={setCrop}
                onCropComplete={onCropComplete}
                onZoomChange={setZoom}
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Zoom</label>
            <Slider
              value={[zoom]}
              min={1}
              max={3}
              step={0.1}
              onValueChange={(value) => setZoom(value[0])}
              className="w-full"
            />
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Drag to reposition. Use slider to zoom.
          </p>

          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={onClose} disabled={isProcessing}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isProcessing || !croppedAreaPixels}>
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                mode === "avatar" ? "Save Photo" : mode === "logo" ? "Save Logo" : "Save Banner"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
