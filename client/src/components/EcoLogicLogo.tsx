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
        viewBox="0 0 120 150"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        {/* Outer water droplet outline */}
        <path
          d="M60 10C60 10 25 50 25 85C25 110.405 45.595 131 71 131C96.405 131 117 110.405 117 85C117 50 60 10 60 10Z"
          fill="#B8E6FF"
          stroke="#2C5AA0"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Inner water droplet curve */}
        <path
          d="M60 30C60 30 40 65 40 90C40 105.464 52.536 118 68 118C83.464 118 96 105.464 96 90C96 65 60 30 60 30Z"
          fill="none"
          stroke="#2C5AA0"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Green leaf shape */}
        <ellipse
          cx="65"
          cy="75"
          rx="20"
          ry="12"
          fill="#8BC34A"
          stroke="#2C5AA0"
          strokeWidth="5"
          transform="rotate(-10 65 75)"
        />
        
        {/* Leaf vein */}
        <path
          d="M52 70C58 74 72 78 78 82"
          stroke="#2C5AA0"
          strokeWidth="3"
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