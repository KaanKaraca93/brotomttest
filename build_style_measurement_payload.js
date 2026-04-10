'use strict';
/**
 * StyleMeasurement Payload Builder (AI-assisted project)
 *
 * Input  : output/style_11617_data.json       (Style API response)
 *          output/graderule_179_detail.json    (GradeRule view API response)
 * Output : output/style_measurement_payload.json
 *
 * Mantık:
 *  1. Style'daki aktif SizeId listesi çıkar (StyleSizeRanges > StyleSizes)
 *  2. GradeRuleSizes içinden sadece eşleşen bedenleri filtrele
 *  3. Her POM'un GradeRulePomSizes'ını da aynı beden seti ile filtrele
 *  4. GradeInc → kümülatif GradeMeas dönüşümü uygula (SampleSize referans = 0)
 *  5. StyleMeasurement POST payload'unu oluştur
 */

const fs   = require('fs');
const path = require('path');

// ─── Sabitler ─────────────────────────────────────────────────────────────────
const MODIFY_ID    = 124;
const SETTING_FORMAT = 2;
const MODULE_CODE  = 'AF';          // Gerekirse değiştir

// ─── TempKey üretimi ──────────────────────────────────────────────────────────
const BASE_TS = Date.now();
function makeTempKey(suffix) {
  return Buffer.from(String(BASE_TS)).toString('base64') + String(suffix);
}

// ─── GradeInc → kümülatif GradeMeas ──────────────────────────────────────────
/**
 * pomSizes         : filtrelenmiş GradeRulePomSizes dizisi
 * filteredGrSizes  : filtrelenmiş + sıralı GradeRuleSizes dizisi
 * sampleSizeId     : GradeRule.SampleSizeId (L bedeni = 49)
 *
 * Referans beden → GradeMeas = 0
 * Referansın solundaki bedenler → negatif kümülatif
 * Referansın sağındaki bedenler → pozitif kümülatif
 */
function calcGradeMeas(pomSizes, filteredGrSizes, sampleSizeId) {
  const sizeMap     = Object.fromEntries(filteredGrSizes.map(s => [s.Id, s]));
  const sorted      = [...filteredGrSizes].sort((a, b) => a.Seq - b.Seq);
  const refGrSizeId = filteredGrSizes.find(s => s.SizeId === sampleSizeId)?.Id;
  const refIndex    = sorted.findIndex(s => s.Id === refGrSizeId);

  const result = {};

  for (const ps of pomSizes) {
    const grSizeId = ps.GradeRuleSizeId;
    const idx      = sorted.findIndex(s => s.Id === grSizeId);

    let gradeDec = 0, gradeMet = 0, gradeFrac = '0';

    if (idx === refIndex) {
      // Referans beden
      gradeDec  = 0;
      gradeMet  = 0;
      gradeFrac = '0';
    } else if (idx < refIndex) {
      // Referanstan küçük bedenler → negatif kümülatif
      let totDec = 0, totMet = 0;
      for (let j = idx; j < refIndex; j++) {
        const sid = sorted[j].Id;
        const m   = pomSizes.find(p => p.GradeRuleSizeId === sid);
        if (m) { totDec += m.GradeIncDecimal; totMet += m.GradeIncMetric; }
      }
      gradeDec  = -totDec;
      gradeMet  = -totMet;
      gradeFrac = ps.GradeIncFraction ?? '0';
    } else {
      // Referanstan büyük bedenler → pozitif kümülatif
      let totDec = 0, totMet = 0;
      for (let j = refIndex; j < idx; j++) {
        const sid = sorted[j + 1].Id;
        const m   = pomSizes.find(p => p.GradeRuleSizeId === sid);
        if (m) { totDec += m.GradeIncDecimal; totMet += m.GradeIncMetric; }
      }
      gradeDec  = totDec;
      gradeMet  = totMet;
      gradeFrac = ps.GradeIncFraction ?? '0';
    }

    result[grSizeId] = {
      GradeMeasDecimal:  gradeDec,
      GradeMeasMetric:   gradeMet,
      GradeMeasFraction: gradeFrac,
    };
  }

  return result;
}

