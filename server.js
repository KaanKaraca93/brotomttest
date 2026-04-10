'use strict';

require('dotenv').config();

const express      = require('express');
const tokenService = require('./src/auth');
const { getStyleById, getActiveGradeRules, getExtendedFieldDropdowns, getGradeRuleDetail } = require('./src/services/plmService');
const { selectGradeRule } = require('./src/services/aiService');
const { buildPayload }    = require('./src/services/measurementBuilder');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'BR Oto Olcu Tablosu API', version: '1.0.0' });
});

// ─── Ana endpoint ─────────────────────────────────────────────────────────────
/**
 * POST /api/style-measurement
 * Body: { "styleId": 11617, "moduleCode": "AF" }
 *
 * Akış:
 *  1. Token al (cache)
 *  2. Style + GradeRules + Dropdowns paralel çek
 *  3. OpenAI ile GradeRule seç
 *  4. Seçilen GradeRule detayını view API'den çek
 *  5. StyleMeasurement payload'u oluştur (beden filtreli)
 *  6. Payload'u response olarak döndür
 */
app.post('/api/style-measurement', async (req, res) => {
  const { styleId, moduleCode = 'AF' } = req.body;

  if (!styleId) {
    return res.status(400).json({ error: 'styleId zorunludur.' });
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  [REQUEST] StyleId: ${styleId} | ModuleCode: ${moduleCode}`);
  console.log(`${'='.repeat(60)}`);

  try {
    // 1. Token önbelleğe al
    await tokenService.getAccessToken();

    // 2. Paralel API çağrıları
    const [styleData, gradeRules, dropdowns] = await Promise.all([
      getStyleById(styleId),
      getActiveGradeRules(),
      getExtendedFieldDropdowns(),
    ]);

    const style = styleData?.value?.[0];
    if (!style) {
      return res.status(404).json({ error: `StyleId ${styleId} bulunamadı.` });
    }

    console.log(`\n  Style         : ${style.StyleCode}`);
    console.log(`  GradeRule say.: ${gradeRules?.value?.length ?? 0}`);
    console.log(`  Dropdown say. : ${dropdowns?.value?.length ?? 0}`);

    // 3. AI ile GradeRule seç
    const aiResult = await selectGradeRule(styleData, gradeRules, dropdowns);

    // 4. GradeRule detayını view API'den çek
    const gradeRuleDetail = await getGradeRuleDetail(aiResult.gradeRuleId);

    // 5. Payload oluştur (beden filtreli)
    const payload = buildPayload(styleData, gradeRuleDetail, moduleCode);

    console.log(`\n  [OK] Payload hazir`);
    console.log(`  GradeRule     : [${aiResult.gradeRuleId}] ${aiResult.gradeRuleName}`);
    console.log(`  SizeRange     : ${payload.SizeRangeId} | Beden: ${payload.SubEntities.filter(e => e.SubEntity === 'StyleMeasurementSizes').length}`);
    console.log(`  POM sayisi    : ${payload.SubEntities.filter(e => e.SubEntity === 'StyleMeasurementPom').length}`);
    console.log(`${'='.repeat(60)}\n`);

    return res.json({
      styleId,
      styleCode:      style.StyleCode,
      gradeRuleId:    aiResult.gradeRuleId,
      gradeRuleName:  aiResult.gradeRuleName,
      aiReasoning:    aiResult.reasoning,
      payload,
    });

  } catch (err) {
    console.error('\n[ERROR]', err.message);
    if (err.response) {
      console.error('HTTP:', err.response.status);
      console.error(JSON.stringify(err.response.data)?.substring(0, 500));
    }
    return res.status(500).json({
      error:   err.message,
      details: err.response?.data ?? null,
    });
  }
});

// ─── Server başlat ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[SERVER] BR Oto Olcu Tablosu API - http://localhost:${PORT}`);
});
