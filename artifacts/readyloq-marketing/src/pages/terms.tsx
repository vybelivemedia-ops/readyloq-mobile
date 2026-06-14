import { Seo } from "@/components/seo";

export default function Terms() {
  return (
    <>
      <Seo 
        title="Terms of Service | ReadyLoq" 
        description="ReadyLoq Terms of Service."
      />
      
      <div className="bg-slate-50 py-16 md:py-24">
        <div className="container mx-auto px-4 md:px-6 max-w-3xl">
          <h1 className="text-4xl font-bold text-slate-900 mb-6">Terms of Service</h1>
          <p className="text-slate-500 mb-12">Last Updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
          
          <div className="prose prose-slate max-w-none prose-headings:font-bold prose-h2:text-2xl prose-h2:mt-12">
            <p>
              These Terms of Service ("Terms") govern your access to and use of the ReadyLoq website, application, and related services (collectively, the "Service"). By using the Service, you agree to be bound by these Terms.
            </p>

            <h2>1. Use of the Service</h2>
            <p>
              ReadyLoq provides a property intelligence and operational knowledge platform for field service companies. You agree to use the Service only for its intended B2B purposes and in compliance with all applicable laws.
            </p>

            <h2>2. User Accounts</h2>
            <p>
              You are responsible for safeguarding your account credentials. You must notify us immediately of any unauthorized use of your account. You are responsible for all activities that occur under your account.
            </p>

            <h2>3. Customer Data</h2>
            <p>
              "Customer Data" means any data, information, or material provided or submitted by you to the Service. You retain all right, title, and interest in and to your Customer Data. You grant ReadyLoq a limited, worldwide, non-exclusive license to host, copy, transmit, and display Customer Data as necessary for us to provide the Service to you.
            </p>

            <h2>4. Prohibited Conduct</h2>
            <p>You agree not to:</p>
            <ul>
              <li>Use the Service to store or transmit infringing, libelous, or otherwise unlawful material.</li>
              <li>Interfere with or disrupt the integrity or performance of the Service.</li>
              <li>Attempt to gain unauthorized access to the Service or its related systems.</li>
              <li>Reverse engineer, decompile, or disassemble any part of the Service.</li>
            </ul>

            <h2>5. Termination</h2>
            <p>
              We may suspend or terminate your access to the Service at any time for any reason, including breach of these Terms. Upon termination, your right to use the Service will immediately cease.
            </p>

            <h2>6. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, ReadyLoq shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses resulting from your access to or use of or inability to access or use the Service.
            </p>

            <h2>7. Changes to Terms</h2>
            <p>
              We reserve the right to modify these Terms at any time. We will notify you of any material changes by posting the new Terms on this site.
            </p>

            <h2>8. Contact</h2>
            <p>
              If you have any questions about these Terms, please contact us at <a href="mailto:legal@readyloq.com">legal@readyloq.com</a>.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
