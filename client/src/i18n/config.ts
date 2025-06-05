import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Translation resources
const resources = {
  en: {
    translation: {
      navigation: {
        home: "Home",
        jobs: "Jobs",
        subcontractors: "Subcontractors",
        clients: "Clients",
        invoicing: "Invoicing",
        documents: "Documents",
        messages: "Messages",
        aiScheduling: "AI Scheduling",
        approvals: "Approvals",
        settings: "Settings"
      },
      dashboard: {
        title: "Dashboard",
        welcome: "Welcome back",
        activeJobs: "Active Jobs",
        outstandingInvoices: "Outstanding Invoices",
        pendingApprovals: "Pending Approvals",
        totalRevenue: "Total Revenue",
        recentActivity: "Recent Activity",
        quickActions: "Quick Actions"
      },
      jobs: {
        title: "Jobs",
        subtitle: "Manage your construction projects and track progress",
        addJob: "Add Job",
        status: {
          pending: "Pending",
          inProgress: "In Progress",
          completed: "Completed",
          cancelled: "Cancelled"
        },
        priority: {
          low: "Low",
          medium: "Medium",
          high: "High"
        },
        fields: {
          title: "Job Title",
          description: "Description",
          location: "Location",
          startDate: "Start Date",
          endDate: "End Date",
          status: "Status",
          priority: "Priority",
          client: "Client"
        }
      },
      settings: {
        title: "Settings",
        subtitle: "Manage your account and application preferences",
        profile: "Profile",
        company: "Company",
        appearance: "Appearance & Language",
        notifications: "Notifications",
        security: "Security",
        language: "Language",
        darkMode: "Dark Mode",
        darkModeDescription: "Switch between light and dark themes",
        languageDescription: "Choose your preferred language for the interface",
        updateProfile: "Update Profile",
        updateCompany: "Update Company",
        changePassword: "Change Password"
      },
      common: {
        save: "Save",
        cancel: "Cancel",
        edit: "Edit",
        delete: "Delete",
        add: "Add",
        update: "Update",
        create: "Create",
        loading: "Loading...",
        error: "Error",
        success: "Success",
        confirm: "Confirm",
        back: "Back",
        next: "Next",
        previous: "Previous",
        search: "Search",
        filter: "Filter",
        sort: "Sort",
        actions: "Actions"
      }
    }
  },
  es: {
    translation: {
      navigation: {
        home: "Inicio",
        jobs: "Trabajos",
        subcontractors: "Subcontratistas",
        clients: "Clientes",
        invoicing: "Facturación",
        documents: "Documentos",
        messages: "Mensajes",
        aiScheduling: "Programación IA",
        approvals: "Aprobaciones",
        settings: "Configuración"
      },
      dashboard: {
        title: "Panel de Control",
        welcome: "Bienvenido de nuevo",
        activeJobs: "Trabajos Activos",
        outstandingInvoices: "Facturas Pendientes",
        pendingApprovals: "Aprobaciones Pendientes",
        totalRevenue: "Ingresos Totales",
        recentActivity: "Actividad Reciente",
        quickActions: "Acciones Rápidas"
      },
      jobs: {
        title: "Trabajos",
        subtitle: "Gestiona tus proyectos de construcción y sigue el progreso",
        addJob: "Agregar Trabajo",
        status: {
          pending: "Pendiente",
          inProgress: "En Progreso",
          completed: "Completado",
          cancelled: "Cancelado"
        },
        priority: {
          low: "Baja",
          medium: "Media",
          high: "Alta"
        },
        fields: {
          title: "Título del Trabajo",
          description: "Descripción",
          location: "Ubicación",
          startDate: "Fecha de Inicio",
          endDate: "Fecha de Finalización",
          status: "Estado",
          priority: "Prioridad",
          client: "Cliente"
        }
      },
      settings: {
        title: "Configuración",
        subtitle: "Gestiona tu cuenta y preferencias de la aplicación",
        profile: "Perfil",
        company: "Empresa",
        appearance: "Apariencia e Idioma",
        notifications: "Notificaciones",
        security: "Seguridad",
        language: "Idioma",
        darkMode: "Modo Oscuro",
        darkModeDescription: "Cambiar entre temas claro y oscuro",
        languageDescription: "Elige tu idioma preferido para la interfaz",
        updateProfile: "Actualizar Perfil",
        updateCompany: "Actualizar Empresa",
        changePassword: "Cambiar Contraseña"
      },
      common: {
        save: "Guardar",
        cancel: "Cancelar",
        edit: "Editar",
        delete: "Eliminar",
        add: "Agregar",
        update: "Actualizar",
        create: "Crear",
        loading: "Cargando...",
        error: "Error",
        success: "Éxito",
        confirm: "Confirmar",
        back: "Atrás",
        next: "Siguiente",
        previous: "Anterior",
        search: "Buscar",
        filter: "Filtrar",
        sort: "Ordenar",
        actions: "Acciones"
      }
    }
  },
  fr: {
    translation: {
      navigation: {
        home: "Accueil",
        jobs: "Travaux",
        subcontractors: "Sous-traitants",
        clients: "Clients",
        invoicing: "Facturation",
        documents: "Documents",
        messages: "Messages",
        aiScheduling: "Planification IA",
        approvals: "Approbations",
        settings: "Paramètres"
      },
      dashboard: {
        title: "Tableau de Bord",
        welcome: "Bon retour",
        activeJobs: "Travaux Actifs",
        outstandingInvoices: "Factures Impayées",
        pendingApprovals: "Approbations en Attente",
        totalRevenue: "Revenus Totaux",
        recentActivity: "Activité Récente",
        quickActions: "Actions Rapides"
      },
      jobs: {
        title: "Travaux",
        subtitle: "Gérez vos projets de construction et suivez les progrès",
        addJob: "Ajouter un Travail",
        status: {
          pending: "En Attente",
          inProgress: "En Cours",
          completed: "Terminé",
          cancelled: "Annulé"
        },
        priority: {
          low: "Faible",
          medium: "Moyenne",
          high: "Élevée"
        },
        fields: {
          title: "Titre du Travail",
          description: "Description",
          location: "Emplacement",
          startDate: "Date de Début",
          endDate: "Date de Fin",
          status: "Statut",
          priority: "Priorité",
          client: "Client"
        }
      },
      settings: {
        title: "Paramètres",
        subtitle: "Gérez votre compte et les préférences de l'application",
        profile: "Profil",
        company: "Entreprise",
        appearance: "Apparence et Langue",
        notifications: "Notifications",
        security: "Sécurité",
        language: "Langue",
        darkMode: "Mode Sombre",
        darkModeDescription: "Basculer entre les thèmes clair et sombre",
        languageDescription: "Choisissez votre langue préférée pour l'interface",
        updateProfile: "Mettre à jour le Profil",
        updateCompany: "Mettre à jour l'Entreprise",
        changePassword: "Changer le Mot de Passe"
      },
      common: {
        save: "Enregistrer",
        cancel: "Annuler",
        edit: "Modifier",
        delete: "Supprimer",
        add: "Ajouter",
        update: "Mettre à jour",
        create: "Créer",
        loading: "Chargement...",
        error: "Erreur",
        success: "Succès",
        confirm: "Confirmer",
        back: "Retour",
        next: "Suivant",
        previous: "Précédent",
        search: "Rechercher",
        filter: "Filtrer",
        sort: "Trier",
        actions: "Actions"
      }
    }
  },
  de: {
    translation: {
      navigation: {
        home: "Startseite",
        jobs: "Aufträge",
        subcontractors: "Subunternehmer",
        clients: "Kunden",
        invoicing: "Rechnungsstellung",
        documents: "Dokumente",
        messages: "Nachrichten",
        aiScheduling: "KI-Planung",
        approvals: "Genehmigungen",
        settings: "Einstellungen"
      },
      dashboard: {
        title: "Dashboard",
        welcome: "Willkommen zurück",
        activeJobs: "Aktive Aufträge",
        outstandingInvoices: "Offene Rechnungen",
        pendingApprovals: "Ausstehende Genehmigungen",
        totalRevenue: "Gesamtumsatz",
        recentActivity: "Letzte Aktivität",
        quickActions: "Schnellaktionen"
      },
      jobs: {
        title: "Aufträge",
        subtitle: "Verwalten Sie Ihre Bauprojekte und verfolgen Sie den Fortschritt",
        addJob: "Auftrag hinzufügen",
        status: {
          pending: "Ausstehend",
          inProgress: "In Bearbeitung",
          completed: "Abgeschlossen",
          cancelled: "Storniert"
        },
        priority: {
          low: "Niedrig",
          medium: "Mittel",
          high: "Hoch"
        },
        fields: {
          title: "Auftragstitel",
          description: "Beschreibung",
          location: "Standort",
          startDate: "Startdatum",
          endDate: "Enddatum",
          status: "Status",
          priority: "Priorität",
          client: "Kunde"
        }
      },
      settings: {
        title: "Einstellungen",
        subtitle: "Verwalten Sie Ihr Konto und Anwendungseinstellungen",
        profile: "Profil",
        company: "Unternehmen",
        appearance: "Aussehen und Sprache",
        notifications: "Benachrichtigungen",
        security: "Sicherheit",
        language: "Sprache",
        darkMode: "Dunkler Modus",
        darkModeDescription: "Zwischen hellen und dunklen Themen wechseln",
        languageDescription: "Wählen Sie Ihre bevorzugte Sprache für die Benutzeroberfläche",
        updateProfile: "Profil aktualisieren",
        updateCompany: "Unternehmen aktualisieren",
        changePassword: "Passwort ändern"
      },
      common: {
        save: "Speichern",
        cancel: "Abbrechen",
        edit: "Bearbeiten",
        delete: "Löschen",
        add: "Hinzufügen",
        update: "Aktualisieren",
        create: "Erstellen",
        loading: "Laden...",
        error: "Fehler",
        success: "Erfolg",
        confirm: "Bestätigen",
        back: "Zurück",
        next: "Weiter",
        previous: "Vorherige",
        search: "Suchen",
        filter: "Filtern",
        sort: "Sortieren",
        actions: "Aktionen"
      }
    }
  },
  it: {
    translation: {
      navigation: {
        home: "Home",
        jobs: "Lavori",
        subcontractors: "Subappaltatori",
        clients: "Clienti",
        invoicing: "Fatturazione",
        documents: "Documenti",
        messages: "Messaggi",
        aiScheduling: "Pianificazione AI",
        approvals: "Approvazioni",
        settings: "Impostazioni"
      },
      dashboard: {
        title: "Dashboard",
        welcome: "Bentornato",
        activeJobs: "Lavori Attivi",
        outstandingInvoices: "Fatture in Sospeso",
        pendingApprovals: "Approvazioni in Attesa",
        totalRevenue: "Ricavi Totali",
        recentActivity: "Attività Recente",
        quickActions: "Azioni Rapide"
      },
      jobs: {
        title: "Lavori",
        subtitle: "Gestisci i tuoi progetti di costruzione e monitora i progressi",
        addJob: "Aggiungi Lavoro",
        status: {
          pending: "In Attesa",
          inProgress: "In Corso",
          completed: "Completato",
          cancelled: "Annullato"
        },
        priority: {
          low: "Bassa",
          medium: "Media",
          high: "Alta"
        },
        fields: {
          title: "Titolo del Lavoro",
          description: "Descrizione",
          location: "Posizione",
          startDate: "Data di Inizio",
          endDate: "Data di Fine",
          status: "Stato",
          priority: "Priorità",
          client: "Cliente"
        }
      },
      settings: {
        title: "Impostazioni",
        subtitle: "Gestisci il tuo account e le preferenze dell'applicazione",
        profile: "Profilo",
        company: "Azienda",
        appearance: "Aspetto e Lingua",
        notifications: "Notifiche",
        security: "Sicurezza",
        language: "Lingua",
        darkMode: "Modalità Scura",
        darkModeDescription: "Passa tra temi chiari e scuri",
        languageDescription: "Scegli la tua lingua preferita per l'interfaccia",
        updateProfile: "Aggiorna Profilo",
        updateCompany: "Aggiorna Azienda",
        changePassword: "Cambia Password"
      },
      common: {
        save: "Salva",
        cancel: "Annulla",
        edit: "Modifica",
        delete: "Elimina",
        add: "Aggiungi",
        update: "Aggiorna",
        create: "Crea",
        loading: "Caricamento...",
        error: "Errore",
        success: "Successo",
        confirm: "Conferma",
        back: "Indietro",
        next: "Avanti",
        previous: "Precedente",
        search: "Cerca",
        filter: "Filtra",
        sort: "Ordina",
        actions: "Azioni"
      }
    }
  },
  pt: {
    translation: {
      navigation: {
        home: "Início",
        jobs: "Trabalhos",
        subcontractors: "Subcontratados",
        clients: "Clientes",
        invoicing: "Faturamento",
        documents: "Documentos",
        messages: "Mensagens",
        aiScheduling: "Agendamento IA",
        approvals: "Aprovações",
        settings: "Configurações"
      },
      dashboard: {
        title: "Painel",
        welcome: "Bem-vindo de volta",
        activeJobs: "Trabalhos Ativos",
        outstandingInvoices: "Faturas Pendentes",
        pendingApprovals: "Aprovações Pendentes",
        totalRevenue: "Receita Total",
        recentActivity: "Atividade Recente",
        quickActions: "Ações Rápidas"
      },
      jobs: {
        title: "Trabalhos",
        subtitle: "Gerencie seus projetos de construção e acompanhe o progresso",
        addJob: "Adicionar Trabalho",
        status: {
          pending: "Pendente",
          inProgress: "Em Andamento",
          completed: "Concluído",
          cancelled: "Cancelado"
        },
        priority: {
          low: "Baixa",
          medium: "Média",
          high: "Alta"
        },
        fields: {
          title: "Título do Trabalho",
          description: "Descrição",
          location: "Localização",
          startDate: "Data de Início",
          endDate: "Data de Fim",
          status: "Status",
          priority: "Prioridade",
          client: "Cliente"
        }
      },
      settings: {
        title: "Configurações",
        subtitle: "Gerencie sua conta e preferências do aplicativo",
        profile: "Perfil",
        company: "Empresa",
        appearance: "Aparência e Idioma",
        notifications: "Notificações",
        security: "Segurança",
        language: "Idioma",
        darkMode: "Modo Escuro",
        darkModeDescription: "Alternar entre temas claro e escuro",
        languageDescription: "Escolha seu idioma preferido para a interface",
        updateProfile: "Atualizar Perfil",
        updateCompany: "Atualizar Empresa",
        changePassword: "Alterar Senha"
      },
      common: {
        save: "Salvar",
        cancel: "Cancelar",
        edit: "Editar",
        delete: "Excluir",
        add: "Adicionar",
        update: "Atualizar",
        create: "Criar",
        loading: "Carregando...",
        error: "Erro",
        success: "Sucesso",
        confirm: "Confirmar",
        back: "Voltar",
        next: "Próximo",
        previous: "Anterior",
        search: "Pesquisar",
        filter: "Filtrar",
        sort: "Classificar",
        actions: "Ações"
      }
    }
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    debug: false,
    
    interpolation: {
      escapeValue: false,
    },
    
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
    },
  });

export default i18n;