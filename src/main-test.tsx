import { createRoot } from 'react-dom/client'
import React from 'react'

// Simple test component to verify React is working
const TestApp = () => {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>🎉 React is working!</h1>
      <p>If you see this, your React setup is correct.</p>
      <p>The white screen issue is likely in the authentication or routing logic.</p>
      <button onClick={() => window.location.reload()}>Reload App</button>
    </div>
  )
}

// Mount the test app
createRoot(document.getElementById("root")!).render(<TestApp />)