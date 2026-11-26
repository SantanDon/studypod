import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById("root")!).render(<App />);

document.querySelectorAll<HTMLLinkElement>('link[data-optional-stylesheet]').forEach(link => {
  link.rel = 'stylesheet';
});
