import { SignIn } from '@clerk/clerk-react';
import { ShieldCheck } from 'lucide-react';

export function Login() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="w-14 h-14 bg-primary rounded-xl mx-auto mb-4 flex items-center justify-center shadow-md">
              <ShieldCheck className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Property Manager Portal
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Sign in to view your building inspection reports
            </p>
          </div>
          <SignIn
            forceRedirectUrl={`${import.meta.env.BASE_URL}`}
            appearance={{
              elements: {
                rootBox: 'w-full mx-auto',
                card: 'shadow-md rounded-xl w-full border border-border',
                headerTitle: 'text-foreground',
                headerSubtitle: 'text-muted-foreground',
                socialButtonsBlockButton: 'border-border hover:bg-muted',
                socialButtonsBlockButtonText: 'font-medium',
                dividerLine: 'bg-border',
                dividerText: 'text-muted-foreground',
                formFieldLabel: 'text-foreground',
                formFieldInput: 'bg-background border-border text-foreground',
                formButtonPrimary: 'bg-primary text-primary-foreground hover:bg-primary/90',
                footerActionText: 'text-muted-foreground',
                footerActionLink: 'text-primary hover:text-primary/90',
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}
