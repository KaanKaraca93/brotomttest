'use strict';

const tokenService = require('./src/auth');

async function main() {
  console.log('=== Infor ION API - Token Servisi ===\n');

  const token = await tokenService.getAccessToken();

  console.log('\n=== Token başarıyla alındı, devam edebiliriz! ===');
  return token;
}

main().catch((err) => {
  console.error('\n[HATA] Token alınamadı!');
  if (err.response) {
    console.error('HTTP Status :', err.response.status);
    console.error('Hata Detayı:', JSON.stringify(err.response.data, null, 2));
  } else {
    console.error('Hata       :', err.message);
  }
  process.exit(1);
});
