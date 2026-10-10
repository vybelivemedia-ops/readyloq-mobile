import { ShieldAlert, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useClerk } from '@clerk/clerk-react';

export function NoAccess() {
  const { signOut } = useClerk();
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 p-6">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 bg-amber-100 rounded-full mx-auto mb-4 flex items-center justify-center">
          <ShieldAlert className="w-8 h-8 text-amber-600" />
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2">No portal access</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Your account doesn't have access to any properties yet. Please contact your
          ReadyLoq service provider to be granted access.
        </p>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => signOut()}
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
