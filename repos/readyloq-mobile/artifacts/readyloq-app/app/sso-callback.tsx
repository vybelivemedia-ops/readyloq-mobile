import { useAuth } from "@clerk/expo";
import { Redirect, useRouter } from "expo-router";
import React, { useEffect } from "react";

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
