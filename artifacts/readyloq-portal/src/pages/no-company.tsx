import { useAuth } from '@/hooks/use-auth';
import { useClerk } from '@clerk/clerk-react';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';

export function NoCompany() {
  const { signOut } = useClerk();
  
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto">
          <span className="text-2xl">🏢</span>
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">No Company Assigned</h1>
          <p className="text-muted-foreground mt-2">
            Your account hasn't been added to a company yet. Contact your administrator or manager to send you an invite link.
          </p>
        </div>
        <Button variant="outline" onClick={() => signOut()} className="w-full">
          <LogOut className="w-4 h-4 mr-2" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
