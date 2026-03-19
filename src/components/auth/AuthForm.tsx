import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { localStorageService } from "@/services/localStorageService";
import { LocalUser } from "@/services/localStorageService";
import { ApiService } from "@/services/apiService";

const AuthForm = () => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isAuthenticated, signIn } = useAuth();

  // Redirect to dashboard if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      console.log("User is authenticated, redirecting to dashboard");
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, navigate]);
  // Reset form when user signs out
  useEffect(() => {
    if (!isAuthenticated) {
      setEmail("");
      setPassword("");
      setIsSignUp(false);
    }
  }, [isAuthenticated]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (isSignUp) {
      // Handle Sign Up
      try {
        // Validate input
        if (!email || !password) {
          throw new Error("Email and password are required");
        }

        // Check if user already exists
        const existingUsers = localStorageService.getUsers();
        if (existingUsers.find((user: LocalUser) => user.email === email)) {
          throw new Error("User with this email already exists");
        }

        // Create a new user
        const newUser: LocalUser = {
          id: window.crypto.randomUUID(),
          email,
          created_at: new Date().toISOString(),
        };

        // Save the user and password (note: in a real app, you'd hash the password)
        await localStorageService.addUser(newUser, password);

        toast({
          title: "Account Created",
          description: "You can now sign in with your credentials.",
        });

        // Automatically switch to sign-in form after successful signup
        setIsSignUp(false);

        // Show success toast for account creation
        toast({
          title: "Account Created",
          description: "Your account has been created successfully. Please sign in.",
        });
      } catch (error: unknown) {
        if (error instanceof Error) {
          toast({
            title: "Sign Up Error",
            description: error.message,
            variant: "destructive",
          });
        }
      } finally {
        setLoading(false);
      }
    } else {
      // Handle Sign In
      try {
        console.log("Attempting sign in for:", email);

        // Validate input
        if (!email || !password) {
          throw new Error("Email and password are required");
        }

        let user, session;

        try {
          // Try backend API first (auth supports displayName/passphrase)
          const res = await ApiService.signin({ displayName: email, passphrase: password });
          user = res.user;
          session = {
            access_token: res.accessToken,
            refresh_token: res.refreshToken, // might be undefined depending on backend
            expires_at: Date.now() + 60 * 60 * 1000, // 1 hour
            user: user,
          };
          console.log("Backend sign in successful:", user.displayName);
        } catch (apiError) {
          console.log("Backend auth failed, falling back to local storage...", apiError);
          // Check if user exists in local storage as a fallback
          user = await localStorageService.authenticate(email, password);

          if (!user) {
            throw new Error(
              "Invalid credentials. Please check your username/email and password and try again.",
            );
          }

          // Create a local session
          session = {
            access_token: window.crypto.randomUUID(),
            refresh_token: window.crypto.randomUUID(),
            expires_at: Date.now() + 60 * 60 * 1000, // 1 hour
            user: user,
          };
        }

        // Use the context's signIn function to properly update state
        signIn(user, session);

        console.log("Sign in successful:", user.email || user.displayName);

        toast({
          title: "Welcome back!",
          description: "You have successfully signed in.",
        });

        // Navigate to dashboard after successful sign-in
        navigate("/", { replace: true });
      } catch (error: unknown) {
        if (error instanceof Error) {
          console.error("Auth form error:", error);
          toast({
            title: "Sign In Error",
            description: error.message,
            variant: "destructive",
          });
        }
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>{isSignUp ? "Sign Up" : "Sign In"}</CardTitle>
        <CardDescription>
          {isSignUp
            ? "Create an account to get started"
            : "Enter your credentials to access your notebooks"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="Enter your email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Enter your password"
              minLength={6}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading
              ? isSignUp
                ? "Signing Up..."
                : "Signing In..."
              : isSignUp
                ? "Sign Up"
                : "Sign In"}
          </Button>
        </form>
        <Button
          variant="link"
          className="w-full mt-4"
          onClick={() => setIsSignUp(!isSignUp)}
        >
          {isSignUp
            ? "Already have an account? Sign In"
            : "Don't have an account? Sign Up"}
        </Button>
      </CardContent>
    </Card>
  );
};

export default AuthForm;
