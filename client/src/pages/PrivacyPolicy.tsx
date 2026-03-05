import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";

export default function PrivacyPolicy() {
  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl pb-24">
      <div className="mb-6">
        <Link href="/settings/legal">
          <button className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors mb-3">
            <ChevronLeft className="h-4 w-4" />
            Legal
          </button>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Privacy Policy</h1>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 space-y-6 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
        <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
          <p><span className="font-semibold">Effective Date:</span> March 5, 2026</p>
          <p><span className="font-semibold">Last Updated:</span> March 5, 2026</p>
        </div>

        <p>
          EcoLogic LLC ("EcoLogic," "we," "us," or "our") respects your privacy. This Privacy Policy explains how we collect, use, disclose, and protect information when you use the EcoLogic website, mobile application, and related services (collectively, the "Services").
        </p>
        <p>
          By accessing or using the Services, you acknowledge the practices described in this Privacy Policy.
        </p>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">1. Information We Collect</h2>
          <p>We may collect the following categories of information:</p>

          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-4 mb-1">A. Information You Provide to Us</h3>
          <p>Information you submit directly, including:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>name</li>
            <li>email address</li>
            <li>phone number</li>
            <li>business name</li>
            <li>account login details</li>
            <li>billing and subscription information</li>
            <li>customer, employee, job, invoice, estimate, and scheduling data</li>
            <li>messages, documents, notes, and other content you upload or create through the Services</li>
          </ul>

          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-4 mb-1">B. Information Collected Automatically</h3>
          <p>When you use the Services, we may automatically collect certain technical and usage information, such as:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>device type</li>
            <li>operating system</li>
            <li>browser type</li>
            <li>IP address</li>
            <li>app version</li>
            <li>crash logs and diagnostics</li>
            <li>usage activity within the Services</li>
            <li>approximate location derived from IP address</li>
          </ul>

          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-4 mb-1">C. Location Information</h3>
          <p>If you enable location-based features, we may collect location data from your device, including while using time tracking, clock-in, dispatch, routing, map, or workforce tracking features.</p>
          <p className="mt-2">Location permissions are controlled by your device settings. You may disable location access, but some features may not function properly.</p>

          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-4 mb-1">D. Payment Information</h3>
          <p>Payments may be processed through third-party payment providers. EcoLogic may receive billing-related details such as plan type, subscription status, transaction confirmations, and limited payment metadata, but we do not store full payment card numbers unless explicitly stated otherwise through an integrated payment provider workflow.</p>

          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-4 mb-1">E. Information from Third Parties</h3>
          <p>We may receive information from third-party service providers, integrations, app stores, analytics providers, payment processors, email providers, and other connected tools you choose to use with the Services.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">2. How We Use Information</h2>
          <p>We may use information we collect to:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>provide, operate, and maintain the Services</li>
            <li>create and manage user accounts</li>
            <li>process subscriptions, payments, and billing</li>
            <li>support scheduling, dispatching, messaging, time tracking, documents, and other product features</li>
            <li>personalize and improve the user experience</li>
            <li>send service-related communications, alerts, and notifications</li>
            <li>provide customer support</li>
            <li>monitor performance, diagnose bugs, and improve reliability</li>
            <li>prevent fraud, abuse, and unauthorized access</li>
            <li>enforce our Terms of Service</li>
            <li>comply with legal obligations</li>
          </ul>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">3. How We Share Information</h2>
          <p>We may share information in the following circumstances:</p>

          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-4 mb-1">A. Service Providers</h3>
          <p>We may share information with vendors and service providers who perform services on our behalf, such as:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>cloud hosting providers</li>
            <li>payment processors</li>
            <li>email and messaging providers</li>
            <li>analytics providers</li>
            <li>customer support tools</li>
            <li>push notification and infrastructure providers</li>
          </ul>
          <p className="mt-2">These parties may access information only as needed to perform services for us.</p>

          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-4 mb-1">B. Within Your Organization</h3>
          <p>If you use EcoLogic through a business account, information may be visible to authorized users within that organization based on roles, permissions, and account settings.</p>

          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-4 mb-1">C. Legal Compliance and Protection</h3>
          <p>We may disclose information if we believe doing so is necessary to:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>comply with applicable law, regulation, legal process, or government request</li>
            <li>enforce our agreements</li>
            <li>protect the rights, safety, and property of EcoLogic, our users, or others</li>
            <li>investigate fraud, security issues, or technical problems</li>
          </ul>

          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-4 mb-1">D. Business Transfers</h3>
          <p>If EcoLogic is involved in a merger, acquisition, financing, reorganization, sale of assets, or similar transaction, information may be transferred as part of that transaction.</p>

          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-4 mb-1">E. With Your Direction</h3>
          <p>We may share information when you instruct us to do so or when you enable third-party integrations or connected services.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">4. Data Retention</h2>
          <p>We retain information for as long as reasonably necessary to provide the Services, fulfill the purposes described in this Privacy Policy, comply with legal obligations, resolve disputes, and enforce our agreements.</p>
          <p className="mt-2">Retention periods may vary depending on the type of data, your account status, legal requirements, and operational needs.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">5. Data Security</h2>
          <p>We use reasonable administrative, technical, and organizational measures to protect information. However, no method of transmission or storage is completely secure, and we cannot guarantee absolute security.</p>
          <p className="mt-2">You are responsible for maintaining the confidentiality of your account credentials and for using the Services in a secure manner.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">6. Your Choices and Controls</h2>
          <p>Depending on how you use the Services, you may be able to:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>access, update, or correct certain account information</li>
            <li>manage notification preferences</li>
            <li>control location permissions through your device settings</li>
            <li>cancel a subscription</li>
            <li>request account deletion, subject to legal and operational retention requirements</li>
          </ul>
          <p className="mt-2">If you would like to make a privacy-related request, contact us using the details below.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">7. Children's Privacy</h2>
          <p>The Services are not directed to children under 13, and we do not knowingly collect personal information from children under 13. If we learn that we have collected such information, we will take reasonable steps to delete it.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">8. Third-Party Services and Links</h2>
          <p>The Services may contain links to third-party websites, tools, or integrations. We are not responsible for the privacy practices of third parties. Your interactions with third-party services are governed by their own policies and terms.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">9. International Use</h2>
          <p>If you access the Services from outside the United States, you understand that your information may be transferred to, processed in, and stored in the United States or other jurisdictions where our service providers operate.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">10. State Privacy Rights</h2>
          <p>Depending on your state of residence, you may have certain privacy rights under applicable law, such as rights to request access to, correction of, or deletion of certain personal information.</p>
          <p className="mt-2">If applicable law requires us to provide additional disclosures or rights, we will honor those rights as required. To submit a request, contact us using the information below.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">11. Changes to This Privacy Policy</h2>
          <p>We may update this Privacy Policy from time to time. If we make material changes, we may provide notice by updating the date above, posting the revised policy in the Services, or by other reasonable means. Your continued use of the Services after the updated policy becomes effective means you accept the updated policy.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">12. Contact Us</h2>
          <p>If you have questions about this Privacy Policy or want to make a privacy-related request, contact us at:</p>
          <div className="mt-2 space-y-0.5">
            <p className="font-semibold">EcoLogic LLC</p>
            <p>ppellegrino@ecologicc.com</p>
            <p>https://ecologicc.com</p>
          </div>
        </div>
      </div>
    </div>
  );
}
