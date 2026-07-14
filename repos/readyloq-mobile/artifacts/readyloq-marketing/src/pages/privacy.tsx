import { Seo } from "@/components/seo";

export default function Privacy() {
  return (
    <>
      <Seo 
        title="Privacy Policy | ReadyLoq" 
        description="ReadyLoq Privacy Policy regarding property and customer data."
      />
      
      <div className="bg-slate-50 py-16 md:py-24">
        <div className="container mx-auto px-4 md:px-6 max-w-3xl">
          <h1 className="text-4xl font-bold text-slate-900 mb-6">Privacy Policy</h1>
          <p className="text-slate-500 mb-12">Last Updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
          
          <div className="prose prose-slate max-w-none prose-headings:font-bold prose-h2:text-2xl prose-h2:mt-12">
            <p>
              ReadyLoq ("we", "us", or "our") is committed to protecting your privacy and the privacy of your clients. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website or use our property intelligence platform (the "Service").
            </p>

            <h2>1. Information We Collect</h2>
            <p>We collect information that you provide directly to us when using the Service:</p>
            <ul>
              <li><strong>Account Data:</strong> Name, email address, phone number, and company details required to create an account.</li>
              <li><strong>Property Data:</strong> Information entered into the system regarding properties serviced, including addresses, access notes, treatment histories, and photos.</li>
              <li><strong>Client Data:</strong> Information about your customers necessary for generating white-labeled reports.</li>
            </ul>

            <h2>2. How We Use Your Information</h2>
            <p>We use the information we collect to:</p>
            <ul>
              <li>Provide, operate, and maintain our Service.</li>
              <li>Generate property intelligence records and white-labeled reports on your behalf.</li>
              <li>Improve, personalize, and expand our Service.</li>
              <li>Understand and analyze how you use our Service.</li>
              <li>Communicate with you for customer service, updates, and other purposes related to the Service.</li>
            </ul>

            <h2>3. Data Ownership and Security</h2>
            <p>
              You retain all rights to the Property Data and Client Data you input into the Service. We act as a data processor. We implement appropriate technical and organizational security measures designed to protect the security of any personal information we process.
            </p>

            <h2>4. Sharing Your Information</h2>
            <p>We do not sell your personal information. We may share information with:</p>
            <ul>
              <li><strong>Service Providers:</strong> Third-party vendors that help us operate our business (e.g., hosting providers, email services).</li>
              <li><strong>Legal Requirements:</strong> If required to do so by law or in response to valid requests by public authorities.</li>
            </ul>

            <h2>5. Contact Us</h2>
            <p>
              If you have questions or comments about this Privacy Policy, please contact us at: <a href="mailto:privacy@readyloq.com">privacy@readyloq.com</a>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
