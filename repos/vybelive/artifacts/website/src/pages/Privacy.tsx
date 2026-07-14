import { useTitle } from "@/hooks/use-title";

export default function Privacy() {
  useTitle("Privacy Policy");

  return (
    <div className="pt-32 pb-24 min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6">
        <h1 className="text-4xl md:text-5xl font-display font-black mb-8 text-white">Privacy Policy</h1>
        
        <div className="prose prose-invert prose-lg max-w-none text-muted-foreground space-y-6">
          <p className="text-sm font-medium">Last Updated: October 2026</p>
          
          <p>
            VYBE LIVE MEDIA LLC ("we", "us", or "our") respects your privacy. This Privacy Policy describes how we collect, use, disclose, and safeguard your information when you visit our website https://getvybe.live and use our mobile application (collectively, the "Service").
          </p>

          <h2 className="text-2xl font-bold text-white mt-12 mb-4">1. Information We Collect</h2>
          <p>
            We may collect information about you in a variety of ways. The information we may collect via the Service includes:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Personal Data:</strong> Personally identifiable information, such as your name, shipping address, email address, and telephone number, and demographic information.</li>
            <li><strong>Authentication Data:</strong> When you connect third-party platforms (like Twitch, YouTube, Kick), we store necessary OAuth tokens to facilitate multi-platform broadcasting.</li>
            <li><strong>Financial Data:</strong> Data related to your payment method (e.g., valid credit card number, card brand, expiration date) processed securely via our payment processors (e.g., Stripe).</li>
          </ul>

          <h2 className="text-2xl font-bold text-white mt-12 mb-4">2. Use of Your Information</h2>
          <p>
            Having accurate information about you permits us to provide you with a smooth, efficient, and customized experience. Specifically, we may use information collected about you via the Service to:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Create and manage your account.</li>
            <li>Process your transactions and subscription payments.</li>
            <li>Facilitate multi-platform broadcasting to your connected social accounts.</li>
            <li>Deliver targeted advertising, newsletters, and other information regarding promotions to you.</li>
          </ul>

          <h2 className="text-2xl font-bold text-white mt-12 mb-4">3. Disclosure of Your Information</h2>
          <p>
            We may share information we have collected about you in certain situations. Your information may be disclosed as follows:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>By Law or to Protect Rights:</strong> If we believe the release of information about you is necessary to respond to legal process, to investigate or remedy potential violations of our policies, or to protect the rights, property, and safety of others.</li>
            <li><strong>Third-Party Service Providers:</strong> We may share your information with third parties that perform services for us or on our behalf, including payment processing, data analysis, email delivery, hosting services, customer service, and marketing assistance.</li>
          </ul>

          <h2 className="text-2xl font-bold text-white mt-12 mb-4">4. Account &amp; Data Deletion</h2>
          <p>
            You can request deletion of your VYBE LIVE account and associated personal data at any time. There are two ways to do this:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>In the app:</strong> Go to <strong className="text-white">Settings → Account → Delete Account</strong>. After confirming your password, your account enters a 30-day grace period and is then permanently deleted.</li>
            <li><strong>On the web:</strong> Submit a request through our <a href="/delete-account" className="text-primary hover:underline">account deletion page</a> if you no longer have access to the app.</li>
          </ul>
          <p>
            When your account is deleted, we permanently remove your profile, streams, clips, analytics, and connected platform credentials. Some records may be retained where required by law (for example, billing and transaction history) for the minimum legally required retention period. Accounts that remain inactive for an extended period (180 days) may be suspended and ultimately deleted after additional notice; signing back in before deletion restores the account.
          </p>

          <h2 className="text-2xl font-bold text-white mt-12 mb-4">5. Contact Us</h2>
          <p>
            If you have questions or comments about this Privacy Policy, please contact us at: <a href="mailto:info@getvybe.live" className="text-primary hover:underline">info@getvybe.live</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
