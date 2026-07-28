import { useAuth } from "@clerk/expo";
import { Redirect, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect } from "react";

// Must be called in the screen that receives the OAuth redirect so the
// in-app browser closes and control returns to startSSOFlow.
WebBrowser.maybeCompleteAuthSession();

import { FullScreenLoader } from "@/components/ui/Loader";

export default function SSOCallbackScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded || isSignedIn) return;
    const timeout = setTimeout(() => {
      router.replace("/sign-in");
    }, 8000);
    return () => clearTimeout(timeout);
  }, [isLoaded, isSignedIn, router]);

  if (isLoaded && isSignedIn) {
    return <Redirect href="/" />;
  }

  return <FullScreenLoader />;
}
