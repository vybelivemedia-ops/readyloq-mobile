import { SignIn } from '@clerk/clerk-react';

export function Login() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="w-12 h-12 bg-primary rounded-md mx-auto mb-4 flex items-center justify-center">
              <svg className="w-6 h-6 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">ReadyLoq Portal</h1>
            <p className="text-muted-foreground mt-1">Sign in to your command center</p>
          </div>
          <SignIn 
            forceRedirectUrl={`${import.meta.env.BASE_URL}`}
            appearance={{
              elements: {
                rootBox: "w-full mx-auto",
                card: "bg-card border border-border shadow-md rounded-xl w-full",
                headerTitle: "text-foreground",
                headerSubtitle: "text-muted-foreground",
                socialButtonsBlockButton: "border-border text-foreground hover:bg-muted",
                socialButtonsBlockButtonText: "font-medium",
                dividerLine: "bg-border",
                dividerText: "text-muted-foreground",
                formFieldLabel: "text-foreground",
                formFieldInput: "bg-background border-border text-foreground",
                formButtonPrimary: "bg-primary text-primary-foreground hover:bg-primary/90",
                footerActionText: "text-muted-foreground",
                footerActionLink: "text-primary hover:text-primary/90"
              }
            }} 
          />
        </div>
      </div>
    </div>
  );
}
