import { createExtensionApp } from '@adobe/aio-commerce-lib-admin-ui/web';
import '@react-spectrum/s2/page.css';
import config from '#app.commerce.config';
import { MainPage } from '#web/pages/main-page.tsx';
import { WelcomeHistoryPage } from '#web/pages/welcome-history.tsx';

createExtensionApp({
  menu: <MainPage />,
  metadata: { extensionId: config.metadata.id },
  routes: [{ path: '#/welcome-history', element: <WelcomeHistoryPage /> }],
});
