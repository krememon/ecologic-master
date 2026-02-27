import { Capacitor } from "@capacitor/core";

export interface CopyResult {
  ok: boolean;
  method: "capacitor" | "navigator" | "textarea" | "none";
  error?: string;
}

export async function copyText(text: string): Promise<boolean> {
  const result = await copyTextWithDetails(text);
  return result.ok;
}

export async function copyTextWithDetails(text: string): Promise<CopyResult> {
  const isNative = Capacitor.isNativePlatform();
  const isDev = import.meta.env.DEV;

  if (isDev) {
    console.log("[clipboard] platform:", Capacitor.getPlatform(), "isNative:", isNative);
  }

  if (isNative) {
    try {
      const { Clipboard } = await import("@capacitor/clipboard");
      await Clipboard.write({ string: text });
      if (isDev) console.log("[clipboard] success via capacitor");
      return { ok: true, method: "capacitor" };
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      if (isDev) console.error("[clipboard] capacitor failed:", errMsg);

      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          if (isDev) console.log("[clipboard] native fallback to navigator.clipboard succeeded");
          return { ok: true, method: "navigator" };
        }
      } catch (navErr: any) {
        if (isDev) console.error("[clipboard] navigator fallback also failed:", navErr?.message);
      }

      return { ok: false, method: "none", error: errMsg };
    }
  }

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      if (isDev) console.log("[clipboard] success via navigator.clipboard");
      return { ok: true, method: "navigator" };
    } catch (err: any) {
      if (isDev) console.error("[clipboard] navigator.clipboard failed:", err?.message);
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const result = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (isDev) console.log("[clipboard] textarea/execCommand result:", result);
    return { ok: result, method: "textarea" };
  } catch (err: any) {
    if (isDev) console.error("[clipboard] textarea fallback failed:", err?.message);
    return { ok: false, method: "none", error: err?.message };
  }
}
