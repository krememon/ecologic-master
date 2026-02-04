import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Globe } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { LANGUAGE_STORAGE_KEY } from "@/i18n/config";

const languages = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
];

interface LanguageSelectorProps {
  showLabel?: boolean;
}

export default function LanguageSelector({ showLabel = true }: LanguageSelectorProps) {
  const { i18n, t } = useTranslation();

  const currentLanguage = languages.find(lang => lang.code === i18n.language) || languages[0];

  const handleLanguageChange = async (languageCode: string) => {
    i18n.changeLanguage(languageCode);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, languageCode);
    
    try {
      await apiRequest("PATCH", "/api/users/me/language", { language: languageCode });
    } catch (error) {
      console.error("Failed to persist language preference:", error);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {showLabel && (
        <div className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400">
          <Globe className="h-4 w-4" />
          <span>{t('settings.language')}:</span>
        </div>
      )}
      <Select value={i18n.language} onValueChange={handleLanguageChange}>
        <SelectTrigger className="w-[140px]">
          <SelectValue>
            <span>{currentLanguage.name}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {languages.map((language) => (
            <SelectItem key={language.code} value={language.code}>
              <span>{language.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}