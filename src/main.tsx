console.log("DEBUG: main.tsx executing");
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

import ReactGA from "react-ga4";

// Initialize Google Analytics
const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_ID;
if (GA_MEASUREMENT_ID) {
  ReactGA.initialize(GA_MEASUREMENT_ID);
  console.log("GA Initialized");
}

createRoot(document.getElementById("root")!).render(<App />);
