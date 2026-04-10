'use strict';

require('dotenv').config();
const axios = require('axios');

class TokenService {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = null;
    this.tokenType = null;
  }

  isTokenValid() {
    if (!this.tokenExpiry) return false;
    const bufferTime = 5 * 60 * 1000; // 5 dakika buffer
    return Date.now() < (this.tokenExpiry - bufferTime);
  }

  async getAccessToken() {
    if (this.accessToken && this.isTokenValid()) {
      console.log('✅ Cache\'den geçerli token kullanılıyor.');
      return this.accessToken;
    }
    console.log('🔄 Yeni token alınıyor...');
    return await this.fetchNewToken();
  }

  async fetchNewToken() {
    const tokenUrl = `${process.env.SSO_BASE_URL}${process.env.TOKEN_ENDPOINT}`;

    // client_id:client_secret → Base64 → Basic Auth header
    const basicAuth = Buffer.from(
      `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
    ).toString('base64');

    // encodeURIComponent kullanarak özel karakterleri (#, ~, vb.) doğru encode et
    const body = [
      'grant_type=password',
      `username=${encodeURIComponent(process.env.SERVICE_ACCOUNT_KEY)}`,
      `password=${encodeURIComponent(process.env.SERVICE_ACCOUNT_SECRET)}`,
    ].join('&');

    console.log('🔐 Token URL:', tokenUrl);

    const response = await axios.post(tokenUrl, body, {
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const data = response.data;

    this.accessToken = data.access_token;
    this.tokenType = data.token_type || 'Bearer';
    const expiresIn = data.expires_in || 3600;
    this.tokenExpiry = Date.now() + expiresIn * 1000;

    console.log('✅ Token başarıyla alındı!');
    console.log('📝 Token tipi    :', this.tokenType);
    console.log('⏰ Geçerlilik    :', expiresIn, 'saniye');
    console.log('📅 Expire zamanı :', new Date(this.tokenExpiry).toISOString());
    console.log('🔑 Access Token  :', data.access_token.substring(0, 50) + '...');

    return this.accessToken;
  }

  async getAuthorizationHeader() {
    const token = await this.getAccessToken();
    return `${this.tokenType} ${token}`;
  }

  getTokenInfo() {
    return {
      hasToken: !!this.accessToken,
      isValid: this.isTokenValid(),
      expiryTime: this.tokenExpiry ? new Date(this.tokenExpiry).toISOString() : null,
      tokenType: this.tokenType,
    };
  }
}

const tokenService = new TokenService();
module.exports = tokenService;
