interface EcoLogicLogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

export default function EcoLogicLogo({ size = 40, showText = true, className = "" }: EcoLogicLogoProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Water Droplet with Leaf SVG Logo */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        {/* Exact recreation of reference image water droplet */}
        <path
          d="M50 8L49.5 8.5C49.5 8.5 20 40 20 60C20 77.673 34.327 92 52 92C69.673 92 84 77.673 84 60C84 40 50.5 8.5 50 8Z"
          fill="#C8E6F5"
          stroke="#334155"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Inner droplet curve from reference */}
        <path
          d="M50 25C50 25 35 50 35 65C35 75.493 43.507 84 54 84C64.493 84 73 75.493 73 65C73 50 50 25 50 25Z"
          fill="none"
          stroke="#334155"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Green leaf matching reference position and shape */}
        <path
          d="M40 45C40 45 45 42 55 44C65 46 70 55 68 62C66 69 58 72 50 70C42 68 38 58 40 45Z"
          fill="#8FBC8F"
          stroke="#334155"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Leaf vein exactly as shown in reference */}
        <path
          d="M44 50C48 53 56 58 62 62"
          stroke="#334155"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      
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