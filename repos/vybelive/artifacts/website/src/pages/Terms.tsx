import { useTitle } from "@/hooks/use-title";

export default function Terms() {
  useTitle("Terms of Service");

  return (
    <div className="pt-32 pb-24 min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6">
        <h1 className="text-4xl md:text-5xl font-display font-black mb-8 text-white">Terms of Service</h1>
        
        <div className="prose prose-invert prose-lg max-w-none text-muted-foreground space-y-6">
          <p className="text-sm font-medium">Last Updated: October 2026</p>
          
          <p>
            These Terms of Service ("Terms") constitute a legally binding agreement made between you, whether personally or on behalf of an entity ("you") and VYBE LIVE MEDIA LLC ("Company", "we", "us", or "our"), concerning your access to and use of the https://getvybe.live website as well as any other media form, media channel, mobile website or mobile application related, linked, or otherwise connected thereto (collectively, the "Site").
          </p>

          <h2 className="text-2xl font-bold text-white mt-12 mb-4">1. Subscriptions and Billing</h2>
          <p>
            VYBE LIVE is a software subscription platform that provides livestreaming and creator tools for content creators and businesses. By selecting a premium tier (Pro, Enterprise), you agree to pay the recurring subscription fees indicated at the time of purchase.
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Billing occurs on a recurring basis.</li>
            <li>You may cancel your subscription at any time, which will remain active until the end of the current billing cycle.</li>
            <li>No refunds are provided for partial months.</li>
          </ul>

          <h2 className="text-2xl font-bold text-white mt-12 mb-4">2. User Representations</h2>
          <p>
            By using the Site, you represent and warrant that: (1) all registration information you submit will be true, accurate, current, and complete; (2) you will maintain the accuracy of such information and promptly update such registration information as necessary; (3) you have the legal capacity and you agree to comply with these Terms of Service.
          </p>

          <h2 className="text-2xl font-bold text-white mt-12 mb-4">3. Prohibited Activities</h2>
          <p>
            You may not access or use the Site for any purpose other than that for which we make the Site available. You are responsible for all content broadcasted through our platform. We do not tolerate illegal content, hate speech, or harassment. You must also comply with the Terms of Service of all third-party platforms you broadcast to (e.g., YouTube, Twitch, TikTok).
          </p>

          <h2 className="text-2xl font-bold text-white mt-12 mb-4">4. Limitation of Liability</h2>
          <p>
            In no event will we or our directors, employees, or agents be liable to you or any third party for any direct, indirect, consequential, exemplary, incidental, special, or punitive damages, including lost profit, lost revenue, loss of data, or other damages arising from your use of the site.
          </p>

          <h2 className="text-2xl font-bold text-white mt-12 mb-4">5. Contact Us</h2>
          <p>
            In order to resolve a complaint regarding the Site or to receive further information regarding use of the Site, please contact us at: <a href="mailto:info@getvybe.live" className="text-primary hover:underline">info@getvybe.live</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
