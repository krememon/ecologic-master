interface EcoLogicLogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

export default function EcoLogicLogo({ size = 40, showText = true, className = "" }: EcoLogicLogoProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Water Droplet with Leaf SVG Logo */}
      <div 
        style={{ 
          width: size, 
          height: size,
          backgroundImage: 'url(/attached_assets/IMG_6171_1749092157103.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          borderRadius: '8px'
        }}
        className="flex-shrink-0"
      />
      
      {/* EcoLogic Text */}
      {showText && (
        <span 
          className="text-2xl font-bold tracking-wide text-slate-800 dark:text-white"
          style={{ 
            fontFamily: 'system-ui, -apple-system, sans-serif',
            letterSpacing: '0.1em',
            fontWeight: '700'
          }}
        >
          ECOLOGIC
        </span>
      )}
    </div>
  );
}