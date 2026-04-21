import { useState, useMemo } from "react";
import { Link } from "wouter";
import { ChevronLeft, ChevronDown, Search, X } from "lucide-react";

interface FAQItem {
  q: string;
  a: string;
}

interface FAQSection {
  title: string;
  items: FAQItem[];
}

const sections: FAQSection[] = [
  {
    title: "Getting Started",
    items: [
      {
        q: "What is EcoLogic?",
        a: "EcoLogic is a construction management platform built for trade contractors. It helps you manage jobs, track time, coordinate crews, send estimates and invoices, collect payments, and communicate with your team — all from one place.",
      },
      {
        q: "How do I create an account?",
        a: "You can sign up using your email address, Google account, or Apple ID. After creating your account, you'll either create a new company or join an existing one using an invite code from your company owner.",
      },
      {
        q: "How do I join my company?",
        a: "Ask your company owner or manager for the invite code. During signup, choose 'Join a Company' and enter the code. You'll be added to the team with the role they've assigned to you.",
      },
      {
        q: "What roles are available?",
        a: "There are three main roles:\n\n• Owner — Full access to everything: jobs, invoices, payments, company settings, team management, and all data.\n• Supervisor — Can manage jobs, schedules, crews, and view most data. Cannot access billing or company-level settings.\n• Technician — Can clock in/out, view assigned jobs, send messages, and access basic features relevant to fieldwork.",
      },
    ],
  },
  {
    title: "Account & Login",
    items: [
      {
        q: "I'm not receiving my login code",
        a: "If you're not receiving your email login code:\n\n1. Check your spam/junk folder — codes sometimes get filtered.\n2. Make sure you're entering the exact email address you signed up with.\n3. Wait at least 60 seconds before requesting a new code.\n4. If you're using a work email, check with your IT team — some corporate filters block automated emails.\n5. Try using Google or Apple Sign-In as an alternative.\n\nIf none of these work, contact support with the email address you're trying to use.",
      },
      {
        q: "I entered the code but still can't log in",
        a: "Login codes expire after a few minutes. If the code didn't work:\n\n1. Make sure you're using the most recent code (check for newer emails).\n2. Enter the code exactly as shown — no extra spaces.\n3. Request a fresh code and use it immediately.\n\nIf you're still stuck, try clearing your browser cache or using a different browser. On mobile, try closing and reopening the app.",
      },
      {
        q: "Why am I being logged out?",
        a: "Sessions can expire for a few reasons:\n\n• Your session timed out after a period of inactivity.\n• You logged in on another device, which may have ended your previous session.\n• Your browser cleared cookies or site data.\n• The app was updated, which occasionally requires a fresh login.\n\nIf you're being logged out frequently, make sure your browser isn't set to clear cookies automatically, and check that you're not using private/incognito mode.",
      },
      {
        q: "How do I change my email or password?",
        a: "Go to Settings from the bottom navigation. You can update your email address and change your password from the account section. If you signed up with Google or Apple, your email is tied to that account and can't be changed separately.",
      },
      {
        q: "Why can't I access certain pages?",
        a: "Access to pages depends on your role. Technicians have limited access compared to Supervisors and Owners. For example, billing, company settings, and certain management pages are only available to Owners. If you think you should have access to something, ask your company owner to check your role.",
      },
    ],
  },
  {
    title: "Clock In / Time Tracking",
    items: [
      {
        q: "Why can't I clock in?",
        a: "If the clock-in button isn't working:\n\n1. Check your internet connection — clock-in requires a server connection.\n2. Make sure you're not already clocked in. Check the Home screen for an active session.\n3. If you see an error, try closing and reopening the app.\n4. Your subscription may have expired — check with your company owner.\n\nIf the issue continues, report a bug through Settings > Support > Report a Bug.",
      },
      {
        q: "Why aren't today's jobs showing in Clock In?",
        a: "The job picker shows jobs you're assigned to. If a job is missing:\n\n1. Check with your supervisor that you've been assigned to the job.\n2. Make sure the job is scheduled for today and hasn't been completed or archived.\n3. Pull down to refresh the Home screen.\n\nYou can also clock in without selecting a specific job by choosing a general category like 'Admin' or 'Travel'.",
      },
      {
        q: "Why is my clock-in location not working?",
        a: "Location tracking requires permission from your device:\n\n1. When you clock in, you may see a location permission prompt — tap 'Allow' or 'Allow While Using'.\n2. If you denied permission earlier, go to your device Settings > find EcoLogic > enable Location.\n3. On iOS, make sure Location Services are turned on globally in Settings > Privacy > Location Services.\n4. On Android, make sure Location is enabled in your quick settings.\n\nLocation tracking is optional — denying permission won't prevent you from clocking in, but your location won't appear on the crew map.",
      },
      {
        q: "Why did my time entry stop?",
        a: "Time entries can stop if:\n\n• You were auto-clocked out at the end of the day.\n• A manager manually ended your session.\n• There was an app crash or loss of connection during your session.\n\nCheck your time log on the Home screen. If a session ended unexpectedly, your manager can edit the timesheet to correct it.",
      },
      {
        q: "What happens if I forget to clock out?",
        a: "If you forget to clock out, the system will automatically clock you out at the end of the day. Your manager can also review and edit timesheets to correct any inaccurate entries. It's best to clock out when you're done to keep your hours accurate.",
      },
      {
        q: "Why is my elapsed time wrong?",
        a: "Elapsed time is calculated from your clock-in timestamp to now (or clock-out if ended). If it seems off:\n\n1. Check your timezone — the app uses your device's local time.\n2. If you switched jobs during the day, each segment is tracked separately.\n3. If there's a real discrepancy, ask your manager to review and edit the timesheet entry.",
      },
      {
        q: "Why can't I switch jobs while clocked in?",
        a: "Job switching should work while you're clocked in. If it's not responding:\n\n1. Make sure you have an active clock-in session.\n2. Check your internet connection.\n3. Try closing the job picker and reopening it.\n\nIf you see an error message, note it and report it through Settings > Support > Report a Bug.",
      },
    ],
  },
  {
    title: "Schedule",
    items: [
      {
        q: "Why don't I see my assigned jobs?",
        a: "If your schedule looks empty:\n\n1. Make sure you're looking at the correct date — swipe left/right to change days.\n2. Check that jobs are actually assigned to you. Ask your supervisor to confirm.\n3. Pull down to refresh the schedule.\n4. Try switching between Day, List, Month, or Map views to see if items appear.\n\nTechnicians only see jobs they're assigned to. Owners and Supervisors see all company jobs.",
      },
      {
        q: "Why is a job on the wrong day?",
        a: "Jobs appear on the schedule based on their scheduled date and time. If a job is on the wrong day:\n\n1. The scheduled date may have been entered incorrectly — ask your manager to check.\n2. Timezone differences can sometimes shift jobs by a day if your device timezone doesn't match.\n\nOnly Owners and Supervisors can reschedule jobs.",
      },
      {
        q: "Why is the map not showing jobs?",
        a: "The schedule map requires jobs to have valid addresses:\n\n1. Jobs without addresses won't appear on the map.\n2. If an address can't be geocoded (located on the map), the job marker won't show.\n3. Make sure you have a stable internet connection for the map to load.\n4. Check that Google Maps is not blocked on your network.\n\nIf specific jobs are missing from the map, verify they have complete addresses entered.",
      },
      {
        q: "How do I use Day / List / Month / Map views?",
        a: "The Schedule page offers multiple views:\n\n• Day — Shows a ribbon of dates at the top. Tap a date to see that day's items.\n• List — Shows all upcoming items in a scrollable list.\n• Month — Full calendar grid with colored dot indicators. Tap a date to see its items below.\n• Map — Shows job locations on a map with markers. Tap a marker for details.\n\nSwitch views using the toggle buttons at the top of the Schedule page.",
      },
      {
        q: "Why are schedule changes not updating?",
        a: "Schedule data refreshes automatically, but if you're not seeing recent changes:\n\n1. Pull down to force a refresh.\n2. Check your internet connection.\n3. If someone else made the change, it may take a few seconds to sync.\n4. Try switching away from the Schedule tab and back.",
      },
    ],
  },
  {
    title: "Jobs",
    items: [
      {
        q: "Why can't I open a job?",
        a: "If a job won't open:\n\n1. Check your internet connection — job details load from the server.\n2. The job may have been deleted or archived.\n3. As a Technician, you can only access jobs you're assigned to.\n\nIf you're getting an error, try refreshing the page or restarting the app.",
      },
      {
        q: "Why can't I see certain job details?",
        a: "Some job details are restricted by role:\n\n• Technicians can see basic job info, assigned tasks, and their own time entries.\n• Financial details like invoices, payments, and pricing may be limited to Owners and Supervisors.\n• Document visibility depends on how each document was categorized when uploaded.\n\nIf you need access to specific information, talk to your company owner.",
      },
      {
        q: "Why can't I edit a job?",
        a: "Only Owners and Supervisors can edit job details. If you're a Technician and need something changed on a job, contact your supervisor or the company owner.",
      },
      {
        q: "Why was I removed from a job?",
        a: "Crew assignments are managed by Owners and Supervisors. If you were removed from a job, it was likely reassigned. Check with your supervisor for details.",
      },
      {
        q: "Why is a job marked with the wrong status?",
        a: "Job statuses are updated manually by managers or automatically based on certain events (like full payment). If a status seems wrong:\n\n1. Ask your supervisor to review and update it.\n2. Some statuses change automatically — for example, a job may be archived after its invoice is fully paid.",
      },
    ],
  },
  {
    title: "Notifications",
    items: [
      {
        q: "Why am I not getting notifications?",
        a: "If you're not receiving notifications:\n\n1. Check that notifications are enabled in Settings.\n2. On iOS: Go to device Settings > EcoLogic > Notifications > make sure Allow Notifications is on.\n3. On Android: Go to device Settings > Apps > EcoLogic > Notifications > make sure they're enabled.\n4. In a web browser: Check that you haven't blocked notifications for the site.\n5. Make sure you're logged in — notifications only work when you have an active session.\n\nIf push notifications aren't working on mobile, try logging out and back in to re-register your device.",
      },
      {
        q: "Why did a notification disappear?",
        a: "Notifications may disappear if:\n\n• You or another user marked them as read.\n• They were part of a bulk delete.\n• The related item (job, message, etc.) was deleted.\n\nNotifications are stored on the server, so they persist across devices. If you're missing notifications you expected, check the notification panel by tapping the bell icon.",
      },
      {
        q: "Why is the bell not updating right away?",
        a: "The notification badge refreshes periodically and when you open the notification panel. If it seems delayed:\n\n1. Tap the bell icon to force a refresh.\n2. Check your internet connection.\n3. Try pulling down to refresh the current page.",
      },
      {
        q: "What notifications are considered important?",
        a: "Notifications are prioritized into tiers:\n\n• Action Required — Direct messages, job assignments, overdue invoices, failed payments. These need your attention.\n• Updates — Payment confirmations, estimate updates. Good to know.\n• Activity — Clock in/out events, announcements. Informational.\n\nYou can filter notifications by these categories in the notification panel.",
      },
      {
        q: "Why don't I see a message notification?",
        a: "Message notifications are sent when someone sends you a direct message. If you're not seeing them:\n\n1. Make sure you have notifications enabled (see above).\n2. If you already have the Messages page open, the app may not send a duplicate notification.\n3. Check that the sender actually sent the message — ask them to confirm.",
      },
    ],
  },
  {
    title: "Documents",
    items: [
      {
        q: "Why can't I see a document?",
        a: "Document visibility depends on how it was categorized:\n\n• Some documents are set to 'Office Only' and won't be visible to Technicians.\n• Documents marked 'Assigned Crew Only' are only visible if you're assigned to that job.\n• Customer-facing documents may have different visibility rules.\n\nIf you need access to a specific document, ask your company owner to check its visibility settings.",
      },
      {
        q: "Why did my upload fail?",
        a: "File uploads can fail for a few reasons:\n\n1. The file is too large — try a smaller file or compress it.\n2. The file type isn't supported.\n3. Your internet connection dropped during upload.\n4. There may be a temporary server issue.\n\nTry the upload again. If it keeps failing, report the issue through Settings > Support > Report a Bug and include the file type and size.",
      },
      {
        q: "Why can't I preview a PDF or image?",
        a: "PDF and image previews depend on your browser or device:\n\n1. Some older browsers don't support inline PDF viewing.\n2. On mobile, PDFs may open in a separate viewer app.\n3. If the preview is blank, try downloading the file instead.\n4. Check that the file isn't corrupted by trying to open it on a different device.",
      },
      {
        q: "Why are some documents hidden from me?",
        a: "Documents have visibility levels controlled by your company owner. If a document is hidden, it may be restricted to a specific role or to office staff only. This is a security feature to control who can access sensitive information.",
      },
    ],
  },
  {
    title: "Estimates & Invoices",
    items: [
      {
        q: "Why can't I send an estimate?",
        a: "To send an estimate:\n\n1. Make sure the estimate has at least one line item.\n2. The estimate must have a customer assigned with a valid email or phone number.\n3. Only Owners and Supervisors can create and send estimates.\n\nIf you're getting an error when sending, check that all required fields are filled in and try again.",
      },
      {
        q: "Why wasn't a payment recorded?",
        a: "If a payment seems missing:\n\n1. Check the invoice's payment history — it may be recorded but not yet reflected in totals.\n2. Card payments through Stripe may take a moment to process.\n3. If the payment was made offline (cash/check), someone needs to manually record it.\n4. Check that the payment wasn't recorded under a different invoice.\n\nIf a payment was definitely made but isn't showing, contact your company owner.",
      },
      {
        q: "Why is an invoice marked overdue?",
        a: "Invoices are marked overdue when:\n\n• The due date has passed and there's still a balance remaining.\n• A partial payment was made but the full amount hasn't been received.\n\nTo resolve this, collect the remaining balance or adjust the invoice if there's an error. Only Owners can modify invoice details.",
      },
      {
        q: "What happens when a payment fails?",
        a: "If a card payment fails through Stripe:\n\n1. The customer's card may have been declined — they should try a different payment method.\n2. The payment intent may have expired — create a new payment link.\n3. Check that your Stripe account is in good standing.\n\nFailed payments are logged but don't change the invoice balance. The invoice will still show the outstanding amount.",
      },
      {
        q: "Why can't I edit an invoice?",
        a: "Invoices with recorded payments cannot be freely edited to protect financial records. If you need to make changes:\n\n1. For minor corrections, contact your company owner.\n2. If a payment was recorded in error, it may need to be refunded first.\n3. Some fields on sent invoices are locked to maintain consistency.",
      },
    ],
  },
  {
    title: "Payments & Billing",
    items: [
      {
        q: "How do subscriptions work?",
        a: "EcoLogic uses team-size-based plans. Your plan is automatically selected based on the number of active members in your company. You can view and manage your subscription in Settings. If your subscription expires, you'll be redirected to the billing page until it's renewed.",
      },
      {
        q: "Why am I seeing a paywall?",
        a: "If you're seeing a paywall or can't access the app, your company's subscription may have expired or lapsed. Contact your company owner to renew the subscription. Once renewed, access will be restored for all team members.",
      },
      {
        q: "How do I update my payment method?",
        a: "Go to Settings and look for the Subscription or Billing section. Your company owner can update the payment method on file through the subscription management portal.",
      },
    ],
  },
  {
    title: "App & Device Troubleshooting",
    items: [
      {
        q: "The app is slow or frozen",
        a: "If the app feels slow or unresponsive:\n\n1. Check your internet connection — slow network = slow app.\n2. Close other apps running in the background.\n3. Try closing and reopening EcoLogic.\n4. If on a web browser, try clearing your cache and reloading.\n5. On mobile, make sure you're running the latest version of the app.\n\nIf the issue persists, report it through Settings > Support > Report a Bug with details about what you were doing when it slowed down.",
      },
      {
        q: "A page is stuck loading",
        a: "If a page shows a loading spinner that won't stop:\n\n1. Check your internet connection.\n2. Try pulling down to refresh (mobile) or pressing F5 / Cmd+R (web).\n3. Navigate away and come back to the page.\n4. Close and reopen the app.\n\nIf specific pages consistently get stuck, report it as a bug.",
      },
      {
        q: "A button does nothing when I tap it",
        a: "If a button isn't responding:\n\n1. Wait a moment — the action may be processing.\n2. Check your internet connection.\n3. Make sure you've filled in all required fields (the button may be disabled).\n4. Try scrolling down — there may be a validation error below that's preventing submission.\n5. Close and reopen the app.\n\nIf buttons consistently don't work, report the issue with the specific page and button name.",
      },
      {
        q: "The app looks broken on my phone",
        a: "If the layout looks wrong or content is cut off:\n\n1. Make sure your phone's text size is set to default (large text sizes can affect layout).\n2. Try rotating your phone to landscape and back.\n3. Close and reopen the app.\n4. On web, try clearing your browser cache.\n5. Make sure you're using a supported browser (Chrome, Safari, Firefox).",
      },
      {
        q: "Location permissions are not working",
        a: "If location features aren't working:\n\n1. On iOS: Go to Settings > Privacy > Location Services > EcoLogic > set to 'While Using'.\n2. On Android: Go to Settings > Apps > EcoLogic > Permissions > Location > Allow.\n3. Make sure Location Services / GPS is turned on globally on your device.\n4. If you previously denied permission, you'll need to enable it manually in device settings.\n\nLocation is used for clock-in tracking and the crew map. It's never required to use the app.",
      },
      {
        q: "Notifications are blocked on my device",
        a: "To enable notifications:\n\n1. On iOS: Settings > EcoLogic > Notifications > Allow Notifications.\n2. On Android: Settings > Apps > EcoLogic > Notifications > enable.\n3. On web: Click the lock icon in your browser's address bar > set Notifications to 'Allow'.\n\nAfter enabling, you may need to log out and back in for push notifications to register your device.",
      },
    ],
  },
  {
    title: "Permissions & Access",
    items: [
      {
        q: "Why can the owner see something I can't?",
        a: "EcoLogic uses role-based access control. Owners have full access to all features and data. Supervisors have broad access but can't manage billing or company settings. Technicians have access limited to their assigned jobs, time tracking, messages, and basic features. This is by design to keep sensitive information secure.",
      },
      {
        q: "Why can't I access a document, job, or message?",
        a: "Access depends on your role and assignments:\n\n• Jobs: Technicians only see jobs they're assigned to.\n• Documents: Some documents are restricted by visibility level (e.g., Office Only).\n• Messages: You can only see conversations you're a participant in.\n\nIf you need access, ask your company owner or supervisor to update your assignments or permissions.",
      },
      {
        q: "How do role permissions work?",
        a: "Permissions are tied to your role:\n\n• Owner — Can do everything: manage team, jobs, invoices, payments, settings, billing.\n• Supervisor — Can manage jobs, crews, schedules, estimates. Cannot access billing or company-level settings.\n• Technician — Can clock in/out, view assigned jobs, send messages, and access documents shared with them.\n\nRoles are assigned by the company owner and can be changed in the team management section.",
      },
    ],
  },
  {
    title: "Support & Reporting Issues",
    items: [
      {
        q: "How do I contact support?",
        a: "Go to Settings > Support > Contact Support. Fill in the subject and message, then submit. Your message will be sent to our support team and we'll get back to you.",
      },
      {
        q: "How do I report a bug?",
        a: "Go to Settings > Support > Report a Bug. Describe what happened, include steps to reproduce if possible, and select the urgency level. The report automatically captures your device and app information to help us investigate.",
      },
      {
        q: "How do I request a feature?",
        a: "Go to Settings > Support > Request a Feature. Give your idea a title, describe what it would do, and optionally explain why it would be useful. We review all feature requests.",
      },
      {
        q: "What details should I include in a bug report?",
        a: "The more detail you include, the faster we can fix it:\n\n1. What were you trying to do?\n2. What happened instead of what you expected?\n3. Can you make it happen again? If so, list the exact steps.\n4. What device and browser/app version are you using?\n5. Did you see an error message? If so, what did it say?\n\nThe bug report form automatically captures device info, but your description of what happened is the most valuable part.",
      },
    ],
  },
];

