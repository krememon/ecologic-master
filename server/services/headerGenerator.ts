import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const HEADER_WIDTH = 600;
const BANNER_HEIGHT = 170;
const STRIP_HEIGHT = 90;
const TOTAL_HEIGHT_WITH_BANNER = BANNER_HEIGHT + STRIP_HEIGHT;
const LOGO_SIZE = 88;
const LOGO_RING_PADDING = 12; // 112px total ring diameter per spec
const LOGO_TOTAL_SIZE = LOGO_SIZE + (LOGO_RING_PADDING * 2);
const STRIP_ONLY_HEIGHT = Math.max(STRIP_HEIGHT, LOGO_TOTAL_SIZE + 10);

interface GenerateHeaderOptions {
  companyId: number;
  bannerPath?: string | null;
  logoPath?: string | null;
  brandColor: string;
  backgroundType: 'color' | 'image';
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    };
  }
  return { r: 37, g: 99, b: 235 };
}

function getLocalFilePath(urlOrPath: string | null | undefined): string | null {
  if (!urlOrPath) return null;
  
  let filename = urlOrPath;
  
  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
    try {
      const url = new URL(urlOrPath);
      filename = url.pathname;
    } catch {
      return null;
    }
  }
  
  if (filename.startsWith('/public/uploads/')) {
    filename = filename.replace('/public/uploads/', '');
  } else if (filename.startsWith('/uploads/')) {
    filename = filename.replace('/uploads/', '');
  }
  
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return null;
  }
  
  const filePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`[HeaderGen] File not found: ${filePath}`);
    return null;
  }
  
  return filePath;
}

function generateCacheHash(bannerFile: string | null, logoFile: string | null, brandColor: string): string {
  // Use resolved file paths and file mtimes for accurate cache invalidation
  const bannerMtime = bannerFile && fs.existsSync(bannerFile) 
    ? fs.statSync(bannerFile).mtimeMs.toString() 
    : 'none';
  const logoMtime = logoFile && fs.existsSync(logoFile)
    ? fs.statSync(logoFile).mtimeMs.toString()
    : 'none';
    
  const data = JSON.stringify({
    banner: bannerFile ? path.basename(bannerFile) : null,
    bannerMtime,
    logo: logoFile ? path.basename(logoFile) : null,
    logoMtime,
    color: brandColor,
  });
  return crypto.createHash('md5').update(data).digest('hex').substring(0, 12);
}

export async function generateCombinedHeader(options: GenerateHeaderOptions): Promise<string | null> {
  const { companyId, bannerPath, logoPath, brandColor, backgroundType } = options;
  
  const bannerFile = backgroundType === 'image' ? getLocalFilePath(bannerPath) : null;
  const logoFile = getLocalFilePath(logoPath);
  
  if (!logoFile && !bannerFile) {
    console.log('[HeaderGen] No logo or banner available, skipping combined header');
    return null;
  }
  
  const hash = generateCacheHash(bannerFile, logoFile, brandColor);
  const outputFilename = `combined_header_${companyId}_${hash}.png`;
  const outputPath = path.join(UPLOADS_DIR, outputFilename);
  
  if (fs.existsSync(outputPath)) {
    console.log('[HeaderGen] Using cached combined header:', outputFilename);
    return `/uploads/${outputFilename}`;
  }
  
  try {
    const rgb = hexToRgb(brandColor);
    const layers: sharp.OverlayOptions[] = [];
    
    let baseImage: sharp.Sharp;
    
    let totalHeight: number;
    
    if (bannerFile) {
      totalHeight = TOTAL_HEIGHT_WITH_BANNER;
      
      const bannerBuffer = await sharp(bannerFile)
        .resize(HEADER_WIDTH, BANNER_HEIGHT, { fit: 'cover', position: 'center' })
        .toBuffer();
      
      const stripBuffer = await sharp({
        create: {
          width: HEADER_WIDTH,
          height: STRIP_HEIGHT,
          channels: 4,
          background: { r: rgb.r, g: rgb.g, b: rgb.b, alpha: 1 },
        },
      }).png().toBuffer();
      
      baseImage = sharp({
        create: {
          width: HEADER_WIDTH,
          height: totalHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      });
      
      layers.push({ input: bannerBuffer, top: 0, left: 0 });
      layers.push({ input: stripBuffer, top: BANNER_HEIGHT, left: 0 });
    } else {
      // No banner - use taller strip to accommodate logo
      totalHeight = STRIP_ONLY_HEIGHT;
      
      baseImage = sharp({
        create: {
          width: HEADER_WIDTH,
          height: totalHeight,
          channels: 4,
          background: { r: rgb.r, g: rgb.g, b: rgb.b, alpha: 1 },
        },
      });
    }
    
    if (logoFile) {
      const logoBuffer = await sharp(logoFile)
        .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'cover' })
        .toBuffer();
      
      const circularLogo = await sharp(logoBuffer)
        .composite([{
          input: Buffer.from(
            `<svg width="${LOGO_SIZE}" height="${LOGO_SIZE}">
              <circle cx="${LOGO_SIZE/2}" cy="${LOGO_SIZE/2}" r="${LOGO_SIZE/2}" fill="white"/>
            </svg>`
          ),
          blend: 'dest-in',
        }])
        .toBuffer();
      
      const whiteRingSize = LOGO_TOTAL_SIZE;
      const whiteRing = await sharp({
        create: {
          width: whiteRingSize,
          height: whiteRingSize,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      })
        .composite([{
          input: Buffer.from(
            `<svg width="${whiteRingSize}" height="${whiteRingSize}">
              <circle cx="${whiteRingSize/2}" cy="${whiteRingSize/2}" r="${whiteRingSize/2}" fill="white"/>
            </svg>`
          ),
          blend: 'dest-in',
        }])
        .toBuffer();
      
      const logoWithRing = await sharp(whiteRing)
        .composite([{
          input: circularLogo,
          top: LOGO_RING_PADDING,
          left: LOGO_RING_PADDING,
        }])
        .toBuffer();
      
      const logoLeft = Math.round((HEADER_WIDTH - whiteRingSize) / 2);
      let logoTop: number;
      
      if (bannerFile) {
        // Position logo centered on the seam between banner and strip
        logoTop = BANNER_HEIGHT - Math.round(whiteRingSize / 2);
      } else {
        // Position logo centered vertically in the taller strip
        logoTop = Math.round((totalHeight - whiteRingSize) / 2);
      }
      
      layers.push({ input: logoWithRing, top: Math.max(0, logoTop), left: logoLeft });
    }
    
    const result = await baseImage.composite(layers).png().toBuffer();
    
    fs.writeFileSync(outputPath, result);
    console.log('[HeaderGen] Generated combined header:', outputFilename);
    
    return `/uploads/${outputFilename}`;
  } catch (error: any) {
    console.error('[HeaderGen] Failed to generate combined header:', error.message);
    return null;
  }
}

export async function invalidateCombinedHeader(companyId: number): Promise<void> {
  const pattern = `combined_header_${companyId}_`;
  
  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    for (const file of files) {
      if (file.startsWith(pattern)) {
        fs.unlinkSync(path.join(UPLOADS_DIR, file));
        console.log('[HeaderGen] Deleted cached header:', file);
      }
    }
  } catch (error: any) {
    console.warn('[HeaderGen] Failed to invalidate cache:', error.message);
  }
}
