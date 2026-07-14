import { useTitle } from "@/hooks/use-title";
import { Mail, Globe } from "lucide-react";

export default function Contact() {
  useTitle("Contact");

  return (
    <div className="pt-32 pb-24 min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6">
        <h1 className="text-5xl font-display font-black mb-8 text-white">Contact Us</h1>
        
        <p className="text-xl text-muted-foreground mb-12">
          Have questions about the beta, partnership opportunities, or just want to say what's up? Reach out.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-card border border-border rounded-2xl p-8 flex flex-col items-center justify-center text-center gap-4 hover:border-primary/50 transition-colors">
            <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center text-primary">
              <Mail size={32} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white mb-1">Email</h3>
              <a href="mailto:info@getvybe.live" className="text-muted-foreground hover:text-primary transition-colors">
                info@getvybe.live
              </a>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-8 flex flex-col items-center justify-center text-center gap-4 hover:border-primary/50 transition-colors">
            <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center text-primary">
              <Globe size={32} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white mb-1">Website</h3>
              <a href="https://getvybe.live" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                https://getvybe.live
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
