import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import ErrorBoundary from "@/components/ErrorBoundary";
import RibbonsCursor from "@/components/ui/RibbonsCursor";
import { useVisualEffectsStore } from "@/stores/visualEffectsStore";
import Dashboard from "./pages/Dashboard";
import Notebook from "./pages/Notebook";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import ReactGA from "react-ga4";

const PageTracker = () => {
  const location = useLocation();

  useEffect(() => {
    if (import.meta.env.VITE_GA_ID) {
      ReactGA.send({ hitType: "pageview", page: location.pathname + location.search });
    }
  }, [location]);

  return null;
};

const queryClient = new QueryClient();

const AppContent = () => {
  return (
    <>
      <PageTracker />
      <Routes>
        <Route 
          path="/" 
          element={
            <ProtectedRoute fallback={<Auth />}>
              <Dashboard />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/notebook" 
          element={
            <ProtectedRoute fallback={<Auth />}>
              <Notebook />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/notebook/:id" 
          element={
            <ProtectedRoute fallback={<Auth />}>
              <Notebook />
            </ProtectedRoute>
          } 
        />
        <Route path="/auth" element={<Auth />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

const AppWithEffects = () => {
  const { ribbonCursorEnabled, ribbonCount, ribbonOpacity, ribbonThickness, useCustomFonts } = useVisualEffectsStore();
  
  return (
    <div className={useCustomFonts ? 'font-body' : ''}>
      <RibbonsCursor 
        enabled={ribbonCursorEnabled}
        ribbonCount={ribbonCount}
        opacity={ribbonOpacity}
        thickness={ribbonThickness}
      />
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ErrorBoundary 
          variant="page"
          title="Application Error"
          message="We're sorry, but something went wrong. Please try refreshing the page."
        >
          <AppContent />
        </ErrorBoundary>
      </BrowserRouter>
    </div>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <AppWithEffects />
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
