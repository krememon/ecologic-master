import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";

export default function TermsOfService() {
  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl pb-24">
      <div className="mb-6">
        <Link href="/settings/legal">
          <button className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors mb-3">
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Terms of Service</h1>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 space-y-6 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
        <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
          <p><span className="font-semibold">Effective Date:</span> March 5, 2026</p>
          <p><span className="font-semibold">Last Updated:</span> March 5, 2026</p>
        </div>

        <p>
          Welcome to EcoLogic. These Terms of Service ("Terms") govern your access to and use of the EcoLogic website, mobile application, and related services (collectively, the "Services") provided by <span className="font-semibold">EcoLogic LLC</span> ("EcoLogic," "we," "us," or "our").
        </p>
        <p>
          By creating an account, accessing, or using the Services, you agree to these Terms. If you do not agree, do not use the Services.
        </p>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">1. Eligibility</h2>
          <p>You must be at least 18 years old and capable of entering into a legally binding agreement to use the Services. If you use the Services on behalf of a business or other entity, you represent that you have authority to bind that entity to these Terms.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">2. Our Services</h2>
          <p>EcoLogic provides contractor and field-service business management tools, which may include job scheduling, dispatching, messaging, invoices, estimates, documents, time tracking, payments, customer management, and related features.</p>
          <p className="mt-2">We may update, improve, modify, or discontinue features at any time.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">3. Accounts</h2>
          <p>You are responsible for:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>providing accurate account information</li>
            <li>maintaining the confidentiality of your login credentials</li>
            <li>all activity that occurs under your account</li>
          </ul>
          <p className="mt-2">You agree to notify us immediately of any unauthorized access or security breach involving your account.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">4. Subscription Plans and Billing</h2>
          <p>Some features require a paid subscription. By subscribing, you agree to pay all applicable fees, taxes, and charges associated with your selected plan.</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Subscriptions may renew automatically unless canceled before renewal.</li>
            <li>Pricing, plan limits, and features may change with notice.</li>
            <li>Failure to pay may result in suspension or loss of access to some or all Services.</li>
            <li>Unless otherwise stated, fees are non-refundable.</li>
          </ul>
          <p className="mt-2">If your subscription is purchased through a third-party platform (such as Apple or Google), billing may be handled by that platform and subject to its terms.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">5. Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>use the Services for unlawful, fraudulent, or unauthorized purposes</li>
            <li>interfere with or disrupt the Services or servers</li>
            <li>attempt to gain unauthorized access to other accounts or systems</li>
            <li>upload malware, harmful code, or malicious content</li>
            <li>use the Services to harass, abuse, threaten, or violate the rights of others</li>
            <li>copy, resell, reverse engineer, or exploit the Services except as allowed by law</li>
          </ul>
          <p className="mt-2">We may suspend or terminate access for violations of these Terms.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">6. User Content and Business Data</h2>
          <p>You may submit or store information through the Services, including job details, customer information, documents, messages, schedules, invoices, and other content ("User Content").</p>
          <p className="mt-2">You retain ownership of your User Content. However, you grant EcoLogic a limited, non-exclusive, worldwide license to host, store, process, transmit, and display your User Content solely as necessary to operate, improve, and provide the Services.</p>
          <p className="mt-2">You are responsible for ensuring that:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>you have the right to upload and use your User Content</li>
            <li>your User Content does not violate any law or third-party rights</li>
            <li>your handling of customer and employee data complies with applicable law</li>
          </ul>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">7. Communications</h2>
          <p>By using the Services, you agree that EcoLogic may send you service-related communications, including account notices, security alerts, billing notices, and operational messages.</p>
          <p className="mt-2">If enabled, you may also receive optional notifications such as push notifications, emails, or text messages. Standard carrier or messaging rates may apply.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">8. Third-Party Services</h2>
          <p>The Services may integrate with third-party providers, including payment processors, email services, cloud storage, app stores, or other external tools. We are not responsible for third-party services, and your use of them may be subject to their own terms and policies.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">9. Intellectual Property</h2>
          <p>The Services, including all software, branding, design, text, graphics, interfaces, and underlying technology, are owned by EcoLogic or its licensors and are protected by applicable intellectual property laws.</p>
          <p className="mt-2">These Terms do not grant you ownership of the Services or any EcoLogic intellectual property. We grant you a limited, revocable, non-transferable, non-exclusive right to use the Services in accordance with these Terms.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">10. Availability and Service Changes</h2>
          <p>We aim to provide reliable service, but we do not guarantee that the Services will be uninterrupted, error-free, or always available.</p>
          <p className="mt-2">We may perform maintenance, updates, or changes that temporarily affect availability.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">11. Disclaimers</h2>
          <p className="uppercase text-xs tracking-wide">THE SERVICES ARE PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS. TO THE MAXIMUM EXTENT PERMITTED BY LAW, ECOLOGIC DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.</p>
          <p className="mt-2">We do not guarantee that the Services will meet all of your requirements or that data will always be accurate, complete, or available without interruption.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">12. Limitation of Liability</h2>
          <p className="uppercase text-xs tracking-wide">TO THE MAXIMUM EXTENT PERMITTED BY LAW, ECOLOGIC AND ITS OFFICERS, MEMBERS, EMPLOYEES, AFFILIATES, AND SERVICE PROVIDERS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA, BUSINESS, OR GOODWILL, ARISING OUT OF OR RELATED TO YOUR USE OF THE SERVICES.</p>
          <p className="uppercase text-xs tracking-wide mt-2">TO THE MAXIMUM EXTENT PERMITTED BY LAW, ECOLOGIC'S TOTAL LIABILITY FOR ANY CLAIM ARISING OUT OF OR RELATING TO THE SERVICES WILL NOT EXCEED THE AMOUNT YOU PAID TO ECOLOGIC FOR THE SERVICES IN THE TWELVE (12) MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM, OR ONE HUNDRED U.S. DOLLARS ($100), WHICHEVER IS GREATER.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">13. Indemnification</h2>
          <p>You agree to defend, indemnify, and hold harmless EcoLogic and its affiliates, officers, members, employees, and agents from and against any claims, damages, liabilities, losses, and expenses (including reasonable attorneys' fees) arising out of or related to:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>your use of the Services</li>
            <li>your User Content</li>
            <li>your violation of these Terms</li>
            <li>your violation of any law or third-party rights</li>
          </ul>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">14. Suspension and Termination</h2>
          <p>We may suspend or terminate your access to the Services at any time if:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>you violate these Terms</li>
            <li>you fail to pay applicable fees</li>
            <li>your use creates risk, harm, or legal exposure for EcoLogic or others</li>
          </ul>
          <p className="mt-2">You may stop using the Services at any time. Subscription cancellations take effect according to the billing terms of your plan or app marketplace.</p>
          <p className="mt-2">Sections that by their nature should survive termination will survive, including ownership, disclaimers, limitation of liability, indemnification, and dispute-related provisions.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">15. Governing Law</h2>
          <p>These Terms are governed by the laws of the State of New York, without regard to conflict of law principles.</p>
          <p className="mt-2">Any dispute arising out of or relating to these Terms or the Services shall be resolved in the state or federal courts located in Suffolk County, New York, and you consent to the jurisdiction of those courts.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">16. Changes to These Terms</h2>
          <p>We may update these Terms from time to time. If we make material changes, we may provide notice by updating the date above, posting the revised Terms in the Services, or by other reasonable means. Your continued use of the Services after the updated Terms become effective means you accept the changes.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">17. Contact Us</h2>
          <p>If you have questions about these Terms, contact us at:</p>
          <div className="mt-2 space-y-0.5">
            <p className="font-semibold">EcoLogic LLC</p>
            <p>support@ecologicc.com</p>
            <p>631-379-5827</p>
          </div>
        </div>
      </div>
    </div>
  );
}
