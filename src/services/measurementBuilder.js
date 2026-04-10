'use strict';

/**
 * StyleMeasurement Payload Builder
 *
 * Style verisi + GradeRule detay verisi → StyleMeasurement POST payload
 *
 * Mantık:
 *  1. Style'daki aktif SizeId setini çıkar
 *  2. GradeRuleSizes'ı bu setle filtrele
 *  3. Her POM'un GradeRulePomSizes'ını da filtrele
 *  4. GradeInc → kümülatif GradeMeas (SampleSize = 0 referansı)
 *  5. Payload objesini döndür (dosyaya yazmaz, POST'a gitmez)
 */

const MODIFY_ID      = 124;
const SETTING_FORMAT = 2;

// ─── TempKey üretimi ──────────────────────────────────────────────────────────
function makeTempKeyFactory() {
  const baseTs = Date.now();
  return (suffix) => Buffer.from(String(baseTs)).toString('base64') + String(suffix);
}

// ─── GradeInc → kümülatif GradeMeas ──────────────────────────────────────────
function calcGradeMeas(pomSizes, filteredGrSizes, sampleSizeId) {
  const sorted      = [...filteredGrSizes].sort((a, b) => a.Seq - b.Seq);
  const refGrSizeId = filteredGrSizes.find(s => s.SizeId === sampleSizeId)?.Id;
  const refIndex    = sorted.findIndex(s => s.Id === refGrSizeId);

  const result = {};

  for (const ps of pomSizes) {
    const grSizeId = ps.GradeRuleSizeId;
    const idx      = sorted.findIndex(s => s.Id === grSizeId);

    let gradeDec = 0, gradeMet = 0, gradeFrac = '0';

    if (idx === refIndex) {
      gradeDec  = 0;
      gradeMet  = 0;
      gradeFrac = '0';
    } else if (idx < refIndex) {
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
/**
 * @param {Object} styleData       - PLM Style API response (value[0])
 * @param {Object} gradeRuleDetail - PLM view API response (entities[].column)
 * @param {string} moduleCode      - Ölçü modülü kodu (örn: "AF")
 * @returns {Object} StyleMeasurement POST payload
 */
function buildPayload(styleData, gradeRuleDetail, moduleCode = 'AF') {
  const makeTempKey = makeTempKeyFactory();

  // ── Style bilgileri
  const style   = styleData.value[0];
  const styleId = style.StyleId;

  const styleSizeIds = new Set(
    (style.StyleSizeRanges ?? [])
      .flatMap(r => r.StyleSizes ?? [])
      .map(ss => ss.SizeId)
  );

  // ── GradeRule bilgileri
  const grEntity = gradeRuleDetail.entities.find(e => e.name === 'GradeRule');
  const gr       = grEntity.column;

  const gradeRuleId     = gr.Id;
  const gradeRuleName   = gr.Name;
  const sizeRangeId     = gr.SizeRangeId;
  const sampleSizeId    = gr.SampleSizeId;
  const toleranceFormat = gr.ToleranceFormat;
  const gradeRuleFormat = gr.GradeRuleFormat;
  const measurementView = gr.MeasurementView;
  const numScale        = gr.NumScale ?? 0;
  const fracDenomRaw    = gr.FractionDenominator ?? 2;
  const fracDenomVal    = { 1: 8, 2: 16, 3: 32 }[fracDenomRaw] ?? 16;

  const allGrSizes = gr.GradeRuleSizes ?? [];
  const allPoms    = gr.GradeRulePom   ?? [];

  // ── Beden filtrele (style ↔ graderule kesişim)
  const filteredGrSizes = allGrSizes
    .filter(s => styleSizeIds.has(s.SizeId))
    .sort((a, b) => a.Seq - b.Seq);

  const filteredGrSizeIds = new Set(filteredGrSizes.map(s => s.Id));

  // ── TempKey ata
  const sizeTempKeys = {};
  filteredGrSizes.forEach((s, i) => {
    sizeTempKeys[s.Id] = makeTempKey(i);
  });

  const subEntities = [];

  // 1) StyleMeasurementSizes
  filteredGrSizes.forEach((s) => {
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

  // 2) StyleMeasurementPom
  const sortedPoms = [...allPoms].sort((a, b) => a.Seq - b.Seq);

  sortedPoms.forEach((pom, pi) => {
    const pomTempKey = makeTempKey(`p${pi}`);

    const filteredPomSizes = (pom.GradeRulePomSizes ?? [])
      .filter(ps => filteredGrSizeIds.has(ps.GradeRuleSizeId));

    const measMap = calcGradeMeas(filteredPomSizes, filteredGrSizes, sampleSizeId);

    const pomSizeSubs = filteredPomSizes.map((ps, si) => {
      const grSizeId = ps.GradeRuleSizeId;
      const meas     = measMap[grSizeId] ?? { GradeMeasDecimal: 0, GradeMeasMetric: 0, GradeMeasFraction: '0' };

      return {
        Key:       0,
        TempKey:   makeTempKey(`p${pi}s${si}`),
        SubEntity: 'StyleMeasurementPomSizes',
        FieldValues: [
          { FieldName: 'StyleMeasurementSizeId', Value: sizeTempKeys[grSizeId]   },
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
        { FieldName: 'Priority',                  Value: pom.Priority                       },
        { FieldName: 'Seq',                       Value: pom.Seq                            },
        { FieldName: 'PomCode',                   Value: pom.PomCode                        },
        { FieldName: 'PomName',                   Value: pom.PomName                        },
        { FieldName: 'GradeRuleName',             Value: gradeRuleName                      },
        { FieldName: 'Description',               Value: pom.Description ?? ''              },
        { FieldName: 'Status',                    Value: 1                                  },
        { FieldName: 'OperationalStatus',         Value: 1                                  },
        { FieldName: 'PartId'                                                               },
        { FieldName: 'Image'                                                                },
        { FieldName: 'TolerancePlus'                                                        },
        { FieldName: 'ToleranceMinus'                                                       },
        { FieldName: 'StandardIncrement'                                                    },
        { FieldName: 'InitialMeasurement'                                                   },
        { FieldName: 'PomId',                     Value: pom.PomId                          },
        { FieldName: 'IsOnTheFly'                                                           },
        { FieldName: 'GradeRuleId',               Value: gradeRuleId                        },
        { FieldName: 'TolerancePlusFraction',     Value: pom.TolerancePlusFraction  ?? '0'  },
        { FieldName: 'TolerancePlusMetric',       Value: pom.TolerancePlusMetric    ?? 0    },
        { FieldName: 'TolerancePlusDecimal',      Value: pom.TolerancePlusDecimal   ?? 0    },
        { FieldName: 'ToleranceMinusFraction',    Value: pom.ToleranceMinusFraction ?? '0'  },
        { FieldName: 'ToleranceMinusMetric',      Value: pom.ToleranceMinusMetric   ?? 0    },
        { FieldName: 'ToleranceMinusDecimal',     Value: pom.ToleranceMinusDecimal  ?? 0    },
        { FieldName: 'RevMeasFraction',           Value: '0'                                },
        { FieldName: 'RevMeasMetric',             Value: '0'                                },
        { FieldName: 'RevMeasDecimal',            Value: '0'                                },
        { FieldName: 'IsDeleted',                 Value: 0                                  },
        { FieldName: 'ImageOFileName'                                                       },
        { FieldName: 'StandardIncrementFraction', Value: pom.StandardIncrementFraction ?? '0' },
        { FieldName: 'StandardIncrementMetric',   Value: pom.StandardIncrementMetric   ?? 0   },
        { FieldName: 'StandardIncrementDecimal',  Value: pom.StandardIncrementDecimal  ?? 0   },
        { FieldName: 'InitMeasDec'                                                          },
        { FieldName: 'InitMeasFrac'                                                         },
        { FieldName: 'InitMeasMet'                                                          },
        { FieldName: 'NameCulture'                                                          },
        { FieldName: 'DescriptionCulture'                                                   },
        { FieldName: 'ImageCustom'                                                          },
        { FieldName: 'ImageThumb'                                                           },
        { FieldName: 'POMCultureInfos',           Value: cultureInfos                       },
      ],
      SubEntities: pomSizeSubs,
    });
  });

  return {
    StyleId:        styleId,
    Key:            0,
    IsMain:         1,
    ModuleCode:     moduleCode,
    ModuleName:     moduleCode,
    StyleStatus:    1,
    SizeRangeId:    sizeRangeId,
    ModifyId:       String(MODIFY_ID),
    RowVersionText: '',
    DefaultImageId: null,
    MainImgsDto:    [],
    FieldValues: [
      { FieldName: 'IsMain',              Value: 1               },
      { FieldName: 'StyleId',             Value: styleId         },
      { FieldName: 'SizeRangeId',         Value: sizeRangeId     },
      { FieldName: 'ToleranceFormat',     Value: toleranceFormat  },
      { FieldName: 'Status',              Value: 1               },
      { FieldName: 'SettingFormat',       Value: SETTING_FORMAT   },
      { FieldName: 'GradeRuleFormat',     Value: gradeRuleFormat  },
      { FieldName: 'MeasurementView',     Value: measurementView  },
      { FieldName: 'FractionDenominator', Value: fracDenomVal    },
      { FieldName: 'NumScale',            Value: numScale        },
      { FieldName: 'RowVersionText',      Value: ''              },
      { FieldName: 'InitSampSizeId',      Value: 0               },
      { FieldName: 'ModifyId',            Value: 0               },
      { FieldName: 'SampleSizeId',        Value: sampleSizeId    },
    ],
    SubEntities: subEntities,
  };
}

module.exports = { buildPayload };