export default function FAQs() {
  const [search, setSearch] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sections;

    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) =>
            item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q)
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [search]);

  const totalResults = filtered.reduce((sum, s) => sum + s.items.length, 0);

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl pb-24">
      <div className="mb-5">
        <Link href="/settings/support">
          <button className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors mb-3">
            <ChevronLeft className="h-4 w-4" />
            Support
          </button>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">FAQs</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Search or browse common questions</p>
      </div>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search FAQs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {search && totalResults === 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No results found for "{search}"</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Try different keywords or browse the sections below</p>
          <button onClick={() => setSearch("")} className="text-xs text-blue-500 mt-3 hover:underline">Clear search</button>
        </div>
      )}

      {search && totalResults > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">{totalResults} result{totalResults !== 1 ? "s" : ""} found</p>
      )}

      <div className="space-y-4">
        {filtered.map((section) => (
          <div key={section.title}>
            <h2 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 px-1">{section.title}</h2>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/50">
              {section.items.map((faq) => {
                const key = `${section.title}:${faq.q}`;
                const isOpen = openKey === key;
                return (
                  <div key={key}>
                    <button
                      className="w-full flex items-start justify-between p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                      onClick={() => setOpenKey(isOpen ? null : key)}
                    >
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100 pr-4 leading-snug">{faq.q}</span>
                      <ChevronDown className={`h-4 w-4 text-slate-400 shrink-0 mt-0.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 -mt-1">
                        <div className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-line">{faq.a}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
