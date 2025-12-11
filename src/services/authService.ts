
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

export const useLogout = () => {
  const { signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const logout = async () => {
    try {
      await signOut();
      
      toast({
        title: "Signed out",
        description: "You have been successfully signed out."
      });
      
      // Redirect to auth page
      navigate('/auth', { replace: true });
      
    } catch (error: unknown) {
      console.error('Logout error:', error);
      
      // Even if there's an error, redirect to auth page
      toast({
        title: "Signed out",
        description: "You have been signed out locally.",
        variant: "default"
      });
      
      navigate('/auth', { replace: true });
    }
  };

  return { logout };
};
