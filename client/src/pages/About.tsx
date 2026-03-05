import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useState, useEffect } from "react";
import { isNativePlatform, getPlatform } from "@/lib/capacitor";

function getDeviceInfo(): string {
  const ua = navigator.userAgent;
  const platform = getPlatform();

  if (isNativePlatform()) {
    if (platform === "ios") {
      const match = ua.match(/iPhone OS (\d+[_\.]\d+)/);
      const ver = match ? match[1].replace("_", ".") : "";
      return ver ? `Apple iPhone (iOS ${ver})` : "Apple iPhone (iOS)";
    }
    if (platform === "android") {
      const match = ua.match(/Android (\d+[\.\d]*)/);
      const ver = match ? match[1] : "";
      return ver ? `Android (${ver})` : "Android";
    }
  }

  if (/iPad|Macintosh.*Mobile/.test(ua)) {
    const match = ua.match(/OS (\d+[_\.]\d+)/);
    const ver = match ? match[1].replace("_", ".") : "";
    return ver ? `Apple iPad (iPadOS ${ver})` : "Apple iPad";
  }
  if (/iPhone/.test(ua)) {
    const match = ua.match(/iPhone OS (\d+[_\.]\d+)/);
    const ver = match ? match[1].replace("_", ".") : "";
    return ver ? `Apple iPhone (iOS ${ver})` : "Apple iPhone";
  }
  if (/Android/.test(ua)) {
    const match = ua.match(/Android (\d+[\.\d]*)/);
    const ver = match ? match[1] : "";
    return ver ? `Android (${ver})` : "Android";
  }
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";

  return "Web Browser";
}

function getTimezoneInfo(): { timezone: string; dateTime: string } {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Unknown";
    const dateTime = new Date().toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return { timezone: tz, dateTime };
  } catch {
    return { timezone: "Unknown", dateTime: new Date().toLocaleString() };
  }
}

export default function About() {
  const { user } = useAuth();
  const [timeInfo, setTimeInfo] = useState(getTimezoneInfo);

  useEffect(() => {
    const interval = setInterval(() => setTimeInfo(getTimezoneInfo()), 30000);
    return () => clearInterval(interval);
  }, []);

  const device = getDeviceInfo();
  const appVersion = "1.0.0";

  const fields = [
    { label: "App Version", value: appVersion },
    { label: "Email Address", value: user?.email || "—" },
    { label: "Timezone", value: timeInfo.timezone },
    { label: "Local Time", value: timeInfo.dateTime },
    { label: "Device", value: device },
  ];

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <div className="mb-6">
        <Link href="/settings">
          <button className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors mb-3">
            <ChevronLeft className="h-4 w-4" />
            Settings
          </button>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">About</h1>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">EcoLogic Information</p>
        </div>
        {fields.map((field, index) => (
          <div
            key={field.label}
            className={`flex items-center justify-between px-4 py-3.5 ${
              index !== fields.length - 1 ? "border-b border-slate-100 dark:border-slate-700/50" : ""
            }`}
          >
            <span className="text-sm text-slate-500 dark:text-slate-400">{field.label}</span>
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100 text-right max-w-[60%] truncate">{field.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
