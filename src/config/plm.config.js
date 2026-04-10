'use strict';

require('dotenv').config();

const PLM_CONFIG = {
  tenantId: process.env.TENANT_ID,
  clientName: process.env.CONSUMER_NAME,

  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,

  serviceAccountAccessKey: process.env.SERVICE_ACCOUNT_KEY,
  serviceAccountSecretKey: process.env.SERVICE_ACCOUNT_SECRET,

  ionApiUrl: process.env.ION_API_URL,
  providerUrl: process.env.SSO_BASE_URL,

  endpoints: {
    authorization: 'authorization.oauth2',
    token: 'token.oauth2',
    revoke: 'revoke_token.oauth2',
  },

  delegationType: '12',
  version: '1.0',
};

module.exports = PLM_CONFIG;
