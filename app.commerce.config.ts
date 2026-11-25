import { defineConfig } from '@adobe/aio-commerce-lib-app/config';

export default defineConfig({
  metadata: {
    id: 'customer-welcome-notifier',
    displayName: 'Customer Welcome Notifier',
    description: "Notifies an external welcome service with the customer's email and creation timestamp when a new Commerce customer account is created.",
    version: '1.0.0',
  },
  eventing: {
    commerce: [{
      provider: {
        label: 'Customer Welcome Events',
        description: 'Receives customer save events for welcome notifications.',
      },
      events: [{
        name: 'observer.customer_save_commit_after',
        label: 'Customer Saved',
        description: 'Checks whether a saved customer is newly created.',
        fields: [{ name: 'id' }, { name: 'email' }, { name: 'created_at' }, { name: 'updated_at' }],
        runtimeActions: ['customer-welcome/handle-customer-created'],
      }],
    }],
  },
  businessConfig: {
    schema: [
      { name: 'welcome_service_base_url', type: 'url', label: 'Welcome Service Base URL', default: 'https://aisenseapi.com/services/v1/webhook_capture' },
      { name: 'customer_key_pepper', type: 'password', label: 'Customer History Key', default: '' },
    ],
  },
  installation: {
    customInstallationSteps: [{
      script: './scripts/setup-welcome-history-db.ts',
      name: 'Set up welcome delivery history',
      description: 'Creates the AUS welcome history collection, indexes and customer key.',
    }],
  },
  adminUi: {
    customer: {
      massActions: [{
        type: 'view',
        id: 'view-welcome-history',
        label: 'Welcome delivery history',
        description: 'Inspect delivery attempts for one customer.',
        path: '#/welcome-history',
        aclProtected: true,
        selectionLimit: 1,
      }],
    },
  },
});
