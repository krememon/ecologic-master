import { useTranslation } from 'react-i18next';
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Globe } from "lucide-react";

const languages = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
];

interface LanguageSelectorProps {
  variant?: 'dropdown' | 'button';
  showLabel?: boolean;
}

export default function LanguageSelector({ variant = 'dropdown', showLabel = true }: LanguageSelectorProps) {
  const { i18n, t } = useTranslation();

  const currentLanguage = languages.find(lang => lang.code === i18n.language) || languages[0];

  const handleLanguageChange = (languageCode: string) => {
    i18n.changeLanguage(languageCode);
  };

  if (variant === 'button') {
    return (
      <div className="flex items-center gap-2">
        {showLabel && (
          <span className="text-sm text-slate-600 dark:text-slate-400">
            {t('settings.language')}:
          </span>
        )}
        <div className="flex items-center gap-1">
          {languages.map((language) => (
            <Button
              key={language.code}
              size="sm"
              variant={i18n.language === language.code ? 'default' : 'ghost'}
              onClick={() => handleLanguageChange(language.code)}
              className="h-8 px-2"
            >
              <span className="mr-1">{language.flag}</span>
              <span className="text-xs">{language.code.toUpperCase()}</span>
            </Button>
          ))}
        </div>
      </div>
    );
  }

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
            <div className="flex items-center gap-2">
              <span>{currentLanguage.flag}</span>
              <span>{currentLanguage.name}</span>
            </div>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {languages.map((language) => (
            <SelectItem key={language.code} value={language.code}>
              <div className="flex items-center gap-2">
                <span>{language.flag}</span>
                <span>{language.name}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}