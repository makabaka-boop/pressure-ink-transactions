import React from 'react';
import ReactDOM from 'react-dom/client';
import InkCanvas from './ink/InkCanvas';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <InkCanvas />
  </React.StrictMode>,
);