// ─── Ana builder ──────────────────────────────────────────────────────────────
function buildPayload() {
  const styleData = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'output', 'style_11617_data.json'), 'utf-8')
  );
  const grDetail = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'output', 'graderule_179_detail.json'), 'utf-8')
  );

  // ── Style bilgileri
  const style       = styleData.style.value[0];
  const styleId     = style.StyleId;

  // Style'ın aktif SizeId seti
  const styleSizeIds = new Set(
    (style.StyleSizeRanges ?? [])
      .flatMap(r => r.StyleSizes ?? [])
      .map(ss => ss.SizeId)
  );
  console.log('[INFO] Style SizeId listesi:', [...styleSizeIds].join(', '));

  // ── GradeRule bilgileri
  const grEntity   = grDetail.entities.find(e => e.name === 'GradeRule');
  const gr         = grEntity.column;

  const gradeRuleId      = gr.Id;
  const gradeRuleName    = gr.Name;
  const sizeRangeId      = gr.SizeRangeId;
  const sampleSizeId     = gr.SampleSizeId;   // 49 = L
  const toleranceFormat  = gr.ToleranceFormat;
  const gradeRuleFormat  = gr.GradeRuleFormat;
  const measurementView  = gr.MeasurementView;
  const numScale         = gr.NumScale ?? 0;
  const fracDenomRaw     = gr.FractionDenominator ?? 2;
  const fracDenomVal     = { 1: 8, 2: 16, 3: 32 }[fracDenomRaw] ?? 16;

  const allGrSizes = gr.GradeRuleSizes ?? [];
  const allPoms    = gr.GradeRulePom   ?? [];

  // ── GradeRule bedenlerini style bedenleriyle filtrele
  const filteredGrSizes = allGrSizes
    .filter(s => styleSizeIds.has(s.SizeId))
    .sort((a, b) => a.Seq - b.Seq);

  const filteredGrSizeIds = new Set(filteredGrSizes.map(s => s.Id));

  console.log('[INFO] GradeRule filtreli beden sayisi:', filteredGrSizes.length);
  filteredGrSizes.forEach(s =>
    console.log(`   GradeRuleSizeId:${s.Id}  SizeId:${s.SizeId}  Seq:${s.Seq}`)
  );

  // ── TempKey → her filtrelenmiş beden için
  const sizeTempKeys = {};
  filteredGrSizes.forEach((s, i) => {
    sizeTempKeys[s.Id] = makeTempKey(i);
  });

  const subEntities = [];

  // 1) StyleMeasurementSizes (sadece filtrelenmiş bedenler)
  filteredGrSizes.forEach((s, i) => {
    subEntities.push({
      Key:       0,
      TempKey:   sizeTempKeys[s.Id],
      SubEntity: 'StyleMeasurementSizes',
      FieldValues: [
        { FieldName: 'Seq',    Value: s.Seq    },
        { FieldName: 'SizeId', Value: s.SizeId },
      ],
    });
  });

  // 2) StyleMeasurementPom (her POM için)
  const sortedPoms = [...allPoms].sort((a, b) => a.Seq - b.Seq);

  sortedPoms.forEach((pom, pi) => {
    const pomTempKey = makeTempKey(`p${pi}`);

    // POM'un PomSizes'ını filtrele (sadece seçili bedenler)
    const filteredPomSizes = (pom.GradeRulePomSizes ?? [])
      .filter(ps => filteredGrSizeIds.has(ps.GradeRuleSizeId));

    // GradeMeas hesapla
    const measMap = calcGradeMeas(filteredPomSizes, filteredGrSizes, sampleSizeId);

    // PomSize alt entity'leri
    const pomSizeSubs = filteredPomSizes.map((ps, si) => {
      const grSizeId = ps.GradeRuleSizeId;
      const meas     = measMap[grSizeId] ?? { GradeMeasDecimal: 0, GradeMeasMetric: 0, GradeMeasFraction: '0' };

      return {
        Key:       0,
        TempKey:   makeTempKey(`p${pi}s${si}`),
        SubEntity: 'StyleMeasurementPomSizes',
        FieldValues: [
          { FieldName: 'StyleMeasurementSizeId', Value: sizeTempKeys[grSizeId] },
          { FieldName: 'GradeIncDecimal',        Value: ps.GradeIncDecimal        },
          { FieldName: 'GradeIncMetric',         Value: ps.GradeIncMetric         },
          { FieldName: 'GradeIncFraction',       Value: ps.GradeIncFraction       },
          { FieldName: 'GradeMeasDecimal',       Value: meas.GradeMeasDecimal     },
          { FieldName: 'GradeMeasMetric',        Value: meas.GradeMeasMetric      },
          { FieldName: 'GradeMeasFraction',      Value: meas.GradeMeasFraction    },
          { FieldName: 'InitMeasDecimal',        Value: 0                         },
          { FieldName: 'InitMeasMetric',         Value: 0                         },
          { FieldName: 'InitMeasFraction',       Value: 0                         },
          { FieldName: 'Init_MeasDecimal',       Value: meas.GradeMeasDecimal     },
          { FieldName: 'Init_MeasMetric',        Value: meas.GradeMeasMetric      },
          { FieldName: 'Init_MeasFraction',      Value: meas.GradeMeasFraction    },
          { FieldName: 'IsDeleted',              Value: 0                         },
        ],
      };
    });

    const cultureInfos = pom.Pom?.POMCultureInfos ?? [];

    subEntities.push({
      Key:       0,
      TempKey:   pomTempKey,
      SubEntity: 'StyleMeasurementPom',
      FieldValues: [
        { FieldName: 'Priority',                   Value: pom.Priority                      },
        { FieldName: 'Seq',                        Value: pom.Seq                           },
        { FieldName: 'PomCode',                    Value: pom.PomCode                       },
        { FieldName: 'PomName',                    Value: pom.PomName                       },
        { FieldName: 'GradeRuleName',              Value: gradeRuleName                     },
        { FieldName: 'Description',                Value: pom.Description ?? ''             },
        { FieldName: 'Status',                     Value: 1                                 },
        { FieldName: 'OperationalStatus',          Value: 1                                 },
        { FieldName: 'PartId'                                                               },
        { FieldName: 'Image'                                                                },
        { FieldName: 'TolerancePlus'                                                        },
        { FieldName: 'ToleranceMinus'                                                       },
        { FieldName: 'StandardIncrement'                                                    },
        { FieldName: 'InitialMeasurement'                                                   },
        { FieldName: 'PomId',                      Value: pom.PomId                         },
        { FieldName: 'IsOnTheFly'                                                           },
        { FieldName: 'GradeRuleId',                Value: gradeRuleId                       },
        { FieldName: 'TolerancePlusFraction',      Value: pom.TolerancePlusFraction  ?? '0' },
        { FieldName: 'TolerancePlusMetric',        Value: pom.TolerancePlusMetric    ?? 0   },
        { FieldName: 'TolerancePlusDecimal',       Value: pom.TolerancePlusDecimal   ?? 0   },
        { FieldName: 'ToleranceMinusFraction',     Value: pom.ToleranceMinusFraction ?? '0' },
        { FieldName: 'ToleranceMinusMetric',       Value: pom.ToleranceMinusMetric   ?? 0   },
        { FieldName: 'ToleranceMinusDecimal',      Value: pom.ToleranceMinusDecimal  ?? 0   },
        { FieldName: 'RevMeasFraction',            Value: '0'                               },
        { FieldName: 'RevMeasMetric',              Value: '0'                               },
        { FieldName: 'RevMeasDecimal',             Value: '0'                               },
        { FieldName: 'IsDeleted',                  Value: 0                                 },
        { FieldName: 'ImageOFileName'                                                       },
        { FieldName: 'StandardIncrementFraction',  Value: pom.StandardIncrementFraction ?? '0' },
        { FieldName: 'StandardIncrementMetric',    Value: pom.StandardIncrementMetric   ?? 0   },
        { FieldName: 'StandardIncrementDecimal',   Value: pom.StandardIncrementDecimal  ?? 0   },
        { FieldName: 'InitMeasDec'                                                          },
        { FieldName: 'InitMeasFrac'                                                         },
        { FieldName: 'InitMeasMet'                                                          },
        { FieldName: 'NameCulture'                                                          },
        { FieldName: 'DescriptionCulture'                                                   },
        { FieldName: 'ImageCustom'                                                          },
        { FieldName: 'ImageThumb'                                                           },
        { FieldName: 'POMCultureInfos',            Value: cultureInfos                      },
      ],
      SubEntities: pomSizeSubs,
    });
  });

  // ── Ana payload
  const payload = {
    StyleId:        styleId,
    Key:            0,
    IsMain:         1,
    ModuleCode:     MODULE_CODE,
    ModuleName:     MODULE_CODE,
    StyleStatus:    1,
    SizeRangeId:    sizeRangeId,
    ModifyId:       String(MODIFY_ID),
    RowVersionText: '',
    DefaultImageId: null,
    MainImgsDto:    [],
    FieldValues: [
      { FieldName: 'IsMain',              Value: 1              },
      { FieldName: 'StyleId',             Value: styleId        },
      { FieldName: 'SizeRangeId',         Value: sizeRangeId    },
      { FieldName: 'ToleranceFormat',     Value: toleranceFormat },
      { FieldName: 'Status',              Value: 1              },
      { FieldName: 'SettingFormat',       Value: SETTING_FORMAT  },
      { FieldName: 'GradeRuleFormat',     Value: gradeRuleFormat },
      { FieldName: 'MeasurementView',     Value: measurementView },
      { FieldName: 'FractionDenominator', Value: fracDenomVal   },
      { FieldName: 'NumScale',            Value: numScale       },
      { FieldName: 'RowVersionText',      Value: ''             },
      { FieldName: 'InitSampSizeId',      Value: 0              },
      { FieldName: 'ModifyId',            Value: 0              },
      { FieldName: 'SampleSizeId',        Value: sampleSizeId   },
    ],
    SubEntities: subEntities,
  };

  const outPath = path.join(__dirname, 'output', 'style_measurement_payload.json');
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8');

  console.log('\n[OK] Payload olusturuldu:', outPath);
  console.log('   StyleId         :', styleId);
  console.log('   GradeRule       :', `[${gradeRuleId}] ${gradeRuleName}`);
  console.log('   SampleSizeId    :', sampleSizeId);
  console.log('   SizeRangeId     :', sizeRangeId);
  console.log('   Filtrelenmiş beden sayisi:', filteredGrSizes.length);
  console.log('   POM sayisi      :', sortedPoms.length);
  console.log('   SubEntity toplam:', subEntities.length);
}

buildPayload();
