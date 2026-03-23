import { AuthProvider, useAuth } from './contexts/AuthContext';
import { RepoProvider } from './contexts/RepoContext';
import { LoginScreen } from './components/LoginScreen';
import { Layout } from './components/Layout';
import { Loader } from 'lucide-react';

function AppContent() {
  const { token, loading } = useAuth();

  if (loading) {
    return (
      <div className="app-loading">
        <Loader size={32} className="spin" />
      </div>
    );
  }

  if (!token) return <LoginScreen />;

  return (
    <RepoProvider>
      <Layout />
    </RepoProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
