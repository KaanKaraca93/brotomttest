'use strict';
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const tokenService = require('./src/auth');

const VIEW_URL = `${process.env.ION_API_URL}/JKARFH4LCGZA78A5_PRD/FASHIONPLM/view/api/view/layout/data/get`;

async function main() {
  const token = await tokenService.getAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const gradeRuleId = 179;

  const body = {
    roleId: '1',
    userId: 124,
    personalizationId: 0,
    entity: 'GradeRule',
    pageType: 'details',
    dataFilter: {
      Conditions: [
        { fieldName: 'Id', operator: '=', value: String(gradeRuleId) },
      ],
    },
    pageInfo: null,
    Schema: 'FSH1',
  };

  console.log(`[VIEW API] GradeRule ${gradeRuleId} detay cekiliyor...`);
  const response = await axios.post(VIEW_URL, body, { headers });

  fs.writeFileSync('./output/graderule_179_detail.json', JSON.stringify(response.data, null, 2));
  console.log('[OK] Dosya: output/graderule_179_detail.json');

  // Ozet
  const entities = response.data.entities || [];
  const grEntity = entities.find(e => e.name === 'GradeRule');
  if (grEntity) {
    const gr = grEntity.column;
    console.log('Name        :', gr?.Name);
    console.log('SampleSizeId:', gr?.SampleSizeId);
    console.log('SizeRangeId :', gr?.SizeRangeId);
    console.log('POM sayisi  :', gr?.GradeRulePom?.length);
    console.log('Beden sayisi:', gr?.GradeRuleSizes?.length);
  } else {
    console.log('entity keys:', Object.keys(response.data));
  }
}

main().catch(e => {
  console.error('HATA:', e.message);
  if (e.response) {
    console.error('HTTP:', e.response.status);
    console.error(JSON.stringify(e.response.data)?.substring(0, 1000));
  }
});
