import logoImage from "@assets/3251306B-87CB-49B9-8FD2-0285B81BA09A.png";

interface EcoLogicLogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

export default function EcoLogicLogo({
  size = 40,
  showText = true,
  className = "",
}: EcoLogicLogoProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Water Droplet SVG Logo */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        {/* Main water droplet shape */}
        <path
          d="M50 10C50 10 20 45 20 70C20 88.225 34.775 103 53 103C71.225 103 86 88.225 86 70C86 45 50 10 50 10Z"
          fill="#B8E4F0"
          stroke="#2C4A6B"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Inner droplet curve */}
        <path
          d="M50 30C50 30 35 55 35 75C35 87.703 45.297 98 58 98C70.703 98 81 87.703 81 75C81 55 50 30 50 30Z"
          fill="none"
          stroke="#2C4A6B"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Green leaf */}
        <ellipse
          cx="58"
          cy="65"
          rx="18"
          ry="11"
          fill="#8BC34A"
          stroke="#2C4A6B"
          strokeWidth="4"
          transform="rotate(-10 58 65)"
        />
        
        {/* Leaf vein */}
        <path
          d="M47 60C52 63 64 68 69 71"
          stroke="#2C4A6B"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      </svg>

      {/* EcoLogic Text */}
      {showText && (
        <span
          className="text-2xl font-bold tracking-wide text-slate-800 dark:text-white"
          style={{
            fontFamily: "system-ui, -apple-system, sans-serif",
            letterSpacing: "0.1em",
            fontWeight: "700",
          }}
        >
          ECOLOGIC
        </span>
      )}
      
      {/* Water Droplet PNG Image to the right */}
      {showText && (
        <img
          src={logoImage}
          alt="EcoLogic Water Droplet"
          className="w-8 h-8 flex-shrink-0"
        />
      )}
    </div>
  );
}
