import { useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLocation } from 'wouter';
import { Loader2 } from 'lucide-react';

export function IndexRedirect() {
  const { isLoaded, isSignedIn, me } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoaded) return;
    
    if (!isSignedIn) {
      setLocation('/login');
      return;
    }

    if (!me?.companyId) {
      setLocation('/no-company');
      return;
    }

    switch (me.effectiveRole) {
      case 'owner':
      case 'manager':
        setLocation('/dashboard');
        break;
      case 'sales':
        setLocation('/opportunities');
        break;
      case 'technician':
        setLocation('/inspections');
        break;
      case 'property_manager':
        setLocation('/client');
        break;
      default:
        setLocation('/dashboard');
    }
  }, [isLoaded, isSignedIn, me, setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}
