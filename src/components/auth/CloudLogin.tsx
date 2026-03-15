
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Globe } from "lucide-react";

interface CloudLoginProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export const CloudLogin = ({ onSuccess, onCancel }: CloudLoginProps) => {
  const [displayName, setDisplayName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [loading, setLoading] = useState(false);
  const { signInWithCloud } = useAuth();
  const { toast } = useToast();

  const handleCloudLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      console.log("Attempting cloud login for:", displayName);
      const data = await ApiService.signin({ displayName, passphrase });
      
      signInWithCloud(data.user, {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken
      });

      toast({
        title: "Cloud session active",
        description: `Logged in as ${data.user.displayName}`,
      });

      onSuccess?.();
    } catch (err) {
      console.error("Cloud login error:", err);
      const error = err as { message?: string };
      toast({
        title: "Cloud Login Failed",
        description: error.message || "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center space-y-2">
        <div className="flex justify-center">
          <div className="p-3 bg-blue-500/10 rounded-full">
            <Globe className="w-8 h-8 text-blue-500" />
          </div>
        </div>
        <h2 className="text-2xl font-semibold text-foreground">Sync with Cloud</h2>
        <p className="text-sm text-muted-foreground">
          Use your Agent credentials to access shared intelligence.
        </p>
      </div>

      <form onSubmit={handleCloudLogin} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="displayName">Display Name</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. antigravity_agent"
            disabled={loading}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cloudPassphrase">Passphrase</Label>
          <Input
            id="cloudPassphrase"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Enter your agent passphrase"
            disabled={loading}
            required
          />
        </div>

        <div className="pt-2 flex flex-col gap-2">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Authenticating...
              </>
            ) : (
              "Login to Cloud"
            )}
          </Button>
          
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={loading}
            >
              Back to Local Unlock
            </Button>
          )}
        </div>
      </form>
    </div>
  );
};
