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
        schedule: "Schedule",
        approvals: "Approvals",
        settings: "Settings"
      },
      dashboard: {
        title: "Dashboard",
        welcome: "Welcome back",
        activeJobs: "Active Jobs",
        completedJobs: "Completed Jobs",
        outstandingInvoices: "Outstanding Invoices",
        pendingApprovals: "Pending Approvals", 
        totalRevenue: "Total Revenue",
        recentActivity: "Recent Activity",
        quickActions: "Quick Actions",
        recentAlerts: "Recent Alerts",
        analytics: "Analytics",
        availableSubcontractors: "Available Subcontractors",
        overdueInvoices: "Overdue Invoices",
        jobCompletionRate: "Job Completion Rate",
        averageProjectValue: "Average Project Value",
        monthlyRevenue: "Monthly Revenue",
        clientSatisfaction: "Client Satisfaction",
        noRecentActivity: "No recent activity",
        viewAll: "View All"
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
      clients: {
        title: "Clients",
        subtitle: "Manage your client relationships and contact information",
        addClient: "Add New Client",
        editClient: "Edit Client", 
        deleteClient: "Delete Client",
        deleteConfirm: "Are you sure you want to delete this client? This action cannot be undone.",
        noClients: "No clients yet",
        noClientsDescription: "Start building your client base by adding your first client.",
        addFirstClient: "Add Your First Client",
        fields: {
          name: "Company Name",
          contactPerson: "Contact Person",
          email: "Email Address",
          phone: "Phone Number",
          address: "Address",
          notes: "Notes"
        },
        created: "Added",
        contactInfo: "Contact Information"
      },
      subcontractors: {
        title: "Subcontractors",
        subtitle: "Manage your network of skilled subcontractors",
        addSubcontractor: "Add New Subcontractor",
        editSubcontractor: "Edit Subcontractor",
        deleteSubcontractor: "Delete Subcontractor", 
        deleteConfirm: "Are you sure you want to delete this subcontractor? This action cannot be undone.",
        noSubcontractors: "No subcontractors yet",
        noSubcontractorsDescription: "Build your network by adding trusted subcontractors.",
        addFirstSubcontractor: "Add Your First Subcontractor",
        fields: {
          name: "Name",
          email: "Email",
          phone: "Phone",
          skills: "Skills & Notes",
          availability: "Availability Status"
        },
        availability: {
          available: "Available",
          busy: "Busy"
        },
        rating: "rating",
        skillsPlaceholder: "Plumbing, Electrical, Carpentry..."
      },
      invoicing: {
        title: "Invoicing",
        subtitle: "Create and manage invoices for your projects",
        addInvoice: "Create New Invoice",
        scanInvoice: "Scan Invoice with AI",
        takePhoto: "Take Photo",
        uploadImage: "Upload Image",
        analyzing: "Analyzing invoice with AI...",
        scanSuccess: "Invoice Scanned Successfully",
        scanSuccessDescription: "Invoice details have been automatically filled",
        scanFailed: "Scan Failed",
        cameraError: "Camera Error",
        cameraErrorDescription: "Could not access camera. Please try uploading an image instead.",
        capture: "Capture",
        fields: {
          invoiceNumber: "Invoice Number",
          client: "Client",
          amount: "Amount",
          issueDate: "Issue Date",
          dueDate: "Due Date",
          notes: "Notes",
          status: "Status"
        },
        status: {
          pending: "Pending",
          paid: "Paid",
          overdue: "Overdue",
          cancelled: "Cancelled"
        },
        clientOptional: "(Optional)",
        notesPlaceholder: "Payment terms and additional notes...",
        creating: "Creating...",
        createInvoice: "Create Invoice",
        noClient: "No client",
        selectClient: "Select a client",
        amountRequired: "Amount is required",
        paymentOverdue: "Payment Overdue",
        daysOverdue: "days overdue"
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
        actions: "Actions",
        close: "Close",
        submit: "Submit",
        upload: "Upload",
        download: "Download",
        view: "View",
        copy: "Copy",
        print: "Print",
        email: "Email",
        phone: "Phone",
        address: "Address",
        name: "Name",
        description: "Description",
        notes: "Notes",
        date: "Date",
        amount: "Amount",
        status: "Status",
        priority: "Priority",
        total: "Total",
        subtotal: "Subtotal",
        tax: "Tax",
        discount: "Discount",
        yes: "Yes",
        no: "No",
        required: "Required",
        optional: "Optional"
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
        schedule: "Horario",
        approvals: "Aprobaciones",
        settings: "Configuración"
      },
      dashboard: {
        title: "Panel de Control",
        welcome: "Bienvenido de nuevo",
        activeJobs: "Trabajos Activos",
        completedJobs: "Trabajos Completados",
        outstandingInvoices: "Facturas Pendientes",
        pendingApprovals: "Aprobaciones Pendientes",
        totalRevenue: "Ingresos Totales",
        recentActivity: "Actividad Reciente",
        quickActions: "Acciones Rápidas",
        recentAlerts: "Alertas Recientes",
        analytics: "Analíticas",
        availableSubcontractors: "Subcontratistas Disponibles",
        overdueInvoices: "Facturas Vencidas",
        jobCompletionRate: "Tasa de Finalización de Trabajos",
        averageProjectValue: "Valor Promedio del Proyecto",
        monthlyRevenue: "Ingresos Mensuales",
        clientSatisfaction: "Satisfacción del Cliente",
        noRecentActivity: "No hay actividad reciente",
        viewAll: "Ver Todo"
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
      clients: {
        title: "Clientes",
        subtitle: "Gestiona las relaciones con tus clientes e información de contacto",
        addClient: "Agregar Nuevo Cliente",
        editClient: "Editar Cliente",
        deleteClient: "Eliminar Cliente",
        deleteConfirm: "¿Estás seguro de que quieres eliminar este cliente? Esta acción no se puede deshacer.",
        noClients: "No hay clientes aún",
        noClientsDescription: "Comienza a construir tu base de clientes agregando tu primer cliente.",
        addFirstClient: "Agregar Tu Primer Cliente",
        fields: {
          name: "Nombre de la Empresa",
          contactPerson: "Persona de Contacto",
          email: "Dirección de Correo",
          phone: "Número de Teléfono",
          address: "Dirección",
          notes: "Notas"
        },
        created: "Agregado",
        contactInfo: "Información de Contacto"
      },
      subcontractors: {
        title: "Subcontratistas",
        subtitle: "Gestiona tu red de subcontratistas especializados",
        addSubcontractor: "Agregar Nuevo Subcontratista",
        editSubcontractor: "Editar Subcontratista",
        deleteSubcontractor: "Eliminar Subcontratista",
        deleteConfirm: "¿Estás seguro de que quieres eliminar este subcontratista? Esta acción no se puede deshacer.",
        noSubcontractors: "No hay subcontratistas aún",
        noSubcontractorsDescription: "Construye tu red agregando subcontratistas de confianza.",
        addFirstSubcontractor: "Agregar Tu Primer Subcontratista",
        fields: {
          name: "Nombre",
          email: "Correo",
          phone: "Teléfono",
          skills: "Habilidades y Notas",
          availability: "Estado de Disponibilidad"
        },
        availability: {
          available: "Disponible",
          busy: "Ocupado"
        },
        rating: "calificación",
        skillsPlaceholder: "Plomería, Eléctrico, Carpintería..."
      },
      invoicing: {
        title: "Facturación",
        subtitle: "Crea y gestiona facturas para tus proyectos",
        addInvoice: "Crear Nueva Factura",
        scanInvoice: "Escanear Factura con IA",
        takePhoto: "Tomar Foto",
        uploadImage: "Subir Imagen",
        analyzing: "Analizando factura con IA...",
        scanSuccess: "Factura Escaneada Exitosamente",
        scanSuccessDescription: "Los detalles de la factura se han llenado automáticamente",
        scanFailed: "Escaneo Fallido",
        cameraError: "Error de Cámara",
        cameraErrorDescription: "No se pudo acceder a la cámara. Por favor intenta subir una imagen en su lugar.",
        capture: "Capturar",
        fields: {
          invoiceNumber: "Número de Factura",
          client: "Cliente",
          amount: "Cantidad",
          issueDate: "Fecha de Emisión",
          dueDate: "Fecha de Vencimiento",
          notes: "Notas",
          status: "Estado"
        },
        status: {
          pending: "Pendiente",
          paid: "Pagado",
          overdue: "Vencido",
          cancelled: "Cancelado"
        },
        clientOptional: "(Opcional)",
        notesPlaceholder: "Términos de pago y notas adicionales...",
        creating: "Creando...",
        createInvoice: "Crear Factura",
        noClient: "Sin cliente",
        selectClient: "Seleccionar un cliente",
        amountRequired: "La cantidad es requerida",
        paymentOverdue: "Pago Vencido",
        daysOverdue: "días vencidos"
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
        actions: "Acciones",
        close: "Cerrar",
        submit: "Enviar",
        upload: "Subir",
        download: "Descargar",
        view: "Ver",
        copy: "Copiar",
        print: "Imprimir",
        email: "Correo",
        phone: "Teléfono",
        address: "Dirección",
        name: "Nombre",
        description: "Descripción",
        notes: "Notas",
        date: "Fecha",
        amount: "Cantidad",
        status: "Estado",
        priority: "Prioridad",
        total: "Total",
        subtotal: "Subtotal",
        tax: "Impuesto",
        discount: "Descuento",
        yes: "Sí",
        no: "No",
        required: "Requerido",
        optional: "Opcional"
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