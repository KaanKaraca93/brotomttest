'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getStyleById, getActiveGradeRules, getExtendedFieldDropdowns } = require('./services/plmService');
const { selectGradeRule } = require('./services/aiService');

async function fetchAndSave(styleId) {
  console.log(`\n${'='.repeat(55)}`);
  console.log(`  Style Verisi Çekiliyor — StyleId: ${styleId}`);
  console.log(`${'='.repeat(55)}\n`);

  // Token'ı önceden cache'e al, paralel çağrılar cache'ten kullansın
  const tokenService = require('./auth');
  await tokenService.getAccessToken();

  const [styleData, gradeRules, dropdowns] = await Promise.all([
    getStyleById(styleId),
    getActiveGradeRules(),
    getExtendedFieldDropdowns(),
  ]);

  console.log(`\n   Style kayıt sayısı    : ${styleData?.value?.length ?? 'N/A'}`);
  console.log(`   GradeRule sayısı      : ${gradeRules?.value?.length ?? 'N/A'}`);
  console.log(`   Dropdown değer sayısı : ${dropdowns?.value?.length ?? 'N/A'}\n`);

  // OpenAI ile GradeRule seçimi
  console.log(`${'='.repeat(55)}`);
  const aiResult = await selectGradeRule(styleData, gradeRules, dropdowns);

  const result = {
    fetchedAt: new Date().toISOString(),
    styleId,
    aiGradeRuleSelection: aiResult,
    style: styleData,
    gradeRules,
    extendedFieldDropdowns: dropdowns,
  };

  const outputDir = path.join(__dirname, '..', 'output');
  const outputFile = path.join(outputDir, `style_${styleId}_data.json`);
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf8');

  console.log(`\n${'='.repeat(55)}`);
  console.log(`✅ Tamamlandı!`);
  console.log(`   Seçilen GradeRule Id  : ${aiResult.gradeRuleId}`);
  console.log(`   Seçilen GradeRule     : ${aiResult.gradeRuleName}`);
  console.log(`📁 Dosya: output/style_${styleId}_data.json`);
  console.log(`${'='.repeat(55)}\n`);

  return result;
}

// Komut satırından styleId alınabilir, yoksa 11617 default
const styleId = process.argv[2] || 11617;
fetchAndSave(Number(styleId)).catch((err) => {
  console.error('\n[HATA]', err.message);
  if (err.response) {
    console.error('HTTP Status:', err.response.status);
    console.error('Detay:', JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
