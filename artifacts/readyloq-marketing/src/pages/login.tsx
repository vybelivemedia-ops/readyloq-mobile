import { SignIn, useAuth } from "@clerk/clerk-react";
import { useEffect } from "react";
import { useLocation } from "wouter";

export default function Login() {
  const { isLoaded, isSignedIn } = useAuth();
  const [, navigate] = useLocation();

  // If already signed in, skip the form and go straight to dashboard.
  useEffect(() => {
    if (isLoaded && isSignedIn) navigate("/dashboard");
  }, [isLoaded, isSignedIn, navigate]);

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-slate-950 px-4">
      <div className="mb-8 text-center">
        <p className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-2">Platform</p>
        <h1 className="text-2xl font-bold text-white">ReadyLoq Admin</h1>
        <p className="text-slate-400 text-sm mt-1">Sign in to manage companies, users, and billing</p>
      </div>

      <SignIn
        appearance={{
          elements: {
            rootBox: "w-full max-w-[420px]",
            card: "bg-slate-900 border border-slate-800 shadow-2xl rounded-xl",
            headerTitle: "text-white",
            headerSubtitle: "text-slate-400",
            socialButtonsBlockButton:
              "border-slate-700 text-slate-200 bg-slate-800 hover:bg-slate-700",
            dividerLine: "bg-slate-700",
            dividerText: "text-slate-500 text-xs",
            formFieldLabel: "text-slate-300 text-sm",
            formFieldInput:
              "bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 focus:border-slate-500",
            formButtonPrimary:
              "bg-primary hover:bg-primary/90 text-primary-foreground font-semibold",
            footerActionLink: "text-primary hover:text-primary/80",
            identityPreviewText: "text-slate-200",
            identityPreviewEditButton: "text-primary",
          },
          variables: {
            colorBackground: "#0f172a",
            colorInputBackground: "#1e293b",
            colorText: "#f1f5f9",
          },
        }}
        forceRedirectUrl="/dashboard"
      />
    </div>
  );
}
