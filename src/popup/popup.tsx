import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PopupView } from './PopupView';
import './popup.css';

const container = document.getElementById('popup-root');
if (container) {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <PopupView isStandalone={false} />
    </StrictMode>
  );
}
