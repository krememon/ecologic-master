import { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Loader2 } from "lucide-react";

interface ImageCropModalProps {
  open: boolean;
  onClose: () => void;
  file: File | null;
  mode: "logo" | "banner";
  onCropped: (file: File) => Promise<void>;
}

const CROP_CONFIG = {
  logo: {
    aspect: 3 / 1,
    outputWidth: 600,
    outputHeight: 200,
  },
  banner: {
    aspect: 4 / 1,
    outputWidth: 1200,
    outputHeight: 300,
  },
};

async function createCroppedImage(
  imageSrc: string,
  pixelCrop: Area,
  outputWidth: number,
  outputHeight: number
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
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  const config = CROP_CONFIG[mode];

  const onCropComplete = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleFileChange = useCallback(() => {
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setImageSrc(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, [file]);

  if (file && !imageSrc) {
    handleFileChange();
  }

  const handleSave = async () => {
    if (!imageSrc || !croppedAreaPixels) return;

    setIsProcessing(true);
    try {
      const croppedBlob = await createCroppedImage(
        imageSrc,
        croppedAreaPixels,
        config.outputWidth,
        config.outputHeight
      );

      const fileName = mode === "logo" ? "logo-cropped.png" : "banner-cropped.png";
      const croppedFile = new File([croppedBlob], fileName, { type: "image/png" });

      await onCropped(croppedFile);
      handleClose();
    } catch (error) {
      console.error("Crop failed:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setImageSrc(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-lg max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>Edit Image</DialogTitle>
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
                onCropChange={setCrop}
                onCropComplete={onCropComplete}
                onZoomChange={setZoom}
                showGrid={true}
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
            Drag to reposition, use slider to zoom
          </p>

          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={handleClose} disabled={isProcessing}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isProcessing || !croppedAreaPixels}>
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
